// GET /api/fab/bridge/dispatch — READ-ONLY cross-app feed for the dispatch/driver
// app: every dispatch-relevant fab job with its loads + marks (and QC-passed marks
// not yet on a load), so the dispatcher can build truck loads and sequence by
// on-site date. Mirrors the LWS factory bridge pattern.
//
// Auth: a dedicated shared token FAB_BRIDGE_TOKEN (least-privilege, read-only).
// If the env var is unset we return {configured:false} (no data) rather than 500 —
// the dispatch app can detect "not wired yet" honestly. The dispatch app must NEVER
// write fab tables; it keeps its own dispatched/delivered status and fires the
// Hub 'delivered' event for invoicing.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  buildDispatchFeed,
  type DispatchFeedJob, type DispatchFeedLoad, type DispatchFeedMark,
  type DispatchFeedPackage, type DispatchFeedStage,
} from '@/lib/fab-dispatch-feed'

export const dynamic = 'force-dynamic'

type Page<T> = { data: T[] | null; error: { message: string } | null }

/** Read every row, paging past PostgREST's default max-rows cap (≈1000) so a
 *  large shop history can't silently truncate the feed. Caller supplies a stable
 *  order in `make` so pages don't drop/duplicate rows. */
async function pageAll<T>(make: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const SIZE = 1000
  const out: T[] = []
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await make(from, from + SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < SIZE) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const token = process.env.FAB_BRIDGE_TOKEN
  if (!token) {
    return NextResponse.json({ configured: false, reason: 'FAB_BRIDGE_TOKEN not set', jobs: [] })
  }
  const auth = req.headers.get('authorization') ?? ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (presented !== token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  let jobs: DispatchFeedJob[], loads: DispatchFeedLoad[], marks: DispatchFeedMark[]
  let packages: DispatchFeedPackage[], stages: DispatchFeedStage[]
  try {
    // Active jobs only — drop fully-dispatched history (keeps the working set,
    // and the marks query below, well under the row cap).
    jobs = await pageAll<DispatchFeedJob>((f, t) => admin.from('fab_jobs')
      .select('id, quote_number, hubspot_deal_id, name, on_site_date, dispatch_requested_at')
      .neq('status', 'dispatched')
      .order('id').range(f, t))
    const jobIds = jobs.map(j => j.id)
    if (jobIds.length === 0) return NextResponse.json({ configured: true, jobs: [] })

    ;[loads, marks, packages, stages] = await Promise.all([
      pageAll<DispatchFeedLoad>((f, t) => admin.from('fab_dispatch_loads')
        .select('id, fab_job_id, load_number, description, planned_date, dispatched_at, driver')
        .in('fab_job_id', jobIds).order('id').range(f, t)),
      pageAll<DispatchFeedMark>((f, t) => admin.from('fab_marks')
        .select('fab_job_id, mark_id, section, weight_kg, quantity, status, dispatch_load_id, contractor_package_id, delivery_stage_id')
        .in('fab_job_id', jobIds).order('fab_job_id').order('mark_id').range(f, t)),
      pageAll<DispatchFeedPackage>((f, t) => admin.from('fab_contractor_packages')
        .select('id, fab_job_id, contractor_name, contractor_contact, delivery_mode, drop_ship_released_at')
        .in('fab_job_id', jobIds).order('id').range(f, t)),
      pageAll<DispatchFeedStage>((f, t) => admin.from('fab_delivery_stages')
        .select('id, fab_job_id, stage_ref, name, required_on_site_date, sequence_no')
        .in('fab_job_id', jobIds).order('id').range(f, t)),
    ])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const feed = buildDispatchFeed(jobs, loads, marks, packages, stages)

  return NextResponse.json({ configured: true, jobs: feed })
}
