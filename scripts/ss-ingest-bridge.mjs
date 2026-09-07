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
 *   DRY_RUN=1                  list what it WOULD do, change nothing (optional)
 *   MAX_JOBS=N                 cap the number of jobs this run        (optional)
 *   RELEASES_ONLY=0            ingest ungated (NOT recommended)       (optional)
 *
 * THIS SCRIPT HOLDS NO DATABASE CREDENTIAL. It used to carry SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY and write fab_jobs and the fab-drawings bucket
 * directly. It is now a pure HTTP client of the fab app, holding only the kiosk
 * secret it already needed. A script on an office server with a service-role key
 * is a copy of the whole database sitting in a .env file on a Windows box.
 *
 * AND IT CAN NO LONGER INVENT A JOB NUMBER. It used to read the folder name as
 * the job number whenever the name was not HG######, so "26070101 - Smith Road"
 * minted a fab job called `26070101 - Smith Road`. Numbers are now parsed by
 * scripts/lib/job-ref.mjs (8-digit first, then HG/HM, else SKIP) and validated
 * by POST /api/fab/jobs against the Hub's own jobs table.
 *
 * RELEASES_ONLY DEFAULTS TO ON. The old ungated default was a pre-release
 * convenience from before the Release to Factory pipeline existed; leaving it
 * that way meant the bridge started fabrication on any job with drawings on the
 * drive. The release check now asks FAB, not the Hub, so the bridge talks to
 * exactly one app. Set RELEASES_ONLY=0 to go back to ungated, deliberately.
 *
 * Lane 12 turns this into the `fab-ingest` plugin of the hytek-bridge service;
 * after this change it is already a pure HTTP client, so that is a move, not a
 * rewrite.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { jobNameFromFolder, jobRefFromFolder } from './lib/job-ref.mjs'

const cfg = {
  yearRoot: process.env.SS_YEAR_ROOT,
  fabUrl: process.env.FAB_URL || 'https://hytek-fab.vercel.app',
  kioskSecret: process.env.KIOSK_SECRET,
  // Opt OUT, not opt in. See the header.
  releasesOnly: process.env.RELEASES_ONLY !== '0',
  dryRun: process.env.DRY_RUN === '1',
  maxJobs: Number(process.env.MAX_JOBS || 0),
}

// Coarse filename filter for BOM reports (the endpoint authoritatively decides
// category and skips anything unrecognised).
const BOM_RX = /(part material|material list|for ordering|plate|bolt|chemset|chem ?set|tube|loose|misc)/i

/**
 * Has this job been released to the factory?
 *
 * Asks FAB, not the Hub. The bridge now talks to exactly one app and holds
 * exactly one credential; fab is the thing that already knows, because its ready
 * queue is fed by the Hub. FAILS CLOSED: if we cannot get an answer we do not
 * start fabricating.
 */
async function isReleased(quoteNumber, token) {
  if (!cfg.releasesOnly) return true
  try {
    const url = `${cfg.fabUrl}/api/fab/ready-queue?quote=${encodeURIComponent(quoteNumber)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { console.log(`  ! fab ready-queue ${res.status} — skipping (releases-only)`); return false }
    const body = await res.json().catch(() => ({}))
    const items = Array.isArray(body?.items) ? body.items : []
    return items.some(i => i?.quote_number === quoteNumber && (i.ss_released || i.ready))
  } catch (e) { console.log('  ! fab unreachable — skipping (releases-only): ' + e.message); return false }
}
for (const k of ['yearRoot', 'kioskSecret']) {
  if (!cfg[k]) { console.error('Missing required env: ' + k); process.exit(1) }
}


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
      // Keep only the newest issue of each BOM report (drop superseded _IFF_ copies
      // detailers leave in place) so we don't POST colliding issues. The endpoint
      // also de-dupes, but this keeps the upload + logs honest.
      const fileBase = (p) => p.split(/[\\/]/).pop()
      const baseKey = (p) => fileBase(p).replace(/\.(xlsx|xls)$/i, '').replace(/_iff_\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/i, '').trim().toLowerCase()
      const iffMs = (p) => { const m = fileBase(p).match(/_iff_(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})/i); if (!m) return -1; const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return new Date(yy, Number(m[2]) - 1, Number(m[1])).getTime() }
      const bomBest = new Map()
      for (const p of bomFiles) { const k = baseKey(p); const cur = bomBest.get(k); if (!cur || iffMs(p) > iffMs(cur)) bomBest.set(k, p) }
      const dedupedBom = [...bomBest.values()]
      if (assemblies.length) {
        const ref = jobRefFromFolder(jobDir)
        if (!ref) {
          // The old code put the WHOLE FOLDER NAME here and minted a job from
          // it. A folder we cannot read a number from is a data question for the
          // Monday review, not something this script guesses at.
          console.log(`  – no job number in folder name "${jobDir}" — skipping`)
          continue
        }
        jobs.push({
          jobNo: ref,
          name: jobNameFromFolder(jobDir),
          customer, assemblies, bomFiles: dedupedBom, drawings,
        })
      }
    }
  }
  return jobs
}

const jobs = findJobs(cfg.yearRoot)
console.log(`Found ${jobs.length} SS job(s) with Assembly Lists under ${cfg.yearRoot}`)
const tok = supervisorToken()
let processed = 0

for (const j of jobs) {
  if (cfg.maxJobs && processed >= cfg.maxJobs) break
  console.log(`\n${j.jobNo} — ${j.name}  [${j.assemblies.length} list(s), ${j.bomFiles.length} BOM, ${j.drawings.length} drawing(s)]`)
  if (!(await isReleased(j.jobNo, tok))) { console.log('  – not released to factory yet — skipping'); continue }
  if (cfg.dryRun) { processed++; continue }

  // Through the front door, which validates the number against the Hub's jobs
  // table and refuses one it does not know (422). The bridge can no longer mint
  // a fab_jobs row for a folder the Hub has never heard of, and a legacy HG or
  // 7-digit reference is resolved to its canonical 8-digit number on the way in.
  const createRes = await fetch(`${cfg.fabUrl}/api/fab/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote_number: j.jobNo, name: j.name }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (!createRes.ok || !created?.job?.id) {
    console.log(`  ! ${createRes.status} ${created?.error || 'could not create/find the job'} — skipping`)
    continue
  }
  const job = created.job
  if (created.matched_by === 'alias') console.log(`  · resolved ${j.jobNo} → ${job.quote_number} via the Hub's alias table`)

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
    const fd = new FormData()
    fd.append('file', new File([readFileSync(f)], name, { type: 'application/pdf' }))
    const res = await fetch(`${cfg.fabUrl}/api/fab/jobs/${job.id}/drawings`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd,
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      console.log(`  drawing ERR ${name}: HTTP ${res.status} ${e.error || ''}`)
    } else drew++
  }
  console.log(`  drawings: ${drew}/${j.drawings.length} uploaded`)
  processed++
}
console.log(`\nDone. Processed ${processed} job(s).${cfg.dryRun ? ' (dry run — nothing changed)' : ''}`)
