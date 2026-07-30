// GET /api/fab/kiosk/my-work — kiosk session (Bearer = kiosk token).
// Returns this worker's open tasks + in-house marks (contractor marks excluded).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { verifyKioskToken } from '@/lib/fab-kiosk-token'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '').trim() ?? ''
  const session = verifyKioskToken(token)
  if (!session) return NextResponse.json({ error: 'Invalid kiosk session' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const name = session.worker_name

  const { data: tasks, error: taskErr } = await admin
    .from('fab_tasks')
    .select('id, fab_job_id, description, status, fab_jobs(id, name, quote_number, is_test)')
    .eq('assigned_to', name)
    .neq('status', 'done')
    .order('created_at', { ascending: true })
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 })

  const { data: marks, error: markErr } = await admin
    .from('fab_marks')
    .select('id, fab_job_id, mark_id, description, status, fab_jobs(id, name, quote_number, is_test)')
    .eq('assigned_to', name)
    .is('contractor_package_id', null)
    .in('status', ['not_started', 'in_progress'])
    .order('mark_id', { ascending: true })
  if (markErr) return NextResponse.json({ error: markErr.message }, { status: 500 })

  return NextResponse.json({
    worker_name: name,
    role: session.role,
    tasks: (tasks ?? []).filter((t) => (t as { fab_jobs?: { is_test?: boolean } }).fab_jobs?.is_test !== true),
    marks: (marks ?? []).filter((m) => (m as { fab_jobs?: { is_test?: boolean } }).fab_jobs?.is_test !== true),
  })
}
