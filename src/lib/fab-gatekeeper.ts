// Gatekeeper (W4) — the four-eyes controls over the fab traceability record.
//
// Everything lives in the append-only `fab_events` log (no mutable state): a
// sensitive action writes an EXCEPTION event; a second admin "clears" it by
// writing an `exception_cleared` event that points back at it. Open exceptions
// are those with no matching clear. Because clearing is itself an immutable
// event, the control can't be un-done or hidden — which is the whole point.
//
// This module is PURE (no IO) so it's unit-tested directly.

import type { MarkStatus } from './types'

/** Sensitive actions that need a *different* admin to acknowledge them. */
export const EXCEPTION_KINDS = [
  'dispatch_override',        // shipped steel that wasn't fully photographed
  'mark_status_reverted',     // a proven piece pushed back down the chain
  'onsite_date_changed',      // a promised on-site date moved after being set
  'proven_piece_unstaged',    // a photographed piece pulled out of its delivery
  'stage_deleted_with_proof', // a delivery stage holding proven pieces deleted
] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]
export const CLEAR_KIND = 'exception_cleared'

export function isExceptionKind(k: string): k is ExceptionKind {
  return (EXCEPTION_KINDS as readonly string[]).includes(k)
}

// How far a mark is toward "made / proven". A drop from the proven tier means
// someone erased finished work — that's what we flag, not normal round-trips
// (e.g. returned → back out to a contractor is a lateral move, not a reversion).
const RANK: Record<string, number> = {
  not_started: 0, in_progress: 1, at_contractor: 1, returned: 2,
  done: 3, qc_passed: 4, sub_certified: 4,
}
const PROVEN_FLOOR = 3 // `done` and above are "made"

export function statusRank(s: string): number {
  return RANK[s] ?? 0
}
/** True when `to` erases proven progress (was made/passed, now pushed below).
 *  Sending a proven piece OUT to a contractor (`at_contractor`) is a normal
 *  send-out, not an erasure — the contractor-package flow does it silently, so
 *  we never flag it here. */
export function isBackwardStatus(from: MarkStatus | string, to: MarkStatus | string): boolean {
  if (to === 'at_contractor') return false
  return statusRank(from) >= PROVEN_FLOOR && statusRank(to) < statusRank(from)
}

// ── Identity + the four-eyes rule ────────────────────────────────────────────
// Identities come from TWO unlinked namespaces: Supabase logins (key `sb:<uuid>`,
// name = full name) and shared-tablet kiosk PINs (key `pin:<worker_name>`, name =
// that worker_name). There is no PIN→login mapping, so we can't rely on the key
// alone across channels — `sameHuman` also matches on the normalised display
// name, and clearing is restricted to Supabase admins (see the clear route) so a
// kiosk name can't masquerade as an independent login. This is the honest limit:
// the only cross-channel link we have is the person's name.
export interface Identity {
  key: string
  ns: 'kiosk' | 'supabase'
  name: string
}
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Best-effort "these two identities are the same person". Matches on the stable
 *  key first, then falls back to a normalised-name match so one human can't slip
 *  the four-eyes gate by acting under a kiosk name and a login name. */
export function sameHuman(a: Identity, b: Identity): boolean {
  if (a.key && b.key && a.key === b.key) return true
  return !!a.name && !!b.name && normName(a.name) === normName(b.name)
}

export interface ClearAttempt {
  clearer: Identity
  raisedBy: Identity
  clearerRole: string
  alreadyCleared: boolean
}
export function canClearException(a: ClearAttempt): { ok: boolean; reason?: string } {
  if (a.alreadyCleared) return { ok: false, reason: 'This exception has already been cleared.' }
  if (a.clearerRole !== 'admin') return { ok: false, reason: 'Only an admin can clear an exception.' }
  if (sameHuman(a.clearer, a.raisedBy)) {
    return { ok: false, reason: 'A different admin must clear it — you can’t clear an exception you raised.' }
  }
  return { ok: true }
}

// ── Folding the event stream into an exceptions view ─────────────────────────

export interface RawEvent {
  id: string
  fab_job_id: string | null
  kind: string
  actor: string
  detail: unknown
  created_at: string
}
export interface Exception {
  id: string
  fab_job_id: string | null
  kind: ExceptionKind
  actor: string
  detail: unknown
  created_at: string
  cleared_by: string | null
  cleared_at: string | null
  clear_note: string | null
}

function clearedEventId(detail: unknown): string | null {
  if (detail && typeof detail === 'object' && 'cleared_event_id' in detail) {
    const v = (detail as { cleared_event_id?: unknown }).cleared_event_id
    return typeof v === 'string' ? v : null
  }
  return null
}
function clearNote(detail: unknown): string | null {
  if (detail && typeof detail === 'object' && 'note' in detail) {
    const v = (detail as { note?: unknown }).note
    return typeof v === 'string' && v.trim() ? v : null
  }
  return null
}

/** Split raised exceptions into open (no clear) vs cleared, newest first. */
export function foldExceptions(events: RawEvent[]): { open: Exception[]; cleared: Exception[] } {
  const clears = new Map<string, RawEvent>()
  for (const e of events) {
    if (e.kind !== CLEAR_KIND) continue
    const cid = clearedEventId(e.detail)
    if (!cid) continue
    // Earliest clear wins, by timestamp — NOT by array order (the feed may arrive
    // ascending or descending), so a later duplicate can never overwrite it.
    const prev = clears.get(cid)
    if (!prev || e.created_at < prev.created_at) clears.set(cid, e)
  }
  const open: Exception[] = []
  const cleared: Exception[] = []
  for (const e of events) {
    if (!isExceptionKind(e.kind)) continue
    const c = clears.get(e.id)
    const ex: Exception = {
      id: e.id, fab_job_id: e.fab_job_id, kind: e.kind, actor: e.actor,
      detail: e.detail, created_at: e.created_at,
      cleared_by: c?.actor ?? null, cleared_at: c?.created_at ?? null,
      clear_note: c ? clearNote(c.detail) : null,
    }
    ;(c ? cleared : open).push(ex)
  }
  const newest = (a: Exception, b: Exception) => (a.created_at < b.created_at ? 1 : -1)
  return { open: open.sort(newest), cleared: cleared.sort(newest) }
}
