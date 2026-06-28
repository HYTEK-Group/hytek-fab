// POST /api/fab/pin/verify — public. Verify a 4-digit PIN against fab_pins,
// return a kiosk token + worker info. Never returns the hash.
//
// Brute-force protection (see src/lib/fab-rate-limit.ts): a CORRECT PIN ALWAYS
// works instantly — never blocked or delayed, even on the shared factory tablet
// behind one public IP. WRONG guesses are recorded per IP and answered with a
// small, growing delay, so enumerating the 10,000-PIN space from the public
// endpoint is infeasible. After a couple of misses the message becomes "see your
// supervisor" (informational only — it never bars a valid PIN). The throttle is
// best-effort: a DB hiccup in it can never stop a legitimate sign-in.
//
// Reuses the existing fab_pin_attempts table (sql/003) as a failures-only log:
// successes are cleared, not recorded, so no schema change is required.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isValidPinFormat, verifyPin } from '@/lib/fab-pin'
import { createKioskToken } from '@/lib/fab-kiosk-token'
import {
  clientIp,
  recordPinFailure,
  clearPinFailures,
  failureDelayMs,
  warnSupervisor,
} from '@/lib/fab-rate-limit'
import type { UserRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { pin?: string }
  const pin = body.pin ?? ''
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const ip = clientIp(req.headers)
  const admin = getSupabaseAdmin()
  const { data: rows, error } = await admin
    .from('fab_pins')
    .select('id, worker_name, pin_hash, role, is_active')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A correct PIN ALWAYS works, instantly — never blocked or delayed.
  for (const row of rows ?? []) {
    if (await verifyPin(pin, row.pin_hash)) {
      const role = row.role as UserRole
      const token = createKioskToken(row.worker_name, role)
      try {
        await clearPinFailures(admin, ip) // reset the throttle on success — best-effort
      } catch {
        // never let throttle bookkeeping block a valid sign-in
      }
      return NextResponse.json({ worker_name: row.worker_name, role, token })
    }
  }

  // Wrong PIN: record the miss, then slow the answer down a little. The growing
  // delay throttles enumeration without ever hard-locking the shared kiosk.
  let failures = 1
  try {
    failures = await recordPinFailure(admin, ip)
  } catch {
    // if bookkeeping fails, fall back to a generic, un-delayed rejection
  }
  await sleep(failureDelayMs(failures))
  return warnSupervisor(failures)
    ? NextResponse.json(
        { error: "You're using the wrong PIN — please see your supervisor" },
        { status: 429 },
      )
    : NextResponse.json({ error: 'PIN not recognised' }, { status: 401 })
}
