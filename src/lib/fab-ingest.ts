// THE DOOR IN. The only way the rest of the suite reaches fab.
//
// WHAT IT REPLACES, AND WHY THAT WAS WORSE THAN IT SOUNDS.
//
//  1. The ready queue. `GET /api/fab/ready-queue` read the shared `jobs` table,
//     subtracted `fab_jobs`, and then asked the Hub `GET /api/flow/job-state/_`
//     ONCE PER CANDIDATE — sequentially, up to fifty times, on every page load,
//     for every supervisor. Fifty round trips to answer "what may I start?".
//     The outbox knows the answer the moment it happens; fab now keeps it.
//
//  2. `fab_tasks`. The Hub writes fab's own table today, directly, from
//     lib/flow/signals/apply-rework-variation.ts: an INSERT when a rework or
//     variation is raised against fabrication, `status='done'` when it is
//     resolved, `completed_at=null` when it is reopened. That is the last
//     cross-app write into a `fab_*` table and it breaks root CLAUDE.md rule 4
//     ("one writer per table"). The five verbs are ALREADY routed to `fab` in
//     the Hub's subscription table; only the subscriber is missing. So the
//     handlers are here, matching the Hub's shapes column for column, and Lane 3
//     CP5 deletes the Hub's inline writes in the same commit that lands
//     lib/outbox/subscribers/fab.ts and takes `fab` off NOT_WIRED_YET.
//
//     NOTHING IS WRITTEN TWICE IN THE MEANTIME. `fab` is on NOT_WIRED_YET, and
//     the Hub's fanOut() filters those subscribers out of the queue entirely —
//     no row is written, so no row is delivered, so this handler receives
//     nothing until the day the Hub's own write comes out. Owner: Lane 3. The
//     list must be empty by 30/11/2026 (hytek-hub __tests__/fan-out.test.ts
//     fails the build after that date).
//
// THE ENVELOPE IS READ FROM THE HUB'S CODE, NOT FROM A LANE FILE.
// LANES/07-fab.md §3.3 has this door take `{type, quote_number, ...}` on three
// verbs — `job.released`, `materials.received` and `job.updated`. Two of those
// three were wrong when it was written and one still is:
//   • `materials.received` DID NOT EXIST as an outbox verb. It does now:
//     hytek-hub sql/migrations/051-outbox-materials-received.sql added it to the
//     CHECK constraint on 07/09, routed to `fab` alone.
//   • `job.updated` HAS NEVER EXISTED and is not going to. The Hub's verb for a
//     changed job is `job.revised`, and its CHECK constraint is the enforcement
//     (adding a verb is a migration in someone else's repo, not an edit). This
//     door handles `job.revised` under its real name; the Hub does not route it
//     here yet, which is a one-line change to SUBSCRIPTIONS in Lane 3, not a
//     migration. Until then a revision reaches fab as nothing at all, and the
//     on-site date on the queue screen is whatever the release carried.
//   • The wire shape is `{ event_id, event_type, quote_number, occurred_at,
//     payload }` — what lib/outbox/subscribers/lws.ts actually posts. Both
//     spellings are accepted here for the same reason LWS accepts both: one
//     door, one tested normaliser, no translation layer to drift.

/** Every verb this door acts on. Anything else is answered 200/ignored. */
export const FAB_INBOUND_EVENTS = [
  // The ready queue.
  'job.released',
  'materials.received',
  'job.revised',
  // fab_tasks — the Hub's inline writes, moved to their owner.
  'rework.raised',
  'rework.resolved',
  'rework.reopened',
  'variation.raised',
  'variation.status_changed',
] as const

export type FabInboundEvent = (typeof FAB_INBOUND_EVENTS)[number]

