// PATCH /api/fab/dispatch-loads/[id]
// body: { add?: string[], remove?: string[], dispatched?: bool, driver?, description?, planned_date? }
// add/remove: only qc_passed marks may join a load.
// dispatched: stamps dispatched_at.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndPublishProgress } from '@/lib/fab-progress'
import { sendFabEventLogged } from '@/lib/hub-events'
import { buildLoadDispatchedEvent } from '@/lib/hub-event-builders'

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
    .select('id, fab_job_id, load_number, description, driver, dispatched_at, fab_jobs(quote_number, hubspot_deal_id)')
    .eq('id', id)
    .single()
  if (loadErr || !load) return NextResponse.json({ error: 'Load not found' }, { status: 404 })

  // A load that has already gone cannot go again — the event's idempotency key
  // is fab_load:<quote>:<load_number>, so a second PATCH would be a duplicate
  // the Hub drops silently. Catching it here means the second dispatched_at
  // stamp does not overwrite the real one either.
  const alreadyDispatched = load.dispatched_at != null

  const patch: Record<string, unknown> = {}
  if (body.driver !== undefined) patch.driver = body.driver
  if (body.description !== undefined) patch.description = body.description
  if (body.planned_date !== undefined) patch.planned_date = body.planned_date
  if (body.dispatched === true && !alreadyDispatched) patch.dispatched_at = now
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

  // "A truck left" is a discrete fact, and until now the only way anyone could
  // learn it was to poll the progress rollup and diff dispatch_loads. The
  // Delivery Board and dispatch's fab-ready feed get a signal they can key on.
  if (body.dispatched === true && !alreadyDispatched) {
    const job = load.fab_jobs as unknown as { quote_number: string; hubspot_deal_id: string | null } | null
    const { count: marksCount } = await admin
      .from('fab_marks')
      .select('id', { count: 'exact', head: true })
      .eq('dispatch_load_id', id)
    if (job?.quote_number) {
      await sendFabEventLogged(
        admin,
        buildLoadDispatchedEvent({
          quoteNumber: job.quote_number,
          dealId: job.hubspot_deal_id,
          loadNumber: load.load_number as number,
          dispatchedAt: now,
          driver: (patch.driver as string | null | undefined) ?? (load.driver as string | null),
          marksCount: marksCount ?? 0,
          description: (patch.description as string | null | undefined) ?? (load.description as string | null),
        }),
        load.fab_job_id,
        caller.name,
      )
    }
  }

  await computeAndPublishProgress(load.fab_job_id)
  return NextResponse.json({ ok: true })
}
