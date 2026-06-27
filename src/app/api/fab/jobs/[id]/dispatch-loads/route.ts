// GET  /api/fab/jobs/[id]/dispatch-loads — list loads + mark counts
// POST /api/fab/jobs/[id]/dispatch-loads — create the next-numbered load
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller, getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_dispatch_loads')
    .select('*, fab_marks(id)')
    .eq('fab_job_id', id)
    .order('load_number', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ loads: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as { description?: string | null; planned_date?: string | null }
  const admin = getSupabaseAdmin()

  // Next load_number = max(existing) + 1.
  const { data: existing } = await admin
    .from('fab_dispatch_loads')
    .select('load_number')
    .eq('fab_job_id', id)
    .order('load_number', { ascending: false })
    .limit(1)
  const nextNumber = (existing?.[0]?.load_number ?? 0) + 1

  const { data, error } = await admin
    .from('fab_dispatch_loads')
    .insert({
      fab_job_id: id,
      load_number: nextNumber,
      description: body.description ?? null,
      planned_date: body.planned_date ?? null,
      created_by: caller.name,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await computeAndUpsertProgress(id)
  return NextResponse.json({ load: data }, { status: 201 })
}
