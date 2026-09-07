// POST /api/fab/contractor-packages/[id]/marks
// body: { add?: string[], remove?: string[] }  (mark UUIDs)
// add: set contractor_package_id, status -> at_contractor (locked out of in-house)
// remove: clear contractor_package_id, status -> not_started (back to in-house)
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndPublishProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as { add?: string[]; remove?: string[] }
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Resolve the job id from the package (for the progress recompute).
  const { data: pkg, error: pkgErr } = await admin
    .from('fab_contractor_packages')
    .select('id, fab_job_id, status')
    .eq('id', id)
    .single()
  if (pkgErr || !pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  // Newly-added marks inherit the package's send state: if already sent,
  // they go straight to at_contractor; otherwise they wait in the package.
  const addStatus = pkg.status === 'sent' || pkg.status === 'in_progress'
    ? 'at_contractor' : 'not_started'

  if (body.add?.length) {
    const { error } = await admin
      .from('fab_marks')
      .update({ contractor_package_id: id, status: addStatus, assigned_to: null, updated_at: now })
      .eq('fab_job_id', pkg.fab_job_id)
      .in('id', body.add)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.remove?.length) {
    const { error } = await admin
      .from('fab_marks')
      .update({ contractor_package_id: null, status: 'not_started', updated_at: now })
      .eq('contractor_package_id', id)
      .in('id', body.remove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await computeAndPublishProgress(pkg.fab_job_id)
  return NextResponse.json({ ok: true })
}
