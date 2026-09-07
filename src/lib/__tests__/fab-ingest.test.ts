import { describe, it, expect } from 'vitest'
import {
  decideQueue,
  decideTask,
  isQueueEvent,
  normaliseFabEnvelope,
  parseAffectsDepts,
  VARIATION_TERMINAL_STATUSES,
  type FabEnvelope,
  type ReadyQueueRow,
} from '../fab-ingest'

// The exact wire shape hytek-hub lib/outbox/subscribers/lws.ts posts, which is
// what the fab subscriber will post too (Lane 3 CP5).
const outboxRow = (over: Record<string, unknown> = {}) => ({
  event_id: 'ev-1',
  event_type: 'job.released',
  quote_number: '26079902',
  occurred_at: '2026-09-07T02:00:00.000Z',
  payload: { quote_number: '26079902', stream: 'SS', release_version: 2, is_test: false },
  ...over,
})

const env = (over: Partial<FabEnvelope> = {}): FabEnvelope => ({
  event_id: 'ev-1',
  event: 'job.released',
  occurred_at: '2026-09-07T02:00:00.000Z',
  quote_number: '26079902',
  payload: {},
  ...over,
})

const row = (over: Partial<ReadyQueueRow> = {}): ReadyQueueRow => ({
  quote_number: '26079902',
  hubspot_deal_id: null,
  ss_release_version: null,
  ss_released_at: null,
  ss_released_by: null,
  materials_received: false,
  materials_received_at: null,
  on_site_date: null,
  last_event_at: '2026-09-01T00:00:00.000Z',
  consumed_at: null,
  is_test: false,
  ...over,
})

