// PATCH /api/fab/sub-accounts/[id] — activate/deactivate a sub firm's login, or
// clear a forgotten PIN so they set a new one on next open.
//   { is_active: false } → instant kill-switch (getSubCaller refuses at once).
//   { is_active: true }  → re-enable.
//   { reset_pin: true }  → wipe pin_hash → the invite link asks them to set a
//                          new PIN (the office-side "forgot my PIN" reset).
// Supervisor/admin only.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { is_active?: boolean; reset_pin?: boolean }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
  if (body.reset_pin === true) patch.pin_hash = null
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_sub_accounts')
    .update(patch)
    .eq('id', id)
    .select('id, contractor_name, is_active, pin_hash')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Sub account not found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    account: {
      id: data.id, contractor_name: data.contractor_name,
      is_active: data.is_active, pin_set: data.pin_hash != null,
    },
  })
}
