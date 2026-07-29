// POST /api/fab/stages/[id]/marks — assign/unassign pieces to a delivery stage.
//   { add?: string[], remove?: string[] } (mark ids). A piece belongs to one
//   stage; adding it here moves it off any other stage. Supervisor/admin.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { logException } from '@/lib/fab-events-log'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { add?: string[]; remove?: string[] }

  const admin = getSupabaseAdmin()
  const { data: stage } = await admin.from('fab_delivery_stages').select('id, fab_job_id').eq('id', id).single()
  if (!stage) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  const now = new Date().toISOString()
  // Only move marks that belong to THIS job (never cross-job attribution).
  if (body.add?.length) {
    const { error } = await admin.from('fab_marks')
      .update({ delivery_stage_id: id, updated_at: now })
      .eq('fab_job_id', stage.fab_job_id).in('id', body.add)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.remove?.length) {
    // Which of the marks being pulled out are PROVEN (have a made photo)? Capture
    // before the update so we can flag pulling proof out of a delivery.
    const { data: removing } = await admin.from('fab_marks')
      .select('id, mark_id').eq('delivery_stage_id', id).in('id', body.remove)
    let provenMarks: string[] = []
    if (removing && removing.length > 0) {
      const { data: madePhotos } = await admin.from('fab_proof_photos')
        .select('fab_mark_id').in('fab_mark_id', removing.map(m => m.id)).eq('stage', 'made')
      const madeIds = new Set((madePhotos ?? []).map(p => p.fab_mark_id))
      provenMarks = removing.filter(m => madeIds.has(m.id)).map(m => m.mark_id)
    }

    const { error } = await admin.from('fab_marks')
      .update({ delivery_stage_id: null, updated_at: now })
      .eq('delivery_stage_id', id).in('id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (provenMarks.length > 0) {
      await logException(admin, caller, {
        fab_job_id: stage.fab_job_id, kind: 'proven_piece_unstaged',
        detail: { stage_id: id, proven_marks: provenMarks, proven_count: provenMarks.length },
      })
    }
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
