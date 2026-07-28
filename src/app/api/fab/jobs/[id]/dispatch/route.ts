// POST /api/fab/jobs/[id]/dispatch — mark job fabrication complete + alert dispatch
// Sets fab_complete_at + dispatch_requested_at on the fab_job row.
// Dispatch app reads dispatch_requested_at to know steel is ready for collection.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabSupervisor } from '@/lib/get-fab-user'
import { computeCompleteness } from '@/lib/fab-completeness'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireFabSupervisor(req)
  if (!user) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const now = new Date().toISOString()
  const admin = getSupabaseAdmin()

  // ── Completeness gate: can't alert dispatch until every piece has a made photo.
  // Names the missing pieces so the floor finds them before the truck. Marks that
  // are out with / made by a subcontractor carry their own 'made' photo, so they
  // count. (A logged supervisor override is a separate, audited action — W4.)
  const [{ data: gateMarks }, { data: gatePhotos }] = await Promise.all([
    admin.from('fab_marks').select('id, mark_id').eq('fab_job_id', id),
    admin.from('fab_proof_photos').select('fab_mark_id, stage').eq('fab_job_id', id),
  ])
  const completeness = computeCompleteness(gateMarks ?? [], gatePhotos ?? [])
  if (!completeness.ready) {
    return NextResponse.json(
      { error: 'Not every piece is photographed yet', ...completeness },
      { status: 409 },
    )
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
