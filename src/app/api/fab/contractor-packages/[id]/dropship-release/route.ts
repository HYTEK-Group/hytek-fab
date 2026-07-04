// POST /api/fab/contractor-packages/[id]/dropship-release — the supervisor's
// explicit "accept drop-ship" for steel that never sees in-house QC. Re-checks
// the ONE gate (canReleaseDropShip) server-side with fresh facts, then:
//   • stamps drop_ship_released_at/by on the package
//   • sets the package's marks to 'sub_certified' (dispatch-ready WITHOUT
//     claiming qc_passed — the status tells the truth about what happened)
//   • stamps the job's dispatch_requested_at so the dispatch feed surfaces it
//   • recomputes the Hub progress row
// Supervisor/admin only.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { canReleaseDropShip } from '@/lib/fab-sub-release'
import { computeAndUpsertProgress } from '@/lib/fab-progress'
import type { CcLevel, ComplianceMode, DeliveryMode } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params

  const admin = getSupabaseAdmin()
  const { data: pkg } = await admin
    .from('fab_contractor_packages')
    .select('id, fab_job_id, package_type, delivery_mode, ready_at, drop_ship_released_at, contractor_name')
    .eq('id', id).single()
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  const [{ data: job }, { data: marks }, { data: photos }, { count: certCount }] = await Promise.all([
    admin.from('fab_jobs').select('cc_level, compliance_mode').eq('id', pkg.fab_job_id).single(),
    admin.from('fab_marks').select('id').eq('contractor_package_id', id),
    admin.from('fab_proof_photos').select('fab_mark_id, stage')
      .eq('fab_package_id', id).eq('stage', 'made'),
    admin.from('fab_package_certs').select('id', { count: 'exact', head: true })
      .eq('fab_package_id', id),
  ])
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Count made photos of CURRENT package marks only (ignore photos orphaned by
  // a removed mark), so an unphotographed piece can never slip through the gate.
  const currentIds = new Set((marks ?? []).map(m => m.id))
  const madeMarks = new Set(
    (photos ?? []).filter(p => p.fab_mark_id && currentIds.has(p.fab_mark_id)).map(p => p.fab_mark_id as string),
  )
  const verdict = canReleaseDropShip({
    package_type: pkg.package_type,
    delivery_mode: pkg.delivery_mode as DeliveryMode,
    drop_ship_released_at: pkg.drop_ship_released_at,
    ready_at: pkg.ready_at,
    total_marks: marks?.length ?? 0,
    marks_with_made_photo: madeMarks.size,
    cert_count: certCount ?? 0,
    cc_level: job.cc_level as CcLevel | null,
    compliance_mode: job.compliance_mode as ComplianceMode,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: 'Cannot release', blockers: verdict.blockers }, { status: 409 })
  }

  const now = new Date().toISOString()
  // Claim the release atomically (double-tap safe).
  const { data: claimed, error: claimErr } = await admin
    .from('fab_contractor_packages')
    .update({ drop_ship_released_at: now, drop_ship_released_by: caller.name, updated_at: now })
    .eq('id', id)
    .is('drop_ship_released_at', null)
    .select('id')
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'Already released' }, { status: 409 })
  }

  const { error: marksErr } = await admin
    .from('fab_marks')
    .update({ status: 'sub_certified', updated_at: now })
    .eq('contractor_package_id', id)
  if (marksErr) {
    // The package was stamped released but the marks didn't flip — that leaves a
    // "released with un-certified marks" state that would be invisible to
    // dispatch and un-retryable (the claim guard blocks a second attempt).
    // Roll the claim back so the supervisor can simply try again.
    await admin.from('fab_contractor_packages')
      .update({ drop_ship_released_at: null, drop_ship_released_by: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ error: marksErr.message }, { status: 500 })
  }

  // Surface the job to dispatch (the feed shows jobs with ready steel; this also
  // covers the edge where marks are ready but no load exists yet).
  await admin.from('fab_jobs')
    .update({ dispatch_requested_at: now, updated_at: now })
    .eq('id', pkg.fab_job_id)
    .is('dispatch_requested_at', null)

  // Package timeline entry — the story stays on the package.
  await admin.from('fab_contractor_updates').insert({
    package_id: id,
    note: `Drop-ship accepted by ${caller.name} — released to dispatch (sub certs sighted)`,
    entered_by: caller.name,
  })

  await computeAndUpsertProgress(pkg.fab_job_id)
  return NextResponse.json({
    ok: true,
    released_at: now,
    released_by: caller.name,
    marks_certified: marks?.length ?? 0,
  })
}
