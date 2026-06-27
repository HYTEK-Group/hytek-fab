// PATCH /api/fab/contractor-packages/[id] — update status/details.
// Setting status to 'sent' stamps sent_at + moves member marks to at_contractor.
// Setting status to 'returned' stamps returned_at + moves member marks to returned.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndUpsertProgress } from '@/lib/fab-progress'
import type { ContractorPackageStatus } from '@/lib/types'

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
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (body.contractor_contact !== undefined) patch.contractor_contact = body.contractor_contact
  if (body.scope_note !== undefined) patch.scope_note = body.scope_note
  if (body.expected_return_date !== undefined) patch.expected_return_date = body.expected_return_date
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

  await computeAndUpsertProgress(pkg.fab_job_id)
  return NextResponse.json({ package: pkg })
}
