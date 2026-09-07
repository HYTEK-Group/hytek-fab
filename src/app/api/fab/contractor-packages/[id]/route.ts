// PATCH /api/fab/contractor-packages/[id] — update status/details.
// Setting status to 'sent' stamps sent_at + moves member marks to at_contractor.
// Setting status to 'returned' stamps returned_at + moves member marks to returned.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndPublishProgress } from '@/lib/fab-progress'
import type { ContractorPackageStatus, DeliveryMode } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as {
    status?: ContractorPackageStatus
    contractor_contact?: string | null
    scope_note?: string | null
    expected_return_date?: string | null
    delivery_mode?: DeliveryMode
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (body.contractor_contact !== undefined) patch.contractor_contact = body.contractor_contact
  if (body.scope_note !== undefined) patch.scope_note = body.scope_note
  if (body.expected_return_date !== undefined) patch.expected_return_date = body.expected_return_date
  if (body.delivery_mode !== undefined) {
    if (!['return_to_brisbane', 'drop_ship'].includes(body.delivery_mode)) {
      return NextResponse.json({ error: 'invalid delivery_mode' }, { status: 400 })
    }
    // Once drop-ship is released the mode is part of the evidence story — locked.
    const { data: cur } = await admin
      .from('fab_contractor_packages')
      .select('drop_ship_released_at')
      .eq('id', id).single()
    if (cur?.drop_ship_released_at) {
      return NextResponse.json({ error: 'Package already drop-ship released — mode is locked' }, { status: 409 })
    }
    patch.delivery_mode = body.delivery_mode
  }
  if (body.status !== undefined) {
    patch.status = body.status
    if (body.status === 'sent') patch.sent_at = now
    if (body.status === 'returned') patch.returned_at = now
  }

  const { data: pkg, error } = await admin
    .from('fab_contractor_packages')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Cascade member-mark statuses on sent / returned.
  if (body.status === 'sent') {
    await admin.from('fab_marks')
      .update({ status: 'at_contractor', updated_at: now })
      .eq('contractor_package_id', id)
  } else if (body.status === 'returned') {
    await admin.from('fab_marks')
      .update({ status: 'returned', updated_at: now })
      .eq('contractor_package_id', id)
  }

  await computeAndPublishProgress(pkg.fab_job_id)
  return NextResponse.json({ package: pkg })
}
