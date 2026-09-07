// GET  /api/fab/jobs — list all active fab jobs with task/time summaries
// POST /api/fab/jobs — start fabrication on a job (creates fab_jobs row)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolveJobRef } from '@/lib/job-lookup'
import { getSupervisorCaller, getUserCaller } from '@/lib/fab-auth'
import { tonnageSummary } from '@/lib/fab-tonnage'
import { jobActionSummary } from '@/lib/fab-action-centre'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_jobs')
    .select(`
      *,
      fab_tasks(id, status),
      fab_time_entries(hours),
      fab_marks(id, status, weight_kg, quantity, dispatch_load_id),
      fab_contractor_packages(id, status, package_type, expected_return_date)
    `)
    .not('is_test', 'is', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Summarise nested arrays into counts
  const jobs = (data ?? []).map((j: Record<string, unknown>) => {
    const tasks = (j.fab_tasks as Array<{ id: string; status: string }>) ?? []
    const marks = (j.fab_marks as Array<{ id: string; status: string; weight_kg: number | null; quantity: number | null; dispatch_load_id: string | null }>) ?? []
    const timeEntries = (j.fab_time_entries as Array<{ hours: number }>) ?? []
    const packages = (j.fab_contractor_packages as Array<{ id: string; status: string; package_type: string; expected_return_date: string | null }>) ?? []
    const tonnage = tonnageSummary(marks)
    const action = jobActionSummary(marks, packages, new Date().toISOString().slice(0, 10))
    return {
      ...j,
      fab_tasks: undefined,
      fab_marks: undefined,
      fab_time_entries: undefined,
      fab_contractor_packages: undefined,
      task_count: tasks.length,
      task_done: tasks.filter(t => t.status === 'done').length,
      mark_count: marks.length,
      mark_done: marks.filter(m => m.status === 'done' || m.status === 'qc_passed').length,
      total_hours: timeEntries.reduce((s, e) => s + (e.hours ?? 0), 0),
      has_active_packages: packages.some(p => p.status === 'sent' || p.status === 'in_progress'),
      // Tonnage-weighted progress (weight × qty; "made" = done|qc_passed).
      total_kg: tonnage.total_kg,
      made_kg: tonnage.made_kg,
      tonnage_pct: tonnage.pct,
      marks_missing_weight: tonnage.missing_weight,
      // Action Centre rollups (cross-job "what needs me").
      qc_waiting: action.qc_waiting,
      dispatch_ready: action.dispatch_ready,
      packages_out: action.packages_out,
      packages_overdue: action.packages_overdue,
    }
  })

  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest) {
  // getSupervisorCaller, NOT requireFabSupervisor: the latter accepts only a
  // Supabase JWT, and the office-server ingest bridge authenticates with a kiosk
  // token like every other route it calls (/import-assembly, /import-bom). With
  // requireFabSupervisor here the bridge could not create a job at all — it got
  // 403 and fell back to writing fab_jobs with the service-role key, which is
  // exactly the door this checkpoint closes.
  const user = await getSupervisorCaller(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })

  const body = (await req.json()) as {
    quote_number: string
    hubspot_deal_id?: string | null
    name: string
    client?: string | null
    on_site_date?: string | null
    cc_level?: string | null
  }

  if (!body.quote_number?.trim()) {
    return NextResponse.json({ error: 'quote_number required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // ONLY THE HUB ISSUES JOB NUMBERS. This route used to insert a fab_jobs row
  // from whatever the body carried — so a typo, or the ingest bridge handing it
  // a whole folder name, created a job that existed in exactly one database and
  // reconciled with nothing. An unknown number is refused; a legacy HG or
  // 7-digit reference is resolved to the canonical number first.
  const resolved = await resolveJobRef(admin, body.quote_number)
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: resolved.reason === 'test'
          ? `${body.quote_number.trim()} is a test job — fab never fabricates one`
          : `Unknown job number "${body.quote_number.trim()}" — jobs are created in the Hub first`,
        reason: resolved.reason,
      },
      { status: 422 },
    )
  }
  const shared = resolved.job

  // Idempotent: if already exists, return existing. Keyed on the CANONICAL
  // number, so starting the same job twice under two of its names is one job.
  const { data: existing } = await admin
    .from('fab_jobs')
    .select('*')
    .eq('quote_number', shared.quote_number)
    .maybeSingle()

  if (existing) return NextResponse.json({ job: existing, created: false, matched_by: resolved.matchedBy })

  const { data, error } = await admin
    .from('fab_jobs')
    .insert({
      // The Hub's values, never the caller's. The name typed into Start
      // Fabrication is ignored: the Hub is the source of a job's name, and two
      // apps disagreeing about what a job is called is how a reconciliation
      // report becomes unreadable.
      quote_number: shared.quote_number,
      hubspot_deal_id: shared.hubspot_deal_id,
      name: shared.name ?? body.name?.trim() ?? shared.quote_number,
      client: shared.client,
      on_site_date: body.on_site_date ?? null,
      cc_level: body.cc_level ?? null,
      status: 'in_progress',
      // permissive by decision 2026-09; strict mode is a Scott switch, not a
      // code default (07-fab.md §7).
      compliance_mode: 'permissive',
      started_by: user.name,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data, created: true, matched_by: resolved.matchedBy }, { status: 201 })
}