/** The queue-facing facts. `stream` decides whether fab cares at all. */
export interface FabEnvelope {
  event_id: string
  event: FabInboundEvent
  occurred_at: string
  quote_number: string
  payload: Record<string, unknown>
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null
const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const bool = (v: unknown): boolean => v === true || v === 'true'

export type NormaliseResult =
  | { ok: true; env: FabEnvelope }
  | { ok: false; kind: 'ignored'; event: string }
  | { ok: false; kind: 'malformed'; error: string }

/**
 * Read either spelling of the envelope into one shape. PURE — no clock, no
 * database, no environment, so every branch below is a unit test.
 *
 * An unknown verb is `ignored`, never `malformed`, and the route answers 200.
 * A 4xx would make the outbox worker retry a perfectly healthy delivery three
 * times and then red-card a subscriber that is working — which teaches people
 * to ignore red cards, the exact failure this whole restructure exists to stop.
 */
export function normaliseFabEnvelope(raw: unknown): NormaliseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, kind: 'malformed', error: 'body must be a JSON object' }
  }
  const b = raw as Record<string, unknown>

  // `event_type` is the outbox column; `event` and `type` are the lane file's.
  const event = str(b.event_type) ?? str(b.event) ?? str(b.type)
  if (!event) {
    return { ok: false, kind: 'malformed', error: 'event_type (or event) is required' }
  }
  if (!(FAB_INBOUND_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, kind: 'ignored', event }
  }

  const event_id = str(b.event_id)
  if (!event_id) {
    return { ok: false, kind: 'malformed', error: 'event_id is required — it is the idempotency key' }
  }

  const payload = (b.payload ?? b.job ?? {}) as Record<string, unknown>
  const quote_number = str(b.quote_number) ?? str(payload.quote_number)
  if (!quote_number) {
    return {
      ok: false,
      kind: 'malformed',
      error: 'quote_number is required — it is the join key across every database',
    }
  }

  const occurred_at = str(b.occurred_at) ?? str(payload.occurred_at)
  if (!occurred_at) {
    return {
      ok: false,
      kind: 'malformed',
      error: 'occurred_at is required — without it out-of-order delivery cannot be detected',
    }
  }

  return { ok: true, env: { event_id, event: event as FabInboundEvent, occurred_at, quote_number, payload } }
}

// ── the queue decision ──────────────────────────────────────────────────────

/** A `fab_ready_queue` row as this module reads it back. */
export interface ReadyQueueRow {
  quote_number: string
  hubspot_deal_id: string | null
  ss_release_version: number | null
  ss_released_at: string | null
  ss_released_by: string | null
  materials_received: boolean
  materials_received_at: string | null
  on_site_date: string | null
  last_event_at: string
  consumed_at: string | null
  is_test: boolean
}

export type QueueDecision =
  /** Write these columns (a partial row, merged onto whatever exists). */
  | { action: 'upsert'; patch: Record<string, unknown> }
  /** A fact older than the one already stored. The outbox retries; a retry that
   *  arrives after a newer fact must not undo it. */
  | { action: 'stale' }
  /** Not fab's release. LWS's stream is answered 200, not refused. */
  | { action: 'ignored'; reason: string }

/**
 * What this event does to the queue row, given the row that is already there.
 * PURE, and it is the whole of the interesting logic.
 */
export function decideQueue(env: FabEnvelope, existing: ReadyQueueRow | null): QueueDecision {
  const p = env.payload

  // The two spellings come from the Hub's own validator: lib/flow/signals/
  // event.ts requires stream to be 'SS' or 'LWS' for released_to_factory.
  // LANES/07-fab.md calls the other one 'LGS'; a comparison against 'LGS' would
  // silently match nothing, so it is not used here.
  if (env.event === 'job.released') {
    const stream = (str(p.stream) ?? '').toUpperCase()
    if (stream && stream !== 'SS') return { action: 'ignored', reason: `stream:${stream}` }
    // A release with NO stream at all is treated as fab's. The Hub has sent
    // unstreamed releases in the past and a missed SS release is a job nobody
    // starts; a spurious queue row is one line a supervisor skips.
  }

  if (existing && Date.parse(existing.last_event_at) > Date.parse(env.occurred_at)) {
    return { action: 'stale' }
  }

  const base: Record<string, unknown> = {
    quote_number: env.quote_number,
    last_event_at: env.occurred_at,
  }
  // Only overwrite identity fields when the event actually carries them —
  // `?? null` would blank a known deal id because a later event omitted it.
  const dealId = str(p.hubspot_deal_id)
  if (dealId) base.hubspot_deal_id = dealId
  const onSite = str(p.on_site_date)
  if (onSite) base.on_site_date = onSite
  if ('is_test' in p) base.is_test = bool(p.is_test)

  switch (env.event) {
    case 'job.released':
      return {
        action: 'upsert',
        patch: {
          ...base,
          ss_release_version: int(p.release_version),
          ss_released_at: env.occurred_at,
          ss_released_by: str(p.released_by) ?? str(p.actor),
        },
      }
    case 'materials.received':
      return {
        action: 'upsert',
        patch: {
          ...base,
          materials_received: true,
          materials_received_at: str(p.received_at) ?? env.occurred_at,
        },
      }
    case 'job.revised':
      // Identity only. A revision never grants or revokes a release: those are
      // deliberate acts with their own verbs, and inferring one from a rename is
      // how a job starts being fabricated because somebody fixed a typo.
      return { action: 'upsert', patch: base }
    default:
      return { action: 'ignored', reason: `not a queue event: ${env.event}` }
  }
}

