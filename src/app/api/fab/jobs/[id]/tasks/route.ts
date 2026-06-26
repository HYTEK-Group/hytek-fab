// GET  /api/fab/jobs/[id]/tasks — list tasks for a job
// POST /api/fab/jobs/[id]/tasks — create a new task (supervisor only)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser, requireFabSupervisor } from '@/lib/get-fab-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_tasks')
    .select('*')
    .eq('fab_job_id', id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const body = (await req.json()) as { description: string; assigned_to?: string | null }
  if (!body.description?.trim()) {
    return NextResponse.json({ error: 'description required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_tasks')
    .insert({
      fab_job_id: id,
      description: body.description.trim(),
      assigned_to: body.assigned_to ?? null,
      status: 'open',
      created_by: user.email ?? user.fullName ?? user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}
