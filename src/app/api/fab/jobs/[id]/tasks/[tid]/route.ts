// PATCH /api/fab/jobs/[id]/tasks/[tid] — update task status or assignment

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import type { TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tid: string }> }
) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, tid } = await params

  const body = (await req.json()) as { status?: TaskStatus; assigned_to?: string | null }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status) {
    const valid: TaskStatus[] = ['open', 'in_progress', 'done']
    if (!valid.includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    patch.status = body.status
    if (body.status === 'done') patch.completed_at = new Date().toISOString()
    if (body.status !== 'done') patch.completed_at = null
  }
  if ('assigned_to' in body) patch.assigned_to = body.assigned_to

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_tasks')
    .update(patch)
    .eq('id', tid)
    .eq('fab_job_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
