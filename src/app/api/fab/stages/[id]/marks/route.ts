// POST /api/fab/stages/[id]/marks — assign/unassign pieces to a delivery stage.
//   { add?: string[], remove?: string[] } (mark ids). A piece belongs to one
//   stage; adding it here moves it off any other stage. Supervisor/admin.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

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
    const { error } = await admin.from('fab_marks')
      .update({ delivery_stage_id: null, updated_at: now })
      .eq('delivery_stage_id', id).in('id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
