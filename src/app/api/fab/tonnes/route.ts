// POST /api/fab/tonnes — submit weekly tonnes per job
// Writes per-job rows to fab_weekly_entries (fab's own record).
// ALSO writes the week's TOTAL as one row to flow_fab_entries (Hub's SS feed).
// Hub's reader (fab-weeks.ts) continues unchanged — it reads the total row only.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabSupervisor } from '@/lib/get-fab-user'

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

  // Write the week's TOTAL to flow_fab_entries (Hub's existing SS tonnes feed).
  // Append-only: latest row per week wins in Hub's reader — same contract as today.
  const totalTonnes = body.entries.reduce((s, e) => s + (e.tonnes ?? 0), 0)

  const { error: flowErr } = await admin.from('flow_fab_entries').insert({
    week_start: body.week_start,
    tonnes: totalTonnes,
    note: `Submitted by ${enteredBy} — ${body.entries.length} job(s)`,
    entered_by: enteredBy,
  })
  if (flowErr) return NextResponse.json({ error: `flow_fab_entries: ${flowErr.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, total_tonnes: totalTonnes, jobs: body.entries.length })
}

export async function GET(req: NextRequest) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') ?? '20')

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_weekly_entries')
    .select('*, fab_jobs(name, client)')
    .order('week_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}
