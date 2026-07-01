// POST /api/fab/jobs/[id]/assign — assign a worker + an allotted time to one or
// more assemblies. Body: { mark_ids: string[], assigned_to, allotted_minutes,
// suggested_minutes? }. suggested_minutes is stored so we can measure how far the
// suggestion was off (the learning signal). Scoped to this job's marks.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    mark_ids?: string[]; assigned_to?: string | null; allotted_minutes?: number; suggested_minutes?: number | null
  }

  const markIds = Array.isArray(body.mark_ids) ? body.mark_ids.filter(x => typeof x === 'string') : []
  if (markIds.length === 0) return NextResponse.json({ error: 'mark_ids required' }, { status: 400 })
  const worker = body.assigned_to === null ? null : String(body.assigned_to ?? '').trim()
  if (worker !== null && !worker) return NextResponse.json({ error: 'assigned_to required (or null to unassign)' }, { status: 400 })
  const allotted = body.allotted_minutes == null ? null : Math.max(0, Math.round(Number(body.allotted_minutes)))
  if (worker && (allotted == null || allotted <= 0)) {
    return NextResponse.json({ error: 'allotted_minutes must be > 0' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_marks')
    .update({
      assigned_to: worker,
      allotted_minutes: worker ? allotted : null,
      suggested_minutes: worker ? (body.suggested_minutes ?? null) : null,
      assigned_at: worker ? new Date().toISOString() : null,
    })
    .eq('fab_job_id', id)      // never touch another job's marks
    .in('id', markIds)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, assigned: (data ?? []).length, assigned_to: worker, allotted_minutes: allotted })
}
