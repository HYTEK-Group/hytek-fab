// POST /api/fab/contractor-packages/[id]/updates — log a phone-call update.
// Optionally moves the package to 'in_progress'.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndPublishProgress } from '@/lib/fab-progress'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as {
    note?: string; reported_pct?: number | null; eta?: string | null
  }
  if (!body.note?.trim()) {
    return NextResponse.json({ error: 'note required' }, { status: 400 })
  }
  const admin = getSupabaseAdmin()

  const { data: pkg, error: pkgErr } = await admin
    .from('fab_contractor_packages')
    .select('id, fab_job_id, status')
    .eq('id', id)
    .single()
  if (pkgErr || !pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  const { data, error } = await admin
    .from('fab_contractor_updates')
    .insert({
      package_id: id,
      note: body.note.trim(),
      reported_pct: body.reported_pct ?? null,
      eta: body.eta ?? null,
      entered_by: caller.name,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A phone-call update on a sent package implies it's in progress.
  if (pkg.status === 'sent') {
    await admin.from('fab_contractor_packages')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id)
  }

  await computeAndPublishProgress(pkg.fab_job_id)
  return NextResponse.json({ update: data }, { status: 201 })
}
