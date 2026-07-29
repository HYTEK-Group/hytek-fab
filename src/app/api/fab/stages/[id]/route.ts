// PATCH  /api/fab/stages/[id] — edit a stage {name?, required_on_site_date?, sequence_no?}
// DELETE /api/fab/stages/[id] — delete a stage (its pieces + loads become unstaged)
// Supervisor/admin.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

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
  const { data, error } = await admin.from('fab_delivery_stages').update(patch).eq('id', id).select().single()
  if (error) {
    // Re-using a build-order number already held by another stage on this job.
    if (error.code === '23505') return NextResponse.json({ error: 'That build-order number is already used for this job.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
  return NextResponse.json({ stage: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  // fab_marks.delivery_stage_id + fab_dispatch_loads.delivery_stage_id are ON DELETE
  // SET NULL, so the pieces/loads simply become unstaged — nothing is lost.
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('fab_delivery_stages').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
