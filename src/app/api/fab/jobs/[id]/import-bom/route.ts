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
import { stableSource } from '@/lib/source-key'

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

  for (const file of files) {
    const category = bomCategoryFromFilename(file.name)
    if (!category) { skipped.push({ file: file.name, reason: 'not a recognised BOM report' }); continue }

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
    // Idempotent: clear this report's prior rows for this job, then insert fresh.
    await admin.from('job_bom').delete()
      .eq('quote_number', job.quote_number).eq('source_file', sourceKey)

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
    const { error } = await admin.from('job_bom').insert(insertRows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
