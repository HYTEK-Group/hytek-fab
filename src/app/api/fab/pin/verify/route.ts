// POST /api/fab/pin/verify — public. Verify a 4-digit PIN against fab_pins,
// return a kiosk token + worker info. Never returns the hash.
//
// Brute-force protection: per-IP lockout. We count FAILED attempts from the
// caller's IP over a sliding window; once over the threshold we stop checking
// PINs and return 429 until the window clears. The threshold is generous on
// purpose — a shared factory tablet sits behind one NAT IP, so several workers'
// genuine typos must not lock the tablet, while an automated enumerator (which
// fires far faster) is still throttled to a crawl.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isValidPinFormat, verifyPin } from '@/lib/fab-pin'
import { createKioskToken } from '@/lib/fab-kiosk-token'
import type { UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

const WINDOW_MINUTES = 15
const MAX_FAILS = 15 // failed attempts per IP per window before lockout

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { pin?: string }
  const pin = body.pin ?? ''
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const ip = clientIp(req)
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  // Lockout check: too many recent failures from this IP?
  const { count: fails } = await admin
    .from('fab_pin_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('success', false)
    .gte('created_at', since)

  if ((fails ?? 0) >= MAX_FAILS) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 },
    )
  }

  const { data: rows, error } = await admin
    .from('fab_pins')
    .select('id, worker_name, pin_hash, role, is_active')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let matched: { worker_name: string; role: UserRole } | null = null
  for (const row of rows ?? []) {
    if (await verifyPin(pin, row.pin_hash)) {
      matched = { worker_name: row.worker_name, role: row.role as UserRole }
      break
    }
  }

  // Record this attempt, then prune rows older than an hour so the table
  // stays tiny (the lockout window is only WINDOW_MINUTES).
  await admin.from('fab_pin_attempts').insert({ ip, success: !!matched })
  await admin
    .from('fab_pin_attempts')
    .delete()
    .lt('created_at', new Date(Date.now() - 60 * 60_000).toISOString())

  if (matched) {
    const token = createKioskToken(matched.worker_name, matched.role)
    return NextResponse.json({ worker_name: matched.worker_name, role: matched.role, token })
  }
  return NextResponse.json({ error: 'PIN not recognised' }, { status: 401 })
}
