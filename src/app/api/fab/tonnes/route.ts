// POST /api/fab/tonnes — submit weekly tonnes per job
//
// Writes per-job rows to fab_weekly_entries (fab's own record) and then tells
// the Hub, one `fab_tonnes` event PER JOB.
//
// It used to also INSERT the week's total straight into `flow_fab_entries` —
// the Hub's own table, whose CREATE lives in hytek-hub/sql/flow/008-fab-weekly.sql
// and which no fab migration has ever owned. The Hub writes that row now, from
// these events. Every event carries `week_total_tonnes` and `jobs_in_week`, so
// the Hub can write the weekly total row from the FIRST event of a submit
// without waiting to see the last one — the board's heartbeat keeps its shape
// even if a later event in the batch fails to send.
//
// Per-job rather than one total: the Hub requires a real quote number on an
// event, and a week total belongs to no single job. Sending per job also gives
// the Hub the breakdown it never had. (07-fab.md §7 "Tonnes granularity",
// Scott's stated default — recorded here, not asked again.)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabSupervisor } from '@/lib/get-fab-user'
import { sendFabEventLogged, summariseSends, type SendResult } from '@/lib/hub-events'
import { buildTonnesEvent } from '@/lib/hub-event-builders'

export const dynamic = 'force-dynamic'

interface JobEntry {
  fab_job_id: string
  quote_number: string
  tonnes: number
  hours?: number | null
  note?: string | null
}

export async function POST(req: NextRequest) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })

  const body = (await req.json()) as { week_start: string; entries: JobEntry[] }
  if (!body.week_start || !Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: 'week_start and entries[] required' }, { status: 400 })
  }

  // Validate week_start is a Monday (isodow = 1)
  const d = new Date(body.week_start)
  if (isNaN(d.getTime()) || d.getUTCDay() !== 1) {
    return NextResponse.json({ error: 'week_start must be a Monday (YYYY-MM-DD)' }, { status: 400 })
  }

  const enteredBy = user.email ?? user.fullName ?? user.id
  const admin = getSupabaseAdmin()

  // Write per-job entries to fab_weekly_entries
  const fabRows = body.entries.map(e => ({
    fab_job_id: e.fab_job_id,
    quote_number: e.quote_number,
    week_start: body.week_start,
    tonnes: e.tonnes,
    hours: e.hours ?? null,
    note: e.note ?? null,
    entered_by: enteredBy,
  }))

  const { error: fabErr } = await admin.from('fab_weekly_entries').insert(fabRows)
  if (fabErr) return NextResponse.json({ error: fabErr.message }, { status: 500 })

  // fab's own record is safe. Everything below is the Hub feed, and NONE of it
  // may fail the submit: the supervisor has entered the week's tonnes and that
  // is recorded. A Hub that is down is an exception on the Exceptions screen,
  // not a lost Friday afternoon.
  const totalTonnes = body.entries.reduce((s, e) => s + (e.tonnes ?? 0), 0)
  const createdAtMs = Date.now()
  const occurredAt = new Date(createdAtMs).toISOString()

  // One read for the deal ids rather than one per entry.
  const { data: jobRows } = await admin
    .from('fab_jobs')
    .select('id, hubspot_deal_id')
    .in('id', body.entries.map(e => e.fab_job_id))
  const dealIdByJob = new Map((jobRows ?? []).map(j => [j.id as string, j.hubspot_deal_id as string | null]))

  const results: SendResult[] = []
  for (const e of body.entries) {
    results.push(
      await sendFabEventLogged(
        admin,
        buildTonnesEvent({
          quoteNumber: e.quote_number,
          dealId: dealIdByJob.get(e.fab_job_id) ?? null,
          weekStart: body.week_start,
          tonnes: e.tonnes,
          hours: e.hours ?? null,
          note: e.note ?? null,
          enteredBy,
          weekTotalTonnes: totalTonnes,
          jobsInWeek: body.entries.length,
          createdAtMs,
          occurredAt,
        }),
        e.fab_job_id,
        enteredBy,
      ),
    )
  }

  return NextResponse.json({
    ok: true,
    total_tonnes: totalTonnes,
    jobs: body.entries.length,
    hub: summariseSends(results),
  })
}

export async function GET(req: NextRequest) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') ?? '20')

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_weekly_entries')
    .select('*, fab_jobs(name, client, is_test)')
    .order('week_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Drop test-job entries (fleet clean-up 28/07).
  const entries = (data ?? []).filter((e) => (e as { fab_jobs?: { is_test?: boolean } }).fab_jobs?.is_test !== true)
  return NextResponse.json({ entries })
}
