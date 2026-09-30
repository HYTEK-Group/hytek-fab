// PATCH /api/fab/waiting-tasks/[tid] — close, reopen or assign a Hub
// variation/rework task that is still waiting for its fab job. Same rules as
// PATCH /api/fab/jobs/[id]/tasks/[tid] (src/lib/fab-task-patch.ts), scoped to
// tasks with no fab_job_id so it can never reach an ordinary job task.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { applyTaskPatch, type TaskPatchBody } from '@/lib/fab-task-patch'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tid } = await params
  const body = (await req.json().catch(() => ({}))) as TaskPatchBody
  const res = await applyTaskPatch(getSupabaseAdmin(), caller, tid, body, { waiting: true })
  return NextResponse.json(res.body, { status: res.status })
}
