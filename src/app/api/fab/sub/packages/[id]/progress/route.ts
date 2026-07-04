// POST /api/fab/sub/packages/[id]/progress — the sub's self-reported progress
// ({ note, reported_pct?, eta? }) lands in fab_contractor_updates — the SAME
// table the office "Log call" writes — so the supervisor board, the Hub
// narrative and the package summary all update with zero new plumbing. This is
// the feedback that substitutes the phone call to Brisbane.
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

  const body = (await req.json().catch(() => ({}))) as {
    note?: string
    reported_pct?: number | null
    eta?: string | null
  }
  const note = (body.note ?? '').trim().slice(0, 500)
  if (!note) return NextResponse.json({ error: 'note required' }, { status: 400 })
  const pct = body.reported_pct
  if (pct != null && (typeof pct !== 'number' || pct < 0 || pct > 100)) {
    return NextResponse.json({ error: 'reported_pct must be 0-100' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: update, error } = await admin.from('fab_contractor_updates').insert({
    package_id: id,
    note,
    reported_pct: pct ?? null,
    eta: body.eta ?? null,
    entered_by: caller.stamp,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Same side-effect as the office route: first news from the sub moves the
  // package from 'sent' to 'in_progress'.
  if (pkg.status === 'sent') {
    await admin.from('fab_contractor_packages')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'sent')
  }

  await computeAndUpsertProgress(pkg.fab_job_id)
  return NextResponse.json({ ok: true, update }, { status: 201 })
}
