// PATCH /api/fab/dispatch-loads/[id]
// body: { add?: string[], remove?: string[], dispatched?: bool, driver?, description?, planned_date? }
// add/remove: only qc_passed marks may join a load.
// dispatched: stamps dispatched_at.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as {
    add?: string[]; remove?: string[]; dispatched?: boolean
    driver?: string | null; description?: string | null; planned_date?: string | null
  }
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: load, error: loadErr } = await admin
    .from('fab_dispatch_loads')
    .select('id, fab_job_id')
    .eq('id', id)
    .single()
  if (loadErr || !load) return NextResponse.json({ error: 'Load not found' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body.driver !== undefined) patch.driver = body.driver
  if (body.description !== undefined) patch.description = body.description
  if (body.planned_date !== undefined) patch.planned_date = body.planned_date
  if (body.dispatched === true) patch.dispatched_at = now
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('fab_dispatch_loads').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Only qc_passed marks may be assigned to a load.
  if (body.add?.length) {
    const { error } = await admin
      .from('fab_marks')
      .update({ dispatch_load_id: id, updated_at: now })
      .eq('fab_job_id', load.fab_job_id)
      .eq('status', 'qc_passed')
      .in('id', body.add)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.remove?.length) {
    const { error } = await admin
      .from('fab_marks')
      .update({ dispatch_load_id: null, updated_at: now })
      .eq('dispatch_load_id', id)
      .in('id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await computeAndUpsertProgress(load.fab_job_id)
  return NextResponse.json({ ok: true })
}
