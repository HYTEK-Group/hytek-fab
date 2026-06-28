// GET  /api/fab/jobs/[id]/tasks/[tid]/marks — mark ids this task covers
// POST /api/fab/jobs/[id]/tasks/[tid]/marks — { add?: string[], remove?: string[] }
// Links marks to a task so tonnage rolls up per task (the productivity matrix).
// Both the task and the marks are verified to belong to the job in the URL.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller, getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

async function taskInJob(admin: ReturnType<typeof getSupabaseAdmin>, jobId: string, taskId: string) {
  const { data } = await admin.from('fab_tasks').select('id').eq('id', taskId).eq('fab_job_id', jobId).maybeSingle()
  return !!data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, tid } = await params
  const admin = getSupabaseAdmin()
  if (!(await taskInJob(admin, id, tid))) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const { data, error } = await admin.from('fab_task_marks').select('mark_id').eq('task_id', tid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mark_ids: (data ?? []).map(r => r.mark_id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id, tid } = await params
  const body = (await req.json()) as { add?: string[]; remove?: string[] }
  const admin = getSupabaseAdmin()
  if (!(await taskInJob(admin, id, tid))) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (body.add?.length) {
    // Only marks that belong to THIS job may be linked.
    const { data: valid } = await admin.from('fab_marks').select('id').eq('fab_job_id', id).in('id', body.add)
    const rows = (valid ?? []).map(m => ({ task_id: tid, mark_id: m.id }))
    if (rows.length) {
      const { error } = await admin.from('fab_task_marks').upsert(rows, { onConflict: 'task_id,mark_id', ignoreDuplicates: true })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }
  if (body.remove?.length) {
    const { error } = await admin.from('fab_task_marks').delete().eq('task_id', tid).in('mark_id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
