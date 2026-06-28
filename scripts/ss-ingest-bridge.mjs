#!/usr/bin/env node
/*
 * HYTEK Fab — SS-ingest bridge (run on the always-on office server)
 * ----------------------------------------------------------------------------
 * Scans the Y: drive for finished structural-steel jobs (Tekla "Issued For
 * Fabrication" reports) and loads them into the fab app:
 *   • marks + tonnage  → via the canonical import endpoint (same pipeline as the
 *                        in-app "Import Assembly List", so re-issues are detected
 *                        and in-progress work is never overwritten)
 *   • bill of materials → the Part Material / Plate / Bolt / Chemset / Loose / Misc
 *                        reports → /import-bom → the shared job_bom table (purchasing reads)
 *   • shop drawings    → uploaded to the fab-drawings storage bucket
 *
 * Why a server script: Vercel can't see the Y: drive — this runs where Y: is
 * mounted (the always-on sync server, same box as the LWS / Hub bridges).
 *
 * Schedule it (e.g. every 15 min via Task Scheduler / cron). It is idempotent:
 * unchanged marks re-import to no-ops; a re-issued job is flagged for review in
 * the app rather than silently overwritten; each BOM report replaces only its own
 * rows (no duplication).
 *
 * Config (environment variables):
 *   SS_YEAR_ROOT               e.g. "Y:\\(17) 2026 HYTEK PROJECTS"   (required)
 *   FAB_URL                    https://hytek-fab.vercel.app          (default)
 *   KIOSK_SECRET               same value as the fab app             (required)
 *   SUPABASE_URL               fab project URL                       (required)
 *   SUPABASE_SERVICE_ROLE_KEY  fab service role key                  (required)
 *   RELEASES_ONLY=1            only ingest jobs the Hub reports released (ss_release).
 *                              Requires HUB_BASE + HUB token below.  (optional)
 *   HUB_BASE                   e.g. https://hub.hytekframing.com.au  (for RELEASES_ONLY)
 *   HUB_INTERNAL_TOKEN         Hub read token (or HUB_TOKEN_LWS)     (for RELEASES_ONLY)
 *   DRY_RUN=1                  list what it WOULD do, change nothing (optional)
 *   MAX_JOBS=N                 cap the number of jobs this run        (optional)
 *
 * Default (no RELEASES_ONLY): loads every job that has Tekla IFF reports present.
 * Once the "Release to Factory" pipeline is deployed, set RELEASES_ONLY=1 +
 * HUB_BASE + a Hub token to gate ingest on the Hub's ss_release signal.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const cfg = {
  yearRoot: process.env.SS_YEAR_ROOT,
  fabUrl: process.env.FAB_URL || 'https://hytek-fab.vercel.app',
  kioskSecret: process.env.KIOSK_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  hubBase: (process.env.HUB_BASE || '').replace(/\/$/, ''),
  hubToken: process.env.HUB_INTERNAL_TOKEN || process.env.HUB_TOKEN_LWS || '',
  releasesOnly: process.env.RELEASES_ONLY === '1',
  dryRun: process.env.DRY_RUN === '1',
  maxJobs: Number(process.env.MAX_JOBS || 0),
}

// Coarse filename filter for BOM reports (the endpoint authoritatively decides
// category and skips anything unrecognised).
const BOM_RX = /(part material|material list|for ordering|plate|bolt|chemset|chem ?set|tube|loose|misc)/i

/** When RELEASES_ONLY is on and the Hub is configured, only ingest jobs the Hub
 *  reports as released (ss_release present). Otherwise ingest everything. */
async function isReleased(quoteNumber) {
  if (!cfg.releasesOnly) return true
  if (!cfg.hubBase || !cfg.hubToken) {
    console.log('  ! RELEASES_ONLY set but HUB_BASE/HUB token missing — ingesting ungated')
    return true
  }
  try {
    const url = `${cfg.hubBase}/api/flow/job-state/_?quote_number=${encodeURIComponent(quoteNumber)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.hubToken}` } })
    if (!res.ok) { console.log(`  ! Hub job-state ${res.status} — skipping (releases-only)`); return false }
    const s = await res.json().catch(() => ({}))
    return !!s?.ss_release
  } catch (e) { console.log('  ! Hub unreachable — skipping (releases-only): ' + e.message); return false }
}
for (const k of ['yearRoot', 'kioskSecret', 'supabaseUrl', 'serviceKey']) {
  if (!cfg[k]) { console.error('Missing required env: ' + k); process.exit(1) }
}

const sb = createClient(cfg.supabaseUrl, cfg.serviceKey)

