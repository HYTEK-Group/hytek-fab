// PATCH  /api/fab/pin/workers/[id] — admin: change PIN, role, or is_active
// DELETE /api/fab/pin/workers/[id] — admin: deactivate (soft, is_active=false)
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { hashPin, isValidPinFormat } from '@/lib/fab-pin'
import type { UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as
    { pin?: string; role?: UserRole; is_active?: boolean; worker_name?: string }

  const patch: Record<string, unknown> = {}
  if (body.worker_name !== undefined) patch.worker_name = body.worker_name.trim()
  if (body.role !== undefined) patch.role = body.role
  if (body.is_active !== undefined) patch.is_active = body.is_active
  if (body.pin !== undefined) {
    if (!isValidPinFormat(body.pin)) {
      return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
    }
    patch.pin_hash = await hashPin(body.pin)
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_pins')
    .update(patch)
    .eq('id', id)
    .select('id, worker_name, role, is_active, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ worker: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const { id } = await params
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('fab_pins').update({ is_active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
