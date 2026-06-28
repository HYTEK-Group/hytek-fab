// POST /api/fab/jobs/[id]/import-bom — supervisor (or the Y: bridge) uploads one
// or more Tekla material/plate/bolt/chemset/loose/misc report xlsx files. We parse
// each into job_bom rows that PURCHASING reads. Idempotent per report: re-importing
// a report replaces only that report's rows (delete-by source_file, then insert),
// so a re-run never duplicates and a re-issue cleanly supersedes.
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { parseBomRows, bomCategoryFromFilename, type Row } from '@/lib/tekla-bom'
import { stableSource, iffDate } from '@/lib/source-key'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const form = await req.formData().catch(() => null)
  const files = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File)
  if (!files.length) {
    return NextResponse.json({ error: 'file(s) required (multipart form-data)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: job, error: jobErr } = await admin
    .from('fab_jobs').select('id, quote_number, hubspot_deal_id').eq('id', id).single()
  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Tie the BOM issue to the job's latest assembly import version when there is one.
  const { data: batches } = await admin
    .from('fab_import_batches').select('issue_version')
    .eq('fab_job_id', id).order('issue_version', { ascending: false }).limit(1)
  const issueVersion = (batches?.[0]?.issue_version as number) ?? 1

  const reports: { file: string; category: string; lines: number }[] = []
  const skipped: { file: string; reason: string }[] = []
  let totalLines = 0

  // Collapse duplicate issues of the SAME report present in one request (the
  // bridge may collect superseded _IFF_ copies that all map to one source_file):
  // keep the NEWEST by issue date, so the second issue can't silently overwrite
  // the first and the totals reported to purchasing stay honest.
  const recognised: File[] = []
  for (const f of files) {
    if (bomCategoryFromFilename(f.name)) recognised.push(f)
    else skipped.push({ file: f.name, reason: 'not a recognised BOM report' })
  }
  const bySource = new Map<string, File[]>()
  for (const f of recognised) {
    const k = stableSource(f.name)
    const arr = bySource.get(k); if (arr) arr.push(f); else bySource.set(k, [f])
  }
  const winners: File[] = []
  for (const group of bySource.values()) {
    if (group.length === 1) { winners.push(group[0]); continue }
    const sorted = [...group].sort((a, b) => iffDate(b.name) - iffDate(a.name))
    winners.push(sorted[0])
    for (const loser of sorted.slice(1)) {
      skipped.push({ file: loser.name, reason: `superseded by ${sorted[0].name} (same report, newer issue)` })
    }
  }

  for (const file of winners) {
    const category = bomCategoryFromFilename(file.name)!

    let lines
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const wb = XLSX.read(buf, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, blankrows: true, defval: null })
      lines = parseBomRows(rows, category).lines
    } catch (e) {
      skipped.push({ file: file.name, reason: 'unreadable xlsx: ' + (e as Error).message }); continue
    }
    if (!lines.length) { skipped.push({ file: file.name, reason: 'no rows parsed' }); continue }

    const sourceKey = stableSource(file.name)
    const insertRows = lines.map(l => ({
      quote_number: job.quote_number,
      hubspot_deal_id: job.hubspot_deal_id,
      issue_version: issueVersion,
      category: l.category,
      part_mark: l.part_mark,
      profile: l.profile,
      grade: l.grade,
      length_mm: l.length_mm,
      qty: l.qty,
      weight_kg: l.weight_kg,
      from_stock: l.from_stock,
      from_order: l.from_order,
      source_file: sourceKey,
    }))

    // Idempotent replace WITHOUT an empty window: capture the report's prior rows,
    // INSERT the new rows first, then delete only those prior rows. If the insert
    // fails the old rows are untouched (job_bom never goes empty); a rare delete
    // failure leaves brief duplicates the next run cleans up. A per-file failure is
    // recorded and does NOT abort the remaining reports in this request.
    const { data: prior } = await admin.from('job_bom').select('id')
      .eq('quote_number', job.quote_number).eq('source_file', sourceKey)
    const { error: insErr } = await admin.from('job_bom').insert(insertRows)
    if (insErr) { skipped.push({ file: file.name, reason: 'db write failed: ' + insErr.message }); continue }
    const priorIds = (prior ?? []).map(r => r.id as string)
    if (priorIds.length) {
      const { error: delErr } = await admin.from('job_bom').delete().in('id', priorIds)
      if (delErr) console.error('job_bom: prior-row cleanup failed (self-heals next run):', delErr.message)
    }

    reports.push({ file: file.name, category, lines: lines.length })
    totalLines += lines.length
  }

  return NextResponse.json({
    ok: true,
    quote_number: job.quote_number,
    issue_version: issueVersion,
    reports,
    skipped,
    total_lines: totalLines,
  })
}