// ── fab_tasks: the shapes the Hub writes today ──────────────────────────────
//
// Read out of hytek-hub lib/flow/signals/apply-rework-variation.ts, column for
// column, so moving the writer changes nothing about the rows. `affects_depts`
// arrives as a COMMA-JOINED STRING because the Hub's sanitizePayload drops
// arrays — that is not a quirk to tidy up, it is the wire format.

const DEPTS = ['detailing', 'dispatch', 'install', 'fabrication'] as const
type Dept = (typeof DEPTS)[number]

/** Split the comma-joined string; anything unrecognised is dropped silently. */
export function parseAffectsDepts(raw: unknown): Dept[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((p): p is Dept => (DEPTS as readonly string[]).includes(p))
}

/** Only these variation statuses close the work. `raised → priced → submitted →
 *  approved` leave it open: the work is still being done or still being billed. */
export const VARIATION_TERMINAL_STATUSES = new Set([
  'invoiced',
  'rejected',
  'cancelled',
  'superseded',
])

export type TaskDecision =
  | { action: 'insert'; row: Record<string, unknown>; key: { column: 'rework_id' | 'variation_id'; value: string } }
  | { action: 'close'; column: 'rework_id' | 'variation_id'; value: string }
  | { action: 'reopen'; column: 'rework_id'; value: string }
  | { action: 'ignored'; reason: string }

/**
 * What one rework/variation event does to `fab_tasks`. PURE. `fabJobId` is null
 * when fab has not started the job — an insert is then skipped, which is the
 * Hub's own behaviour ("skipped if the fab team hasn't started this job yet,
 * logged not failed"). A CLOSE is not skipped: the filter is on rework_id, so it
 * works whether or not the job is known here.
 */
export function decideTask(env: FabEnvelope, fabJobId: string | null): TaskDecision {
  const p = env.payload
  switch (env.event) {
    case 'rework.raised':
    case 'variation.raised': {
      const isRework = env.event === 'rework.raised'
      const id = str(isRework ? p.rework_id : p.variation_id)
      if (!id) return { action: 'ignored', reason: `${isRework ? 'rework_id' : 'variation_id'} missing` }
      if (!parseAffectsDepts(p.affects_depts).includes('fabrication')) {
        return { action: 'ignored', reason: 'fabrication not affected' }
      }
      if (!fabJobId) return { action: 'ignored', reason: 'no fab_jobs row — fabrication not started' }
      const number = str(isRework ? p.rework_number : p.variation_number) ?? id
      const marker = isRework ? '🔴 REWORK' : '⚠ VARIATION'
      return {
        action: 'insert',
        key: { column: isRework ? 'rework_id' : 'variation_id', value: id },
        row: {
          fab_job_id: fabJobId,
          description: `${marker} ${number}: ${str(p.description) ?? '(no description)'}`,
          status: 'open',
          created_by: `hub:${isRework ? 'rework' : 'variation'}:${id}`,
          [isRework ? 'rework_id' : 'variation_id']: id,
        },
      }
    }
    case 'rework.resolved': {
      const id = str(p.rework_id)
      return id ? { action: 'close', column: 'rework_id', value: id } : { action: 'ignored', reason: 'rework_id missing' }
    }
    case 'variation.status_changed': {
      const id = str(p.variation_id)
      if (!id) return { action: 'ignored', reason: 'variation_id missing' }
      const status = (str(p.status) ?? '').toLowerCase()
      if (!VARIATION_TERMINAL_STATUSES.has(status)) {
        return { action: 'ignored', reason: `variation still open: ${status || '(no status)'}` }
      }
      return { action: 'close', column: 'variation_id', value: id }
    }
    case 'rework.reopened': {
      const id = str(p.rework_id)
      return id ? { action: 'reopen', column: 'rework_id', value: id } : { action: 'ignored', reason: 'rework_id missing' }
    }
    default:
      return { action: 'ignored', reason: `not a task event: ${env.event}` }
  }
}

/** True when the verb belongs to the queue half of the door. */
export function isQueueEvent(e: FabInboundEvent): boolean {
  return e === 'job.released' || e === 'materials.received' || e === 'job.revised'
}