describe('normaliseFabEnvelope', () => {
  it('reads the outbox row shape the Hub actually posts', () => {
    const r = normaliseFabEnvelope(outboxRow())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.env).toMatchObject({
      event_id: 'ev-1',
      event: 'job.released',
      quote_number: '26079902',
      occurred_at: '2026-09-07T02:00:00.000Z',
    })
    expect(r.env.payload.stream).toBe('SS')
  })

  it('reads the lane file spelling too — {event, job} — so one door serves both', () => {
    const r = normaliseFabEnvelope({
      event_id: 'ev-2',
      event: 'materials.received',
      occurred_at: '2026-09-07T03:00:00.000Z',
      job: { quote_number: '26079903' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.env.quote_number).toBe('26079903')
    expect(r.env.event).toBe('materials.received')
  })

  it('a verb fab does not handle is IGNORED, not malformed', () => {
    // The route answers 200 to this. A 4xx would make the outbox worker retry a
    // healthy delivery three times and red-card a working subscriber.
    const r = normaliseFabEnvelope(outboxRow({ event_type: 'job.won' }))
    expect(r).toEqual({ ok: false, kind: 'ignored', event: 'job.won' })
  })

  it('job.updated is IGNORED — the lane file named a verb that has never existed', () => {
    const r = normaliseFabEnvelope(outboxRow({ event_type: 'job.updated' }))
    expect(r).toEqual({ ok: false, kind: 'ignored', event: 'job.updated' })
  })

  it.each([
    ['no event', { event_id: 'e', quote_number: 'q', occurred_at: 't' }, 'event_type'],
    ['no event_id', { event_type: 'job.released', quote_number: 'q', occurred_at: 't' }, 'event_id'],
    ['no quote_number', { event_type: 'job.released', event_id: 'e', occurred_at: 't' }, 'quote_number'],
    ['no occurred_at', { event_type: 'job.released', event_id: 'e', quote_number: 'q' }, 'occurred_at'],
  ])('%s is malformed (400, not a retry loop)', (_name, body, needle) => {
    const r = normaliseFabEnvelope(body)
    expect(r.ok).toBe(false)
    if (r.ok || r.kind !== 'malformed') throw new Error('expected malformed')
    expect(r.error).toContain(needle)
  })

  it('refuses a non-object body', () => {
    expect(normaliseFabEnvelope(null).ok).toBe(false)
    expect(normaliseFabEnvelope([1, 2]).ok).toBe(false)
    expect(normaliseFabEnvelope('job.released').ok).toBe(false)
  })
})

describe('decideQueue', () => {
  it('an SS release writes the version, the time and who released it', () => {
    const d = decideQueue(
      env({ payload: { stream: 'SS', release_version: 3, released_by: 'Dave', hubspot_deal_id: '99', is_test: false } }),
      null,
    )
    expect(d).toEqual({
      action: 'upsert',
      patch: {
        quote_number: '26079902',
        last_event_at: '2026-09-07T02:00:00.000Z',
        hubspot_deal_id: '99',
        is_test: false,
        ss_release_version: 3,
        ss_released_at: '2026-09-07T02:00:00.000Z',
        ss_released_by: 'Dave',
      },
    })
  })

  it("an LWS release is IGNORED — it is the other factory's", () => {
    const d = decideQueue(env({ payload: { stream: 'LWS' } }), null)
    expect(d).toEqual({ action: 'ignored', reason: 'stream:LWS' })
  })

  it("'LGS' is not a stream the Hub sends — the lane file's spelling matches nothing", () => {
    // Proof that comparing against 'LGS' would have been a silent no-op: the
    // Hub's own validator only ever emits 'SS' or 'LWS'.
    const d = decideQueue(env({ payload: { stream: 'LGS' } }), null)
    expect(d).toEqual({ action: 'ignored', reason: 'stream:LGS' })
  })

  it('a release with no stream is treated as fab’s — a missed SS release is worse', () => {
    const d = decideQueue(env({ payload: {} }), null)
    expect(d.action).toBe('upsert')
  })

  it('materials.received sets the flag and its own timestamp', () => {
    const d = decideQueue(
      env({ event: 'materials.received', payload: { received_at: '2026-09-06T01:00:00.000Z' } }),
      null,
    )
    if (d.action !== 'upsert') throw new Error('expected upsert')
    expect(d.patch).toMatchObject({ materials_received: true, materials_received_at: '2026-09-06T01:00:00.000Z' })
  })

  it('an event older than the stored one is STALE — a retry never undoes a newer fact', () => {
    const d = decideQueue(
      env({ occurred_at: '2026-09-01T00:00:00.000Z' }),
      row({ last_event_at: '2026-09-05T00:00:00.000Z' }),
    )
    expect(d).toEqual({ action: 'stale' })
  })

  it('the same event redelivered is applied again, harmlessly (equal, not older)', () => {
    const d = decideQueue(
      env({ occurred_at: '2026-09-05T00:00:00.000Z' }),
      row({ last_event_at: '2026-09-05T00:00:00.000Z' }),
    )
    expect(d.action).toBe('upsert')
  })

  it('an event that omits the deal id does not blank a known one', () => {
    const d = decideQueue(env({ event: 'job.revised', payload: {} }), row({ hubspot_deal_id: '77' }))
    if (d.action !== 'upsert') throw new Error('expected upsert')
    expect('hubspot_deal_id' in d.patch).toBe(false)
    expect('on_site_date' in d.patch).toBe(false)
  })

  it('job.revised never grants a release — only job.released does', () => {
    const d = decideQueue(env({ event: 'job.revised', payload: { on_site_date: '2026-11-01' } }), null)
    if (d.action !== 'upsert') throw new Error('expected upsert')
    expect(d.patch).toEqual({
      quote_number: '26079902',
      last_event_at: '2026-09-07T02:00:00.000Z',
      on_site_date: '2026-11-01',
    })
  })

  it('a rework verb is not a queue event', () => {
    expect(decideQueue(env({ event: 'rework.raised' }), null).action).toBe('ignored')
    expect(isQueueEvent('rework.raised')).toBe(false)
    expect(isQueueEvent('job.released')).toBe(true)
  })
})

describe('parseAffectsDepts', () => {
  it('splits the comma-joined string the Hub sends (arrays are dropped upstream)', () => {
    expect(parseAffectsDepts('detailing,fabrication')).toEqual(['detailing', 'fabrication'])
    expect(parseAffectsDepts(' Fabrication , NONSENSE ')).toEqual(['fabrication'])
    expect(parseAffectsDepts(['fabrication'])).toEqual([])
    expect(parseAffectsDepts('')).toEqual([])
  })
})

describe('decideTask — the rows the Hub writes today, written by their owner', () => {
  const raise = (over: Record<string, unknown> = {}) =>
    env({
      event: 'rework.raised',
      payload: {
        rework_id: 'rw-1',
        rework_number: 'RW-042',
        description: 'Beam short by 40mm',
        affects_depts: 'fabrication,install',
        ...over,
      },
    })

  it('inserts the same shape hytek-hub apply-rework-variation.ts inserts', () => {
    const d = decideTask(raise(), 'fabjob-1')
    expect(d).toEqual({
      action: 'insert',
      key: { column: 'rework_id', value: 'rw-1' },
      row: {
        fab_job_id: 'fabjob-1',
        description: '🔴 REWORK RW-042: Beam short by 40mm',
        status: 'open',
        created_by: 'hub:rework:rw-1',
        rework_id: 'rw-1',
      },
    })
  })

  it('skips when fabrication is not on affects_depts', () => {
    expect(decideTask(raise({ affects_depts: 'detailing' }), 'fabjob-1')).toEqual({
      action: 'ignored',
      reason: 'fabrication not affected',
    })
  })

  it('skips when fab has not started the job — the Hub logs and carries on too', () => {
    expect(decideTask(raise(), null)).toEqual({
      action: 'ignored',
      reason: 'no fab_jobs row — fabrication not started',
    })
  })

  it('a variation raise carries the ⚠ marker and the variation_id column', () => {
    const d = decideTask(
      env({
        event: 'variation.raised',
        payload: { variation_id: 'v-9', variation_number: 'VAR-7', description: 'Extra brace', affects_depts: 'fabrication' },
      }),
      'fabjob-1',
    )
    if (d.action !== 'insert') throw new Error('expected insert')
    expect(d.row).toMatchObject({ description: '⚠ VARIATION VAR-7: Extra brace', variation_id: 'v-9', created_by: 'hub:variation:v-9' })
  })

  it('rework.resolved closes by rework_id', () => {
    expect(decideTask(env({ event: 'rework.resolved', payload: { rework_id: 'rw-1' } }), null)).toEqual({
      action: 'close',
      column: 'rework_id',
      value: 'rw-1',
    })
  })

  it('rework.reopened reopens by rework_id', () => {
    expect(decideTask(env({ event: 'rework.reopened', payload: { rework_id: 'rw-1' } }), null)).toEqual({
      action: 'reopen',
      column: 'rework_id',
      value: 'rw-1',
    })
  })

  it.each([...VARIATION_TERMINAL_STATUSES])('variation status %s closes the task', (status) => {
    expect(decideTask(env({ event: 'variation.status_changed', payload: { variation_id: 'v-9', status } }), null)).toEqual({
      action: 'close',
      column: 'variation_id',
      value: 'v-9',
    })
  })

  it.each(['raised', 'priced', 'submitted', 'approved'])(
    'variation status %s leaves the task OPEN — the work is still live',
    (status) => {
      const d = decideTask(env({ event: 'variation.status_changed', payload: { variation_id: 'v-9', status } }), null)
      expect(d.action).toBe('ignored')
    },
  )

  it('a missing id is ignored, never a crash', () => {
    expect(decideTask(env({ event: 'rework.resolved', payload: {} }), null).action).toBe('ignored')
    expect(decideTask(env({ event: 'variation.status_changed', payload: { status: 'invoiced' } }), null).action).toBe('ignored')
    expect(decideTask(env({ event: 'rework.raised', payload: { affects_depts: 'fabrication' } }), 'f1').action).toBe('ignored')
  })
})
