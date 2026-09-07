import { describe, expect, it } from 'vitest'
import {
  buildLoadDispatchedEvent,
  buildProgressEvent,
  buildProofEvent,
  buildTonnesEvent,
  rowFingerprint,
} from '../hub-event-builders'
import type { FabProgressRow } from '../types'

const ROW: FabProgressRow = {
  fab_job_id: '11111111-1111-1111-1111-111111111111',
  quote_number: '26070101',
  hubspot_deal_id: 'deal-9',
  total_marks: 10,
  marks_qc_passed: 4,
  marks_dispatched: 2,
  pct_complete: 40,
  inhouse_total: 8,
  inhouse_complete: 3,
  rework_total: 1,
  tonnes_total: 12.5,
  tonnes_complete: 5.25,
  contractor_packages: [
    {
      package_id: 'pkg-1',
      package_type: 'treatment',
      treatment_type: 'hdg',
      contractor_name: 'Transglas',
      scope_note: null,
      total_marks: 3,
      marks_done: 1,
      pct: 33,
      status: 'sent',
      last_update_date: '2026-09-01T00:00:00.000Z',
      last_update_note: 'in the bath',
      expected_return_date: '2026-09-08',
      returned_at: null,
    },
  ],
  dispatch_loads: [
    { load_number: 1, description: 'Columns', total_marks: 2, dispatched_at: '2026-09-05T01:00:00.000Z', planned_date: '2026-09-05' },
  ],
  narrative: '40% made, 1 load out',
  status: 'in_progress',
}

describe('buildTonnesEvent', () => {
  const base = {
    quoteNumber: '26070101',
    dealId: 'deal-9',
    weekStart: '2026-09-07',
    tonnes: 3.5,
    hours: 40,
    note: 'good week',
    enteredBy: 'jamie@hytekframing.com.au',
    weekTotalTonnes: 9,
    jobsInWeek: 2,
    createdAtMs: 1_757_000_000_000,
    occurredAt: '2026-09-07T02:00:00.000Z',
  }

  it('sends one job, with the week total alongside it', () => {
    expect(buildTonnesEvent(base)).toEqual({
      event: 'fab_tonnes',
      quote_number: '26070101',
      deal_id: 'deal-9',
      occurred_at: '2026-09-07T02:00:00.000Z',
      payload: {
        week_start: '2026-09-07',
        tonnes: 3.5,
        hours: 40,
        note: 'good week',
        entered_by: 'jamie@hytekframing.com.au',
        week_total_tonnes: 9,
        jobs_in_week: 2,
      },
      idempotency_key: 'fab_tonnes:26070101:2026-09-07:1757000000000',
    })
  })

  it('nulls the optional numbers rather than dropping the keys', () => {
    const e = buildTonnesEvent({ ...base, hours: undefined, note: undefined, dealId: undefined })
    expect(e.payload.hours).toBeNull()
    expect(e.payload.note).toBeNull()
    expect(e.deal_id).toBeNull()
  })

  it('is append-only: a re-submit of the same week is a NEW key', () => {
    const a = buildTonnesEvent(base)
    const b = buildTonnesEvent({ ...base, tonnes: 4, createdAtMs: base.createdAtMs + 1 })
    expect(a.idempotency_key).not.toBe(b.idempotency_key)
  })

  it('carries only scalars — the Hub drops nested values', () => {
    for (const v of Object.values(buildTonnesEvent(base).payload)) {
      expect(['string', 'number', 'boolean']).toContain(v === null ? 'string' : typeof v)
    }
  })
})

