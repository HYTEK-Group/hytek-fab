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
} from '@/lib/fab-dispatch-feed'

export const dynamic = 'force-dynamic'

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
  const { data: jobs, error } = await admin
    .from('fab_jobs')
    .select('id, quote_number, hubspot_deal_id, name, on_site_date, dispatch_requested_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobIds = (jobs ?? []).map(j => j.id)
  if (jobIds.length === 0) return NextResponse.json({ configured: true, jobs: [] })

  const [{ data: loads }, { data: marks }] = await Promise.all([
    admin.from('fab_dispatch_loads')
      .select('id, fab_job_id, load_number, description, planned_date, dispatched_at, driver')
      .in('fab_job_id', jobIds),
    admin.from('fab_marks')
      .select('fab_job_id, mark_id, section, weight_kg, quantity, status, dispatch_load_id')
      .in('fab_job_id', jobIds),
  ])

  const feed = buildDispatchFeed(
    (jobs ?? []) as DispatchFeedJob[],
    (loads ?? []) as DispatchFeedLoad[],
    (marks ?? []) as DispatchFeedMark[],
  )

  return NextResponse.json({ configured: true, jobs: feed })
}
