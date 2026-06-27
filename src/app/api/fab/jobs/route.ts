// GET  /api/fab/jobs — list all active fab jobs with task/time summaries
// POST /api/fab/jobs — start fabrication on a job (creates fab_jobs row)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser, requireFabSupervisor } from '@/lib/get-fab-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_jobs')
    .select(`
      *,
      fab_tasks(id, status),
      fab_time_entries(hours),
      fab_marks(id, status),
      fab_contractor_packages(id, status, package_type)
    `)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Summarise nested arrays into counts
  const jobs = (data ?? []).map((j: Record<string, unknown>) => {
    const tasks = (j.fab_tasks as Array<{ id: string; status: string }>) ?? []
    const marks = (j.fab_marks as Array<{ id: string; status: string }>) ?? []
    const timeEntries = (j.fab_time_entries as Array<{ hours: number }>) ?? []
    const packages = (j.fab_contractor_packages as Array<{ id: string; status: string; package_type: string }>) ?? []
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
    }
  })

  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })

  const body = (await req.json()) as {
    quote_number: string
    hubspot_deal_id?: string | null
    name: string
    client?: string | null
    on_site_date?: string | null
    cc_level?: string | null
  }

  if (!body.quote_number?.trim() || !body.name?.trim()) {
    return NextResponse.json({ error: 'quote_number and name required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Idempotent: if already exists, return existing
  const { data: existing } = await admin
    .from('fab_jobs')
    .select('*')
    .eq('quote_number', body.quote_number.trim())
    .maybeSingle()

  if (existing) return NextResponse.json({ job: existing, created: false })

  const { data, error } = await admin
    .from('fab_jobs')
    .insert({
      quote_number: body.quote_number.trim(),
      hubspot_deal_id: body.hubspot_deal_id ?? null,
      name: body.name.trim(),
      client: body.client ?? null,
      on_site_date: body.on_site_date ?? null,
      cc_level: body.cc_level ?? null,
      status: 'in_progress',
      compliance_mode: 'permissive',
      started_by: user.email ?? user.fullName ?? user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data, created: true }, { status: 201 })
}
