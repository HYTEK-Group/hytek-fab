// Brute-force throttle for the public kiosk PIN endpoint.
//
// The factory kiosk is a SHARED tablet behind the factory's single public IP,
// so we must NEVER hard-lock: a correct PIN always works instantly. Instead we
// slow down WRONG guesses with a small, growing delay — enough to make
// enumerating the 10,000-PIN space from the public endpoint infeasible, while a
// real worker with the right PIN is never delayed or blocked.
//
// Failures are recorded per client IP in fab_pin_attempts and counted within a
// rolling window. A successful sign-in clears that IP's failures.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000 // rolling window for counting misses
export const SEE_SUPERVISOR_THRESHOLD = 4 // show "see your supervisor" from the 4th recent miss
export const DELAY_STEP_MS = 1500 // each extra miss adds this much delay…
export const MAX_DELAY_MS = 5000 // …capped here, so a fat-finger is never punished harshly

const TABLE = 'fab_pin_attempts'

/** Client IP from Vercel's proxy headers; 'unknown' if none (never on Vercel). */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Delay (ms) to hold before answering a WRONG guess. Zero on the first miss. */
export function failureDelayMs(failureCount: number): number {
  if (failureCount <= 1) return 0
  return Math.min((failureCount - 1) * DELAY_STEP_MS, MAX_DELAY_MS)
}

/** Whether to swap the message to "see your supervisor" (informational only). */
export function warnSupervisor(failureCount: number): boolean {
  return failureCount >= SEE_SUPERVISOR_THRESHOLD
}

/**
 * Record one failed attempt for `ip`, prune that IP's stale rows, and return how
 * many failures it has within the rolling window (including this one).
 */
export async function recordPinFailure(
  admin: SupabaseClient,
  ip: string,
  now: Date = new Date(),
): Promise<number> {
  const nowIso = now.toISOString()
  const cutoff = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString()

  await admin.from(TABLE).insert({ ip, created_at: nowIso })
  await admin.from(TABLE).delete().eq('ip', ip).lt('created_at', cutoff)

  const { count } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', cutoff)

  return count ?? 0
}

/** Clear an IP's failures after a successful sign-in (resets the throttle). */
export async function clearPinFailures(admin: SupabaseClient, ip: string): Promise<void> {
  await admin.from(TABLE).delete().eq('ip', ip)
}
