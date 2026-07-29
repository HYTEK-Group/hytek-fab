// POST /api/fab/jobs/[id]/dispatch — mark job fabrication complete + alert dispatch
// Sets fab_complete_at + dispatch_requested_at on the fab_job row.
// Dispatch app reads dispatch_requested_at to know steel is ready for collection.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabSupervisor } from '@/lib/get-fab-user'
import { computeCompleteness } from '@/lib/fab-completeness'
import { logException } from '@/lib/fab-events-log'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const now = new Date().toISOString()
  const admin = getSupabaseAdmin()
  const body = (await req.json().catch(() => ({}))) as { override?: boolean; reason?: string }

  // ── Completeness gate: can't alert dispatch until every piece has a made photo.
  // Names the missing pieces so the floor finds them before the truck. Marks
  // made by a subcontractor carry their own 'made' photo, so they count.
  const [marksRes, photosRes] = await Promise.all([
    admin.from('fab_marks').select('id, mark_id').eq('fab_job_id', id),
    admin.from('fab_proof_photos').select('fab_mark_id, stage').eq('fab_job_id', id),
  ])
  // Fail on a real DB fault (500) — never mistake it for a completeness gap (409).
  if (marksRes.error) return NextResponse.json({ error: marksRes.error.message }, { status: 500 })
  if (photosRes.error) return NextResponse.json({ error: photosRes.error.message }, { status: 500 })

  const completeness = computeCompleteness(marksRes.data ?? [], photosRes.data ?? [])
  if (!completeness.ready) {
    // A supervisor can consciously override with a reason (e.g. an in-flight job
    // that predates the photo rule). The override is LOGGED as an append-only
    // audit event — it's an exception on the record, not a silent bypass.
    const reason = (body.reason ?? '').trim()
    if (body.override === true && reason) {
      // Stamp the raiser's namespaced identity (Supabase login) so the four-eyes
      // clear can tell people apart — see fab-gatekeeper.sameHuman.
      const { error: logErr } = await logException(
        admin,
        { name: user.fullName ?? user.email ?? user.id, key: `sb:${user.id}`, ns: 'supabase' },
        {
          fab_job_id: id, kind: 'dispatch_override',
          detail: { missing_marks: completeness.missing_marks, total: completeness.total, reason },
        },
      )
      // Fail CLOSED: the logged override IS the justification to ship un-photographed
      // steel. If we can't record it, we don't allow it.
      if (logErr) return NextResponse.json({ error: 'Could not record the override — not dispatched.' }, { status: 500 })
    } else {
      return NextResponse.json(
        { error: 'Not every piece is photographed yet', ...completeness },
        { status: 409 },
      )
    }
  }

  const { data, error } = await admin
    .from('fab_jobs')
    .update({
      status: 'complete',
      fab_complete_at: now,
      dispatch_requested_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data })
}
