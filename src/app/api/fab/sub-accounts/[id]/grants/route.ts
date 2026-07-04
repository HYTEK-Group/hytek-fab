// POST  /api/fab/sub-accounts/[id]/grants — grant this sub a package { package_id }
// PATCH /api/fab/sub-accounts/[id]/grants — revoke { package_id } (stamps
//   revoked_at; history preserved, access dies on the sub's next request).
// Supervisor/admin only. Re-granting a revoked package clears revoked_at.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { package_id?: string }
  if (!body.package_id) return NextResponse.json({ error: 'package_id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const [{ data: account }, { data: pkg }] = await Promise.all([
    admin.from('fab_sub_accounts').select('id, is_active').eq('id', id).single(),
    admin.from('fab_contractor_packages').select('id, package_type').eq('id', body.package_id).single(),
  ])
  if (!account) return NextResponse.json({ error: 'Sub account not found' }, { status: 404 })
  if (!account.is_active) return NextResponse.json({ error: 'Sub account is deactivated' }, { status: 409 })
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  // Upsert on the (account, package) pair; re-granting clears a prior revoke.
  const { data: grant, error } = await admin
    .from('fab_sub_grants')
    .upsert(
      {
        sub_account_id: id, package_id: body.package_id,
        granted_by: caller.name, granted_at: new Date().toISOString(), revoked_at: null,
      },
      { onConflict: 'sub_account_id,package_id' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, grant }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { package_id?: string }
  if (!body.package_id) return NextResponse.json({ error: 'package_id required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_sub_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('sub_account_id', id)
    .eq('package_id', body.package_id)
    .is('revoked_at', null)
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No active grant for that package' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, revoked: data.length })
}
