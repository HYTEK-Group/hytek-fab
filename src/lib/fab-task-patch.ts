// Server only. One task update, shared by the two doors that change a fab task:
//   PATCH /api/fab/jobs/[id]/tasks/[tid]   — a task on a started fab job
//   PATCH /api/fab/waiting-tasks/[tid]     — a Hub variation/rework task still
//                                            waiting for its fab job (017)
//
// 30/09/2026: when a Hub variation/rework task is set to 'done' here, the same
// write stamps work_item_done_owed_at and the Hub is told (src/lib/work-item-done.ts).
// Setting it back to open/in_progress clears any debt not yet sent.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallerInfo } from './fab-auth'
import type { TaskStatus } from './types'
import { flushOwedWorkItems, workItemOf } from './work-item-done'

export interface TaskPatchBody {
  status?: TaskStatus
  assigned_to?: string | null
  estimated_hours?: number | null
  due_on?: string | null
}

export async function applyTaskPatch(
  admin: SupabaseClient,
  caller: CallerInfo,
  taskId: string,
  body: TaskPatchBody,
  scope: { fabJobId: string } | { waiting: true },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (body.status) {
    const valid: TaskStatus[] = ['open', 'in_progress', 'done']
    if (!valid.includes(body.status)) return { status: 400, body: { error: 'invalid status' } }
    patch.status = body.status
    patch.completed_at = body.status === 'done' ? now : null
    // Reopened before the Hub heard: nothing is owed any more.
    if (body.status !== 'done') patch.work_item_done_owed_at = null
  }
  if ('assigned_to' in body) patch.assigned_to = body.assigned_to
  // Allotted hours / due date are the supervisor's locked expectation — only
  // supervisor/admin may change them (a fabricator can still tick status/assign).
  const isSup = caller.role === 'supervisor' || caller.role === 'admin'
  if (isSup && 'estimated_hours' in body) patch.estimated_hours = body.estimated_hours
  if (isSup && 'due_on' in body) patch.due_on = body.due_on

  let q = admin.from('fab_tasks').update(patch).eq('id', taskId)
  q = 'fabJobId' in scope ? q.eq('fab_job_id', scope.fabJobId) : q.is('fab_job_id', null)
  const { data, error } = await q.select().single()
  if (error) return { status: 500, body: { error: error.message } }

  const task = data as { id: string; status: string; completed_at: string | null; variation_id?: string | null; rework_id?: string | null }
  if (body.status === 'done' && workItemOf(task)) {
    const { error: owedErr } = await admin
      .from('fab_tasks')
      .update({ work_item_done_owed_at: task.completed_at ?? now })
      .eq('id', task.id)
    if (owedErr) {
      console.error(`[work-item-done] could not stamp fab_task ${task.id} as owed: ${owedErr.message}`)
    } else {
      // Awaited so the send is not cut off when the response goes, but a Hub
      // failure never fails the close: it stays owed and goes on the next flush.
      await flushOwedWorkItems(admin, { logFor: task.id, actor: caller.name })
    }
  }
  return { status: 200, body: { task: data } }
}
