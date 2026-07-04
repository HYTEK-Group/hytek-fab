// POST /api/fab/sub/packages/[id]/ready — the sub declares "ready to collect":
// every piece made (photo-proven), the load photographed, and (for drop-ship)
// certs attached. Stamps ready_at on the package and logs a contractor update
// so the office board tells the story. The office still holds the release
// power: return-to-Brisbane goes through in-house QC; drop-ship needs the
// supervisor's explicit accept (dropship-release route).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSubCaller, grantedPackage } from '@/lib/fab-sub-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSubCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const pkg = grantedPackage(caller, id)
  if (!pkg) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (pkg.ready_at) {
    return NextResponse.json({ ok: true, ready_at: pkg.ready_at, noop: true })
  }

  const admin = getSupabaseAdmin()

  // Honesty gates: every piece needs a made photo; the load needs a loaded photo;
  // drop-ship additionally needs at least one cert. Same facts the office
  // release checklist uses — the sub can't declare ready on an empty chain.
  const [{ data: marks }, { data: photos }, { count: certCount }] = await Promise.all([
    admin.from('fab_marks').select('id').eq('contractor_package_id', id),
    admin.from('fab_proof_photos').select('fab_mark_id, stage')
      .eq('fab_package_id', id).in('stage', ['made', 'loaded']),
    admin.from('fab_package_certs').select('id', { count: 'exact', head: true })
      .eq('fab_package_id', id),
  ])

  // Only count made photos of marks CURRENTLY in the package — a photo left
  // behind by a since-removed mark must not satisfy the gate for a new one.
  const currentIds = new Set((marks ?? []).map(m => m.id))
  const madeMarks = new Set(
    (photos ?? [])
      .filter(p => p.stage === 'made' && p.fab_mark_id && currentIds.has(p.fab_mark_id))
      .map(p => p.fab_mark_id as string),
  )
  const hasLoaded = (photos ?? []).some(p => p.stage === 'loaded')

  const blockers: string[] = []
  const total = marks?.length ?? 0
  if (total === 0) blockers.push('No pieces in this package')
  else if (madeMarks.size < total) {
    blockers.push(`Photograph every finished piece first (${madeMarks.size} of ${total} done)`)
  }
  if (!hasLoaded) blockers.push('Add a photo of the load on the truck')
  if (pkg.delivery_mode === 'drop_ship' && (certCount ?? 0) === 0) {
    blockers.push('Attach your QA / mill certs — required for delivery straight to site')
  }
  if (blockers.length > 0) {
    return NextResponse.json({ error: 'Not ready yet', blockers }, { status: 409 })
  }

  const ready_at = new Date().toISOString()
  const { error } = await admin.from('fab_contractor_packages')
    .update({ ready_at, updated_at: ready_at })
    .eq('id', id)
    .is('ready_at', null) // idempotent under races
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tell the story on the package timeline too.
  await admin.from('fab_contractor_updates').insert({
    package_id: id,
    note: pkg.delivery_mode === 'drop_ship'
      ? 'Ready to collect — going straight to site (awaiting HYTEK drop-ship sign-off)'
      : 'Ready to collect — returning to HYTEK Brisbane for QC',
    reported_pct: 100,
    entered_by: caller.stamp,
  })

  await computeAndUpsertProgress(pkg.fab_job_id)
  return NextResponse.json({ ok: true, ready_at })
}
