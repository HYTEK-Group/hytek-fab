// GET  /api/fab/jobs/[id]/contractor-packages — list packages (+ marks count)
// POST /api/fab/jobs/[id]/contractor-packages — create a package
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller, getSupervisorCaller } from '@/lib/fab-auth'
import { computeAndPublishProgress } from '@/lib/fab-progress'
import type { DeliveryMode, PackageType, TreatmentType } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_contractor_packages')
    .select('*, fab_marks(id), fab_contractor_updates(id, logged_at, note, reported_pct, eta)')
    .eq('fab_job_id', id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ packages: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as {
    contractor_name?: string
    package_type?: PackageType
    treatment_type?: TreatmentType | null
    contractor_contact?: string | null
    scope_note?: string | null
    expected_return_date?: string | null
    delivery_mode?: DeliveryMode
  }
  if (!body.contractor_name?.trim()) {
    return NextResponse.json({ error: 'contractor_name required' }, { status: 400 })
  }
  if (body.delivery_mode !== undefined && !['return_to_brisbane', 'drop_ship'].includes(body.delivery_mode)) {
    return NextResponse.json({ error: 'invalid delivery_mode' }, { status: 400 })
  }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_contractor_packages')
    .insert({
      fab_job_id: id,
      package_type: body.package_type ?? 'fabrication',
      treatment_type: body.treatment_type ?? null,
      contractor_name: body.contractor_name.trim(),
      contractor_contact: body.contractor_contact ?? null,
      scope_note: body.scope_note ?? null,
      expected_return_date: body.expected_return_date ?? null,
      delivery_mode: body.delivery_mode || 'return_to_brisbane',
      status: 'pending',
      created_by: caller.name,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await computeAndPublishProgress(id)
  return NextResponse.json({ package: data }, { status: 201 })
}
