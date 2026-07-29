// PATCH  /api/fab/stages/[id] — edit a stage {name?, required_on_site_date?, sequence_no?}
// DELETE /api/fab/stages/[id] — delete a stage (its pieces + loads become unstaged)
// Supervisor/admin.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { logException } from '@/lib/fab-events-log'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { name?: string; required_on_site_date?: string | null; sequence_no?: number }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    patch.name = n
  }
  if (body.required_on_site_date !== undefined) patch.required_on_site_date = body.required_on_site_date
  if (body.sequence_no !== undefined) patch.sequence_no = body.sequence_no

  const admin = getSupabaseAdmin()

  // Snapshot the on-site date before the write — moving a date that was ALREADY
  // set (a promise to the install team) is a gatekeeper exception; setting one
  // for the first time is not.
  const { data: before } = await admin
    .from('fab_delivery_stages').select('fab_job_id, name, required_on_site_date').eq('id', id).maybeSingle()

  const { data, error } = await admin.from('fab_delivery_stages').update(patch).eq('id', id).select().single()
  if (error) {
    // Re-using a build-order number already held by another stage on this job.
    if (error.code === '23505') return NextResponse.json({ error: 'That build-order number is already used for this job.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  if (before && body.required_on_site_date !== undefined
      && before.required_on_site_date && before.required_on_site_date !== data.required_on_site_date) {
    await logException(admin, caller, {
      fab_job_id: before.fab_job_id, kind: 'onsite_date_changed',
      detail: { stage: before.name, from: before.required_on_site_date, to: data.required_on_site_date },
    })
  }
  return NextResponse.json({ stage: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const admin = getSupabaseAdmin()

  // Before deleting, check whether this stage holds any PROVEN (photographed)
  // pieces — deleting a stage full of proof is a gatekeeper exception.
  const { data: stage } = await admin
    .from('fab_delivery_stages').select('fab_job_id, name').eq('id', id).maybeSingle()
  const { data: stageMarks } = await admin
    .from('fab_marks').select('id, mark_id').eq('delivery_stage_id', id)
  let provenMarks: string[] = []
  if (stageMarks && stageMarks.length > 0) {
    const { data: madePhotos } = await admin
      .from('fab_proof_photos').select('fab_mark_id')
      .in('fab_mark_id', stageMarks.map(m => m.id)).eq('stage', 'made')
    const madeIds = new Set((madePhotos ?? []).map(p => p.fab_mark_id))
    provenMarks = stageMarks.filter(m => madeIds.has(m.id)).map(m => m.mark_id)
  }

  // fab_marks.delivery_stage_id + fab_dispatch_loads.delivery_stage_id are ON DELETE
  // SET NULL, so the pieces/loads simply become unstaged — nothing is lost.
  const { error } = await admin.from('fab_delivery_stages').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (stage && provenMarks.length > 0) {
    await logException(admin, caller, {
      fab_job_id: stage.fab_job_id, kind: 'stage_deleted_with_proof',
      detail: { stage: stage.name, proven_marks: provenMarks, proven_count: provenMarks.length },
    })
  }
  return NextResponse.json({ ok: true })
}
