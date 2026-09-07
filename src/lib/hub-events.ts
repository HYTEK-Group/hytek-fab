// Server-only. The ONE way fab tells the Hub anything.
//
// Before this file, fab reported by writing two of the Hub's own tables —
// flow_fab_entries on every tonnes submit and flow_fab_progress after thirteen
// different routes. That is the side door hytek-fab/SYSTEM.md declared and
// annotated "# side door — Lane 7 closes". It is closed here: fab POSTs to the
// Hub's one inbound door with its own scoped token and the Hub does its own
// writing.
//
// RULES THIS FILE KEEPS:
//  1. It never throws. A floor action must never fail because the Hub is slow,
//     down, or not yet configured. Callers get a result and carry on.
//  2. It never blocks longer than 8 seconds (the install spoke's number —
//     hytek-install/src/lib/hub-flow.ts).
//  3. A genuine delivery failure lands in fab_events as kind 'hub_send_failed'
//     so it shows on the Exceptions screen. An UNSET token does not: fab having
//     no Hub credential is a deployment fact, not an exception the floor raised,
//     and one exception row per QC pass would train people to ignore the screen
//     (the trap Lane 3 hit wiring feed_runs into feed-freshness).

import type { SupabaseClient } from '@supabase/supabase-js'
import { HUB_BASE, HUB_NOT_CONFIGURED, hubToken } from './hub'
import { logFabEvent } from './fab-events-log'
import type { FabEventBody } from './hub-event-builders'

export type { FabEvent, FabEventBody, FabEventPayload } from './hub-event-builders'

const TIMEOUT_MS = 8000

export type SendResult =
  | { ok: true }
  /** The token is unset — nothing was attempted, and that is not an exception. */
  | { ok: false; status: 0; error: string; skipped: true }
  | { ok: false; status: number; error: string; skipped?: false }

/** POST one event to the Hub's door. Never throws. */
export async function sendFabEvent(body: FabEventBody): Promise<SendResult> {
  const token = hubToken()
  if (!token) return { ok: false, status: 0, error: HUB_NOT_CONFIGURED, skipped: true }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${HUB_BASE}/api/flow/event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || data.ok === false) {
      return { ok: false, status: res.status, error: data.error ?? `Hub returned ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    // AbortError included: a timeout is a failed send, not a crash.
    return { ok: false, status: 503, error: String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send, and record a genuine failure where a human will see it.
 *
 * `fabJobId` may be null for events that are not job-scoped in fab's own tables;
 * the exception row still lands, unattached.
 */
export async function sendFabEventLogged(
  admin: SupabaseClient,
  body: FabEventBody,
  fabJobId: string | null,
  actor: string,
): Promise<SendResult> {
  const res = await sendFabEvent(body)
  if (res.ok || res.skipped) return res
  await logFabEvent(admin, {
    fab_job_id: fabJobId,
    kind: 'hub_send_failed',
    actor,
    detail: {
      event: body.event,
      quote_number: body.quote_number,
      idempotency_key: body.idempotency_key,
      status: res.status,
      error: res.error,
    },
  })
  return res
}

/** What a route reports back to the browser about its Hub sends. */
export interface HubSendSummary {
  sent: number
  failed: number
  skipped: number
  reason?: string
}

export function summariseSends(results: SendResult[]): HubSendSummary {
  const summary: HubSendSummary = { sent: 0, failed: 0, skipped: 0 }
  for (const r of results) {
    if (r.ok) summary.sent++
    else if (r.skipped) {
      summary.skipped++
      summary.reason = r.error
    } else {
      summary.failed++
      summary.reason = r.error
    }
  }
  return summary
}