describe('buildProgressEvent', () => {
  const at = '2026-09-07T02:00:00.000Z'

  it('carries every scalar column of the row', () => {
    const e = buildProgressEvent(ROW, at)
    expect(e.event).toBe('fab_progress')
    expect(e.quote_number).toBe('26070101')
    expect(e.deal_id).toBe('deal-9')
    expect(e.payload).toMatchObject({
      fab_job_id: ROW.fab_job_id,
      total_marks: 10,
      marks_qc_passed: 4,
      marks_dispatched: 2,
      pct_complete: 40,
      inhouse_total: 8,
      inhouse_complete: 3,
      rework_total: 1,
      tonnes_total: 12.5,
      tonnes_complete: 5.25,
      status: 'in_progress',
      narrative: '40% made, 1 load out',
    })
  })

  it('round-trips the two JSONB columns through strings', () => {
    const e = buildProgressEvent(ROW, at)
    expect(typeof e.payload.contractor_packages_json).toBe('string')
    expect(typeof e.payload.dispatch_loads_json).toBe('string')
    expect(JSON.parse(e.payload.contractor_packages_json as string)).toEqual(ROW.contractor_packages)
    expect(JSON.parse(e.payload.dispatch_loads_json as string)).toEqual(ROW.dispatch_loads)
  })

  it('is content-addressed: the same rollup twice is ONE event', () => {
    expect(buildProgressEvent(ROW, at).idempotency_key)
      .toBe(buildProgressEvent(ROW, '2027-01-01T00:00:00.000Z').idempotency_key)
  })

  it('a changed rollup is a different event', () => {
    const moved = { ...ROW, marks_qc_passed: 5 }
    expect(buildProgressEvent(moved, at).idempotency_key)
      .not.toBe(buildProgressEvent(ROW, at).idempotency_key)
  })

  it('the key is prefixed and bounded', () => {
    const key = buildProgressEvent(ROW, at).idempotency_key
    expect(key.startsWith('fab_progress:26070101:')).toBe(true)
    expect(key.split(':')[2]).toHaveLength(16)
  })

  it('drops nothing silently — no nested value reaches the payload', () => {
    for (const v of Object.values(buildProgressEvent(ROW, at).payload)) {
      expect(typeof v === 'object' && v !== null).toBe(false)
    }
  })
})

describe('buildLoadDispatchedEvent', () => {
  it('keys on the load number, so one load is one event forever', () => {
    const e = buildLoadDispatchedEvent({
      quoteNumber: '26070101',
      dealId: null,
      loadNumber: 3,
      dispatchedAt: '2026-09-07T04:00:00.000Z',
      driver: 'Tony',
      marksCount: 12,
      weightKg: 4200,
      description: 'Rafters',
    })
    expect(e.event).toBe('fab_load_dispatched')
    expect(e.idempotency_key).toBe('fab_load:26070101:3')
    expect(e.occurred_at).toBe('2026-09-07T04:00:00.000Z')
    expect(e.payload).toEqual({
      load_number: 3,
      dispatched_at: '2026-09-07T04:00:00.000Z',
      driver: 'Tony',
      marks: 12,
      weight_kg: 4200,
      description: 'Rafters',
    })
  })
})

describe('buildProofEvent', () => {
  it('carries the path, never the image', () => {
    const e = buildProofEvent({
      quoteNumber: '26070101',
      dealId: 'deal-9',
      stage: 'qc',
      photoId: 'photo-77',
      path: '26070101/qc/photo-77.jpg',
      takenAt: '2026-09-07T05:00:00.000Z',
      markId: 'mark-1',
      takenBy: 'kiosk:Dave',
    })
    expect(e.idempotency_key).toBe('fab_proof:26070101:photo-77')
    expect(e.payload).toEqual({
      stage: 'qc',
      photo_id: 'photo-77',
      path: '26070101/qc/photo-77.jpg',
      mark_id: 'mark-1',
      package_id: null,
      load_id: null,
      taken_by: 'kiosk:Dave',
    })
  })
})

describe('rowFingerprint', () => {
  it('is stable and 16 hex chars', () => {
    const a = rowFingerprint({ x: 1 })
    expect(a).toBe(rowFingerprint({ x: 1 }))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })
})
