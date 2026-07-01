// POST /api/fab/marks/[id]/work — the floor captures real time on an assembly.
// Body: { action: 'start' | 'done' }. start → started_at + in_progress; done →
// finished_at + actual_minutes (measured from Start) + done. actual_minutes is
// the ground truth the time-learning uses. A fabricator can only touch their own
// assigned assembly; a supervisor/admin can touch any.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { action } = (await req.json().catch(() => ({}))) as { action?: string }
  if (action !== 'start' && action !== 'done') {
    return NextResponse.json({ error: "action must be 'start' or 'done'" }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: mark } = await admin
    .from('fab_marks')
    .select('id, fab_job_id, assigned_to, started_at, allotted_minutes, contractor_package_id')
    .eq('id', id).single()
  if (!mark) return NextResponse.json({ error: 'Assembly not found' }, { status: 404 })

  const isSup = caller.role === 'supervisor' || caller.role === 'admin'
  if (!isSup && mark.assigned_to !== caller.name) {
    return NextResponse.json({ error: 'Not your assembly' }, { status: 403 })
  }
  if (mark.contractor_package_id) {
    return NextResponse.json({ error: 'This assembly is out with a contractor' }, { status: 409 })
  }

  const now = new Date()
  let patch: Record<string, unknown>
  if (action === 'start') {
    patch = { started_at: now.toISOString(), status: 'in_progress' }
  } else {
    const started = mark.started_at ? Date.parse(mark.started_at as string) : NaN
    const measured = Number.isFinite(started) ? Math.max(1, Math.round((now.getTime() - started) / 60000)) : null
    patch = {
      finished_at: now.toISOString(),
      actual_minutes: measured ?? (mark.allotted_minutes as number | null) ?? null,
      status: 'done',
    }
  }

  const { error } = await admin.from('fab_marks').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await computeAndUpsertProgress(mark.fab_job_id as string)
  return NextResponse.json({ ok: true, action, ...patch })
}
