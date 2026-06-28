// GET  /api/fab/jobs/[id]/tasks — tasks for a job, enriched with the productivity
//                                 matrix (allotted vs actual hours, tonnes, t/hr)
// POST /api/fab/jobs/[id]/tasks — create a task (supervisor only)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser, requireFabSupervisor } from '@/lib/get-fab-user'
import { buildTaskMatrix } from '@/lib/fab-task-matrix'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()

  const { data: tasks, error } = await admin
    .from('fab_tasks')
    .select('*')
    .eq('fab_job_id', id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const taskList = (tasks ?? []) as Array<Record<string, unknown>>
  const taskIds = taskList.map(t => t.id as string)

  // Actual hours per task (in-house time entries attributed to a task).
  const hoursByTask: Record<string, number> = {}
  if (taskIds.length) {
    const { data: te } = await admin
      .from('fab_time_entries')
      .select('task_id, hours')
      .eq('fab_job_id', id)
      .not('task_id', 'is', null)
    for (const e of (te ?? []) as Array<{ task_id: string; hours: number }>) {
      hoursByTask[e.task_id] = (hoursByTask[e.task_id] ?? 0) + (e.hours ?? 0)
    }
  }

  // Tonnes + linked-mark count per task (weight × qty of the marks the task covers).
  const tonnesByTask: Record<string, number> = {}
  const marksByTask: Record<string, number> = {}
  if (taskIds.length) {
    const { data: tm } = await admin
      .from('fab_task_marks')
      .select('task_id, fab_marks(weight_kg, quantity)')
      .in('task_id', taskIds)
    for (const r of (tm ?? []) as Array<{ task_id: string; fab_marks: { weight_kg: number | null; quantity: number | null } | { weight_kg: number | null; quantity: number | null }[] | null }>) {
      const m = Array.isArray(r.fab_marks) ? r.fab_marks[0] : r.fab_marks
      const kg = (m?.weight_kg ?? 0) * (m?.quantity ?? 1)
      tonnesByTask[r.task_id] = (tonnesByTask[r.task_id] ?? 0) + kg / 1000
      marksByTask[r.task_id] = (marksByTask[r.task_id] ?? 0) + 1
    }
  }

  const matrix = buildTaskMatrix(taskList.map(t => ({
    id: t.id as string,
    description: (t.description as string) ?? '',
    estimated_hours: (t.estimated_hours as number | null) ?? null,
    actual_hours: hoursByTask[t.id as string] ?? 0,
    tonnes: tonnesByTask[t.id as string] ?? 0,
  })))
  const byId = Object.fromEntries(matrix.tasks.map(r => [r.id, r]))

  const enriched = taskList.map(t => ({
    ...t,
    ...byId[t.id as string],
    linked_marks: marksByTask[t.id as string] ?? 0,
  }))

  return NextResponse.json({
    tasks: enriched,
    matrix_totals: {
      total_estimated: matrix.total_estimated,
      total_actual: matrix.total_actual,
      total_tonnes: matrix.total_tonnes,
      tonnes_per_hour: matrix.tonnes_per_hour,
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const body = (await req.json()) as {
    description: string
    assigned_to?: string | null
    estimated_hours?: number | null
    due_on?: string | null
  }
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
      estimated_hours: body.estimated_hours ?? null,
      due_on: body.due_on ?? null,
      status: 'open',
      created_by: user.email ?? user.fullName ?? user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}
