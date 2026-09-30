// PATCH /api/fab/jobs/[id]/tasks/[tid] — update task status or assignment

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import type { TaskStatus } from '@/lib/types'
import { applyTaskPatch } from '@/lib/fab-task-patch'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tid: string }> }
) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, tid } = await params

  const body = (await req.json()) as {
    status?: TaskStatus
    assigned_to?: string | null
    estimated_hours?: number | null
    due_on?: string | null
  }

  const res = await applyTaskPatch(getSupabaseAdmin(), caller, tid, body, { fabJobId: id })
  return NextResponse.json(res.body, { status: res.status })
}
