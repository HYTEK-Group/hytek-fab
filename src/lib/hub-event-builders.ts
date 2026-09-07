// PURE builders for the four events fab sends the Hub. No IO, no clock, no env.
//
// Why builders and not inline object literals at thirteen call sites: the Hub's
// POST /api/flow/event allow-lists payload keys per verb and silently DROPS
// anything else (hytek-hub lib/flow/signals/event.ts sanitizePayload). A typo in
// a key name is therefore not an error anywhere — it is a field that quietly
// stops arriving. Building every payload in one tested file is the only place
// that can be caught.
//
// The Hub's sanitizer also drops nested objects and arrays outright, so the two
// JSONB columns of flow_fab_progress travel as JSON STRINGS
// (contractor_packages_json / dispatch_loads_json) and the Hub's handler parses
// them back. That is why FabEventPayload is scalar-only by type.
//
// IDEMPOTENCY KEYS are the contract that makes a retry safe:
//   fab_tonnes    fab_tonnes:<quote>:<week_start>:<created_at_ms>
//                 append-only, exactly like today's flow_fab_entries rows —
//                 a re-submit is a NEW event and the Hub's reader takes the
//                 latest per week.
//   fab_progress  fab_progress:<quote>:<sha256(row)[0..16]>
//                 content-addressed: the same rollup computed twice (two floor
//                 actions that change nothing) is ONE event, not two.
//   fab_load_dispatched  fab_load:<quote>:<load_number>   — one per load, ever.
//   fab_proof            fab_proof:<quote>:<photo_id>     — one per photo, ever.

import { createHash } from 'node:crypto'
import type { FabProgressRow } from './types'

export type FabEvent = 'fab_tonnes' | 'fab_progress' | 'fab_load_dispatched' | 'fab_proof'

/** Scalar-only by construction — see the sanitizePayload note above. */
export type FabEventPayload = Record<string, string | number | boolean | null>

export interface FabEventBody {
  event: FabEvent
  quote_number: string
  deal_id: string | null
  occurred_at: string
  payload: FabEventPayload
  idempotency_key: string
}

/** Short, stable content hash. 16 hex chars = 64 bits, far more than enough to
 *  separate consecutive rollups of one job and short enough to read in a log. */
export function rowFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

// ── fab_tonnes ──────────────────────────────────────────────────────────────
// One event PER JOB. The Hub adds them up and keeps writing the single weekly
// total row that flow_fab_entries has always held, so the board's heartbeat does
// not change shape (LANES/07-fab.md §3.1.3; Scott's default, §7 "Tonnes
// granularity" — recorded, not asked).

export interface TonnesEventInput {
  quoteNumber: string
  dealId?: string | null
  weekStart: string
  tonnes: number
  hours?: number | null
  note?: string | null
  enteredBy: string
  /** The whole week's total across every job in this submit — the Hub writes it
   *  as the flow_fab_entries row without having to wait for the last event. */
  weekTotalTonnes: number
  jobsInWeek: number
  /** ms since epoch of the submit. Part of the key so a correcting re-submit is
   *  a new fact rather than a swallowed duplicate. */
  createdAtMs: number
  occurredAt: string
}

export function buildTonnesEvent(input: TonnesEventInput): FabEventBody {
  return {
    event: 'fab_tonnes',
    quote_number: input.quoteNumber,
    deal_id: input.dealId ?? null,
    occurred_at: input.occurredAt,
    payload: {
      week_start: input.weekStart,
      tonnes: input.tonnes,
      hours: input.hours ?? null,
      note: input.note ?? null,
      entered_by: input.enteredBy,
      week_total_tonnes: input.weekTotalTonnes,
      jobs_in_week: input.jobsInWeek,
    },
    idempotency_key: `fab_tonnes:${input.quoteNumber}:${input.weekStart}:${input.createdAtMs}`,
  }
}

// ── fab_progress ────────────────────────────────────────────────────────────
// Replaces the direct upsert into the Hub's flow_fab_progress. Every scalar
// column of the row travels as-is; the two JSONB columns travel as strings.

export function buildProgressEvent(row: FabProgressRow, occurredAt: string): FabEventBody {
  return {
    event: 'fab_progress',
    quote_number: row.quote_number,
    deal_id: row.hubspot_deal_id,
    occurred_at: occurredAt,
    payload: {
      fab_job_id: row.fab_job_id,
      total_marks: row.total_marks,
      marks_qc_passed: row.marks_qc_passed,
      marks_dispatched: row.marks_dispatched,
      pct_complete: row.pct_complete,
      inhouse_total: row.inhouse_total,
      inhouse_complete: row.inhouse_complete,
      rework_total: row.rework_total,
      tonnes_total: row.tonnes_total,
      tonnes_complete: row.tonnes_complete,
      status: row.status,
      narrative: row.narrative,
      contractor_packages_json: JSON.stringify(row.contractor_packages),
      dispatch_loads_json: JSON.stringify(row.dispatch_loads),
    },
    // Content-addressed on the row, NOT on the clock: the thirteen routes that
    // recompute progress often recompute the same numbers.
    idempotency_key: `fab_progress:${row.quote_number}:${rowFingerprint(row)}`,
  }
}

// ── fab_load_dispatched ─────────────────────────────────────────────────────
// The discrete "a truck left" signal. job-state already derives loads from the
// progress rollup; this is what the Delivery Board and dispatch's fab-ready feed
// can key on instead of polling that rollup.

export interface LoadDispatchedInput {
  quoteNumber: string
  dealId?: string | null
  loadNumber: number
  dispatchedAt: string
  driver?: string | null
  marksCount: number
  weightKg?: number | null
  description?: string | null
}

export function buildLoadDispatchedEvent(input: LoadDispatchedInput): FabEventBody {
  return {
    event: 'fab_load_dispatched',
    quote_number: input.quoteNumber,
    deal_id: input.dealId ?? null,
    occurred_at: input.dispatchedAt,
    payload: {
      load_number: input.loadNumber,
      dispatched_at: input.dispatchedAt,
      driver: input.driver ?? null,
      marks: input.marksCount,
      weight_kg: input.weightKg ?? null,
      description: input.description ?? null,
    },
    idempotency_key: `fab_load:${input.quoteNumber}:${input.loadNumber}`,
  }
}

// ── fab_proof ───────────────────────────────────────────────────────────────
// Photos stay in fab's own `fab-proof` bucket — the event carries the path so
// the Hub can sign a URL later if it ever needs to show one. It never carries
// the image.

export interface ProofEventInput {
  quoteNumber: string
  dealId?: string | null
  stage: string
  photoId: string
  path: string
  takenAt: string
  markId?: string | null
  packageId?: string | null
  loadId?: string | null
  takenBy?: string | null
}

export function buildProofEvent(input: ProofEventInput): FabEventBody {
  return {
    event: 'fab_proof',
    quote_number: input.quoteNumber,
    deal_id: input.dealId ?? null,
    occurred_at: input.takenAt,
    payload: {
      stage: input.stage,
      photo_id: input.photoId,
      path: input.path,
      mark_id: input.markId ?? null,
      package_id: input.packageId ?? null,
      load_id: input.loadId ?? null,
      taken_by: input.takenBy ?? null,
    },
    idempotency_key: `fab_proof:${input.quoteNumber}:${input.photoId}`,
  }
}
