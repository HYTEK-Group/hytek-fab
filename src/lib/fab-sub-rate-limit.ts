// Per-ACCOUNT brute-force lockout for the subcontractor PIN login. Per-IP
// throttling (fab-rate-limit.ts) can't protect a targeted account — a sub signs
// in from arbitrary phones/IPs and XFF is spoofable — so we also count failures
// against the sub account being attacked, and hard-lock it after a cap. A
// correct PIN clears the count; the office can also clear it (re-invite / reset).
import type { SupabaseClient } from '@supabase/supabase-js'

const TABLE = 'fab_sub_login_attempts'
const WINDOW_MS = 15 * 60 * 1000
export const LOCK_THRESHOLD = 10 // recent misses within the window → locked

// Delay ramp (ms) applied BEFORE responding to a wrong PIN. Unlike the kiosk,
// there is no free first attempt: a sub is a targeted-account case, so every
// miss costs time. Capped so a legit fat-finger isn't punished for minutes.
const STEP_MS = 750
const MAX_DELAY_MS = 6000

export function subFailureDelayMs(failureCount: number): number {
  if (failureCount <= 0) return 0
  return Math.min(failureCount * STEP_MS, MAX_DELAY_MS)
}

export function isLocked(failureCount: number): boolean {
  return failureCount >= LOCK_THRESHOLD
}

/** Count this account's failures inside the rolling window (does not record). */
export async function countSubFailures(
  admin: SupabaseClient, accountId: string, now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString()
  const { count } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('sub_account_id', accountId)
    .gte('created_at', since)
  return count ?? 0
}

/** Record a failure, prune old rows, return the in-window count (incl. this one). */
export async function recordSubFailure(
  admin: SupabaseClient, accountId: string, now: Date = new Date(),
): Promise<number> {
  await admin.from(TABLE).insert({ sub_account_id: accountId, created_at: now.toISOString() })
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString()
  await admin.from(TABLE).delete().eq('sub_account_id', accountId).lt('created_at', cutoff)
  return countSubFailures(admin, accountId, now)
}

/** Clear an account's failures (successful sign-in, or office reset). */
export async function clearSubFailures(admin: SupabaseClient, accountId: string): Promise<void> {
  await admin.from(TABLE).delete().eq('sub_account_id', accountId)
}
