// Server-only. fab's ONE connection to the Hub.
//
// fab is a spoke. It holds exactly one Hub credential — HUB_TOKEN_FAB — scoped
// by the Hub to the four verbs fab may emit and the read windows it may ask.
// The unscoped HUB_INTERNAL_TOKEN this file used to read is gone: a token that
// can trigger any other spoke's events (dispatch's `delivered`, purchasing's
// `materials_received`) has no business in a department app.
// Evidence: findings/02-detailing-fab-install.md §3.4; LANES/07-fab.md §3.1.
//
// THERE IS NO PERMISSIVE FALLBACK, and that is the point of this file.
// The old code, when the token was unset, returned a FABRICATED job-state —
// state 'unknown', ss_release null, materials_received false — that no caller
// could tell apart from a real Hub answer. An unconfigured fab therefore looked
// exactly like a fab whose jobs were simply not released yet. Every caller now
// gets `{ ok: false, status: 503 }` and shows "Hub not configured".
// (hytek-brain WHY-IT-DRIFTED.md §2: a comment asserting a protection that does
// not exist is the disease; a stub asserting an answer that never came is the
// same disease with a return value.)

import type { HubJobState } from './types'

export const HUB_BASE = (process.env.HUB_BASE ?? 'https://hub.hytekframing.com.au').replace(/\/$/, '')

/** The message every caller shows when fab has no Hub credential. */
export const HUB_NOT_CONFIGURED = 'Hub not configured — HUB_TOKEN_FAB is not set'

/**
 * Read at call time, never at module load: Vercel injects env before the first
 * request, and the unit tests set it per case. A module-level const would freeze
 * whatever was present when the bundle was first evaluated.
 */
export function hubToken(): string {
  return (process.env.HUB_TOKEN_FAB ?? '').trim()
}

/** True when fab actually holds a Hub credential. Callers use this to decide
 *  whether a non-delivery is worth an exception row (it is not — an unset token
 *  is a deployment fact, not something the floor did wrong). */
export function hubConfigured(): boolean {
  return hubToken().length > 0
}

export type JobStateResult =
  | { ok: true; state: HubJobState }
  | { ok: false; status: number; error: string }

async function readJobState(url: string): Promise<JobStateResult> {
  const token = hubToken()
  if (!token) return { ok: false, status: 503, error: HUB_NOT_CONFIGURED }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 30 },
    })
    if (!res.ok) return { ok: false, status: res.status, error: `Hub returned ${res.status}` }
    const data = (await res.json()) as HubJobState
    return { ok: true, state: data }
  } catch (err) {
    return { ok: false, status: 503, error: String(err) }
  }
}

export async function getJobState(dealId: string): Promise<JobStateResult> {
  return readJobState(`${HUB_BASE}/api/flow/job-state/${encodeURIComponent(dealId)}`)
}

export async function getJobStateByQuoteNumber(quoteNumber: string): Promise<JobStateResult> {
  return readJobState(
    `${HUB_BASE}/api/flow/job-state/_?quote_number=${encodeURIComponent(quoteNumber)}`,
  )
}
