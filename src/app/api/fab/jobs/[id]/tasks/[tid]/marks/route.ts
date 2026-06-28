// GET  /api/fab/jobs/[id]/tasks/[tid]/marks — mark ids this task covers
// POST /api/fab/jobs/[id]/tasks/[tid]/marks — { add?: string[], remove?: string[] }
// Links marks to a task so tonnage rolls up per task (the productivity matrix).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller, getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tid } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('fab_task_marks').select('mark_id').eq('task_id', tid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mark_ids: (data ?? []).map(r => r.mark_id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { tid } = await params
  const body = (await req.json()) as { add?: string[]; remove?: string[] }
  const admin = getSupabaseAdmin()

  if (body.add?.length) {
    const rows = body.add.map(mark_id => ({ task_id: tid, mark_id }))
    const { error } = await admin.from('fab_task_marks').upsert(rows, { onConflict: 'task_id,mark_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.remove?.length) {
    const { error } = await admin.from('fab_task_marks').delete().eq('task_id', tid).in('mark_id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
