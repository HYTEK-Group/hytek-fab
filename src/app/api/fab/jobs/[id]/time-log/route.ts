// GET  /api/fab/jobs/[id]/time-log — list time entries for a job
// POST /api/fab/jobs/[id]/time-log — log worker hours

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser } from '@/lib/get-fab-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_time_entries')
    .select('*')
    .eq('fab_job_id', id)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = (await req.json()) as {
    worker_name: string
    hours: number
    work_date?: string
    note?: string
    task_id?: string | null
  }
  if (!body.worker_name?.trim() || !(body.hours > 0)) {
    return NextResponse.json({ error: 'worker_name and hours > 0 required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_time_entries')
    .insert({
      fab_job_id: id,
      worker_name: body.worker_name.trim(),
      hours: body.hours,
      work_date: body.work_date ?? new Date().toISOString().slice(0, 10),
      note: body.note ?? null,
      task_id: body.task_id ?? null,
      entered_by: user.email ?? user.fullName ?? user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data }, { status: 201 })
}
