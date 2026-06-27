// GET   /api/fab/jobs/[id]/marks — list marks for a job
// POST  /api/fab/jobs/[id]/marks — add a mark (supervisor, manual entry or bulk)
// PATCH /api/fab/jobs/[id]/marks — bulk status update for multiple marks

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabSupervisor } from '@/lib/get-fab-user'
import { getUserCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'
import type { MarkStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_marks')
    .select('*')
    .eq('fab_job_id', id)
    .order('mark_id', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ marks: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const body = (await req.json()) as {
    mark_id: string
    description?: string
    section?: string
    length_mm?: number
    weight_kg?: number
    quantity?: number
  }
  if (!body.mark_id?.trim()) return NextResponse.json({ error: 'mark_id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_marks')
    .upsert({
      fab_job_id: id,
      mark_id: body.mark_id.trim().toUpperCase(),
      description: body.description ?? null,
      section: body.section ?? null,
      length_mm: body.length_mm ?? null,
      weight_kg: body.weight_kg ?? null,
      quantity: body.quantity ?? 1,
      status: 'not_started',
    }, { onConflict: 'fab_job_id,mark_id', ignoreDuplicates: false })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await computeAndUpsertProgress(id)
  return NextResponse.json({ mark: data }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = (await req.json()) as { mark_ids: string[]; status: MarkStatus; note?: string }
  const validStatuses: MarkStatus[] =
    ['not_started', 'in_progress', 'done', 'at_contractor', 'returned', 'qc_passed']
  if (!body.mark_ids?.length || !validStatuses.includes(body.status)) {
    return NextResponse.json({ error: 'mark_ids[] and valid status required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_marks')
    .update({ status: body.status, note: body.note ?? null, updated_at: new Date().toISOString() })
    .eq('fab_job_id', id)
    .in('id', body.mark_ids)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await computeAndUpsertProgress(id)
  return NextResponse.json({ marks: data })
}
