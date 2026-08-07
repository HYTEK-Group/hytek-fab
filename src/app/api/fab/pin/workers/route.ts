// GET  /api/fab/pin/workers — admin: list roster (no hashes)
// POST /api/fab/pin/workers — admin: add a worker with a PIN
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'
import { hashPin, isValidPinFormat } from '@/lib/fab-pin'
import type { UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_pins')
    .select('id, worker_name, role, is_active, created_at, profile_id')
    .order('worker_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workers: data ?? [] })
}

export async function POST(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const body = (await req.json()) as { worker_name?: string; pin?: string; role?: UserRole }
  if (!body.worker_name?.trim()) {
    return NextResponse.json({ error: 'worker_name required' }, { status: 400 })
  }
  if (!isValidPinFormat(body.pin ?? '')) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }
  const role: UserRole = body.role ?? 'fabricator'
  if (role === 'admin' && caller.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can grant the admin role' }, { status: 403 })
  }
  const admin = getSupabaseAdmin()
  const pin_hash = await hashPin(body.pin!)
  const { data, error } = await admin
    .from('fab_pins')
    .insert({ worker_name: body.worker_name.trim(), pin_hash, role, is_active: true })
    .select('id, worker_name, role, is_active, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ worker: data }, { status: 201 })
}
