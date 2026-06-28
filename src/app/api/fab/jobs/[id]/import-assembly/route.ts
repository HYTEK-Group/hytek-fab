// POST /api/fab/jobs/[id]/import-assembly — supervisor uploads a Tekla
// "Assembly List" xlsx; we parse it, reconcile vs existing marks (safe on
// re-import — worked/edited marks are never overwritten, removals never
// auto-deleted), stamp provenance, record the import batch, refresh progress.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import * as XLSX from 'xlsx'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { parseAssemblyRows, type Row } from '@/lib/tekla-assembly'
import { diffMarks, needsReview, type ExistingMark } from '@/lib/fab-import'
import { computeAndUpsertProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

/** Stable per-block report identity (strips the _IFF_<date> + extension), so a
 *  re-issue of the same block reconciles against the right marks. */
function stableSource(filename: string): string {
  return filename
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/_iff_\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/i, '')
    .trim()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required (multipart form-data)' }, { status: 400 })
  }

  let parsed
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, blankrows: true, defval: null })
    parsed = parseAssemblyRows(rows)
  } catch (e) {
    return NextResponse.json({ error: 'Could not read the xlsx: ' + (e as Error).message }, { status: 400 })
  }
  if (!parsed.marks.length) {
    return NextResponse.json({ error: 'No assemblies found — is this a Tekla Assembly List?' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: job, error: jobErr } = await admin
    .from('fab_jobs').select('id, quote_number, hubspot_deal_id').eq('id', id).single()
  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const sourceKey = stableSource(file.name)
  const sourceHash = createHash('sha256').update(JSON.stringify(parsed.marks)).digest('hex')

  // Existing marks for this job, scoped to this source for diff/removal detection
  // (other blocks' marks have a different source_file and are untouched).
  const { data: allExisting } = await admin.from('fab_marks').select('*').eq('fab_job_id', id)
  const existing = (allExisting ?? []) as Array<Record<string, unknown>>
  const inScope: ExistingMark[] = existing
    .filter(m => (m.source_file ?? null) === sourceKey)
    .map(m => ({
      mark_id: String(m.mark_id),
      status: String(m.status ?? 'not_started'),
      section: (m.section as string) ?? null,
      length_mm: (m.length_mm as number) ?? null,
      weight_kg: (m.weight_kg as number) ?? null,
      quantity: (m.quantity as number) ?? 1,
      manually_edited: !!m.manually_edited,
      contractor_package_id: (m.contractor_package_id as string) ?? null,
      dispatch_load_id: (m.dispatch_load_id as string) ?? null,
      rework_count: (m.rework_count as number) ?? 0,
    }))

  const diff = diffMarks(parsed.marks, inScope)

  const { data: batches } = await admin
    .from('fab_import_batches').select('issue_version')
    .eq('fab_job_id', id).eq('source_file', sourceKey)
    .order('issue_version', { ascending: false }).limit(1)
  const version = ((batches?.[0]?.issue_version as number) ?? 0) + 1

  // Apply: create added; update changed that are NOT protected. Stamp provenance.
  const upserts: Record<string, unknown>[] = []
  for (const d of diff.added) {
    const p = d.parsed!
    upserts.push({
      fab_job_id: id, mark_id: p.mark_id.toUpperCase(), description: p.description, section: p.section,
      length_mm: p.length_mm, weight_kg: p.weight_kg, quantity: p.quantity, coating: p.coating,
      status: 'not_started', source: 'manual', source_issue: version, source_file: sourceKey, source_hash: sourceHash,
    })
  }
  for (const d of diff.changed) {
    if (d.isProtected) continue
    const p = d.parsed!
    upserts.push({
      fab_job_id: id, mark_id: p.mark_id.toUpperCase(), description: p.description, section: p.section,
      length_mm: p.length_mm, weight_kg: p.weight_kg, quantity: p.quantity, coating: p.coating,
      source: 'manual', source_issue: version, source_file: sourceKey, source_hash: sourceHash,
    })
  }
  if (upserts.length) {
    const { error } = await admin.from('fab_marks').upsert(upserts, { onConflict: 'fab_job_id,mark_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const protectedChanges = diff.changed.filter(d => d.isProtected)
  const review = needsReview(diff)

  await admin.from('fab_import_batches').insert({
    fab_job_id: id, quote_number: job.quote_number, stream: 'SS', issue_version: version,
    source_file: sourceKey, source_hash: sourceHash,
    parsed_marks: parsed.marks.length, total_kg: parsed.total_kg,
    status: review ? 'pending_review' : 'applied', imported_by: caller.name,
    note: review ? `${protectedChanges.length} protected change(s), ${diff.removed.length} removed — review with detailing` : null,
  })

  await computeAndUpsertProgress(id)

  return NextResponse.json({
    ok: true,
    version,
    first_import: inScope.length === 0,
    project_number: parsed.project_number,
    quote_number: job.quote_number,
    project_match: !parsed.project_number || parsed.project_number === job.quote_number,
    issued_status: parsed.issued_status,
    parsed: parsed.marks.length,
    total_kg: parsed.total_kg,
    added: diff.added.length,
    changed_applied: diff.changed.length - protectedChanges.length,
    protected: protectedChanges.map(d => ({ mark_id: d.mark_id, fields: d.fields })),
    removed: diff.removed.map(d => ({ mark_id: d.mark_id, has_work: d.hasWork })),
    needs_review: review,
  })
}
