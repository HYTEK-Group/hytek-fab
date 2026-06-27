// POST /api/fab/pin/verify — public. Verify a 4-digit PIN against fab_pins,
// return a kiosk token + worker info. Never returns the hash.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isValidPinFormat, verifyPin } from '@/lib/fab-pin'
import { createKioskToken } from '@/lib/fab-kiosk-token'
import type { UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { pin?: string }
  const pin = body.pin ?? ''
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: rows, error } = await admin
    .from('fab_pins')
    .select('id, worker_name, pin_hash, role, is_active')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  for (const row of rows ?? []) {
    if (await verifyPin(pin, row.pin_hash)) {
      const role = row.role as UserRole
      const token = createKioskToken(row.worker_name, role)
      return NextResponse.json({ worker_name: row.worker_name, role, token })
    }
  }
  return NextResponse.json({ error: 'PIN not recognised' }, { status: 401 })
}