function supervisorToken() {
  const payload = Buffer.from(JSON.stringify({
    worker_name: 'SS Ingest Bridge', role: 'supervisor', exp: Math.floor(Date.now() / 1000) + 1800,
  })).toString('base64url')
  const sig = createHmac('sha256', cfg.kioskSecret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function findJobs(root) {
  const jobs = []
  for (const customer of readdirSync(root)) {
    const cdir = join(root, customer)
    try { if (!statSync(cdir).isDirectory()) continue } catch { continue }
    for (const jobDir of readdirSync(cdir)) {
      const struct = join(cdir, jobDir, '06 MANUFACTURING', '02 DRAWINGS MANUFACTURING', '02 STRUCTURAL')
      if (!existsSync(struct)) continue
      const assemblies = [], bomFiles = [], drawings = []
      const walk = (d) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n)
          if (statSync(p).isDirectory()) walk(p)
          else if (/assembly list.*\.xlsx$/i.test(n)) assemblies.push(p)
          else if (/\.xlsx$/i.test(n) && BOM_RX.test(n)) bomFiles.push(p)
          else if (/\.pdf$/i.test(n) && !/\.xls\.pdf$/i.test(n)) drawings.push(p)
        }
      }
      walk(struct)
      if (assemblies.length) {
        const m = jobDir.match(/\b(HG\d{6,})\b/i)
        jobs.push({
          jobNo: m ? m[1].toUpperCase() : jobDir,
          name: (jobDir.replace(/^HG\d+\s*/i, '').trim()) || jobDir,
          customer, assemblies, bomFiles, drawings,
        })
      }
    }
  }
  return jobs
}

async function ensureBucket() {
  const { data } = await sb.storage.listBuckets()
  if (!data?.some(b => b.name === 'fab-drawings')) await sb.storage.createBucket('fab-drawings', { public: false })
}

const jobs = findJobs(cfg.yearRoot)
console.log(`Found ${jobs.length} SS job(s) with Assembly Lists under ${cfg.yearRoot}`)
if (!cfg.dryRun) await ensureBucket()
const tok = supervisorToken()
let processed = 0

for (const j of jobs) {
  if (cfg.maxJobs && processed >= cfg.maxJobs) break
  console.log(`\n${j.jobNo} — ${j.name}  [${j.assemblies.length} list(s), ${j.bomFiles.length} BOM, ${j.drawings.length} drawing(s)]`)
  if (!(await isReleased(j.jobNo))) { console.log('  – not released to factory yet — skipping'); continue }
  if (cfg.dryRun) { processed++; continue }

  const { data: job } = await sb.from('fab_jobs').upsert({
    quote_number: j.jobNo, name: j.name, client: j.customer,
    status: 'in_progress', compliance_mode: 'permissive', started_by: 'ss-ingest-bridge',
  }, { onConflict: 'quote_number' }).select('id').single()
  if (!job) { console.log('  ! could not create/find the job — skipping'); continue }

  for (const f of j.assemblies) {
    const name = f.split(/[\\/]/).pop()
    const fd = new FormData()
    fd.append('file', new File([readFileSync(f)], name))
    const res = await fetch(`${cfg.fabUrl}/api/fab/jobs/${job.id}/import-assembly`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd,
    })
    const r = await res.json().catch(() => ({}))
    console.log(`  import ${name} → HTTP ${res.status}` + (res.ok ? `  (+${r.added} added, ${r.changed_applied} updated${r.needs_review ? ', NEEDS REVIEW' : ''})` : `  ${r.error || ''}`))
  }

  // Bill of materials → job_bom (one multipart POST; the endpoint picks categories).
  if (j.bomFiles.length) {
    const fd = new FormData()
    for (const f of j.bomFiles) fd.append('file', new File([readFileSync(f)], f.split(/[\\/]/).pop()))
    const res = await fetch(`${cfg.fabUrl}/api/fab/jobs/${job.id}/import-bom`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd,
    })
    const r = await res.json().catch(() => ({}))
    console.log(`  BOM ${j.bomFiles.length} report(s) → HTTP ${res.status}` + (res.ok ? `  (${r.total_lines ?? 0} line(s)${r.skipped?.length ? `, ${r.skipped.length} skipped` : ''})` : `  ${r.error || ''}`))
  }

  let drew = 0
  for (const f of j.drawings) {
    const name = f.split(/[\\/]/).pop()
    const { error } = await sb.storage.from('fab-drawings').upload(`${j.jobNo}/${name}`, readFileSync(f), { contentType: 'application/pdf', upsert: true })
    if (error) console.log('  drawing ERR ' + name + ': ' + error.message); else drew++
  }
  console.log(`  drawings: ${drew}/${j.drawings.length} uploaded`)
  processed++
}
console.log(`\nDone. Processed ${processed} job(s).${cfg.dryRun ? ' (dry run — nothing changed)' : ''}`)
