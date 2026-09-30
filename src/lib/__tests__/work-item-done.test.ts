import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildWorkItemDoneEvent, flushOwedWorkItems, hoursByTask, workItemOf } from '../work-item-done'

describe('buildWorkItemDoneEvent — the contract with the Hub', () => {
  it('builds the agreed body, department fabrication', () => {
    const r = buildWorkItemDoneEvent({ quoteNumber: '26091401', row: { rework_id: 'rw-1' }, doneAt: '2026-09-30T03:00:00.000Z', actualHours: 4.004 })
    expect(r).toEqual({
      ok: true,
      event: {
        event: 'work_item_done',
        quote_number: '26091401',
        deal_id: null,
        occurred_at: '2026-09-30T03:00:00.000Z',
        idempotency_key: 'work-item-done:rework:rw-1:fabrication',
        payload: { kind: 'rework', item_id: 'rw-1', department: 'fabrication', done_at: '2026-09-30T03:00:00.000Z', actual_hours: 4 },
      },
    })
  })
  it('omits hours when none were logged; refuses an ordinary task or a missing number', () => {
    const r = buildWorkItemDoneEvent({ quoteNumber: 'Q', row: { variation_id: 'v-1' }, doneAt: 't' })
    expect(r.ok && r.event.payload).toEqual({ kind: 'variation', item_id: 'v-1', department: 'fabrication', done_at: 't' })
    expect(buildWorkItemDoneEvent({ quoteNumber: 'Q', row: {}, doneAt: 't' })).toEqual({ ok: false, reason: 'not_a_work_item' })
    expect(buildWorkItemDoneEvent({ quoteNumber: ' ', row: { variation_id: 'v' }, doneAt: 't' })).toEqual({ ok: false, reason: 'no_job_number' })
  })
  it('workItemOf / hoursByTask', () => {
    expect(workItemOf({ variation_id: null, rework_id: null })).toBeNull()
    expect(hoursByTask([{ task_id: 'a', hours: 1 }, { task_id: 'a', hours: 2.5 }, { task_id: null, hours: 9 }]).get('a')).toBe(3.5)
  })
})

function fakeAdmin(owed: Record<string, unknown>[]) {
  const clears: unknown[] = []
  const events: unknown[] = []
  const admin = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'not', 'order', 'in']) q[m] = () => q
      q.limit = async () => ({ data: owed, error: null })
      q.then = (res: (v: unknown) => void) => res({ data: table === 'fab_time_entries' ? [{ task_id: 't1', hours: 2 }] : [], error: null })
      q.insert = (row: unknown) => { events.push(row); return Promise.resolve({ error: null }) }
      q.update = () => {
        const u: Record<string, unknown> = {}
        const f: Record<string, unknown> = {}
        u.eq = (c: string, v: unknown) => { f[c] = v; if (c === 'work_item_done_owed_at') { clears.push(f.id); return Promise.resolve({ error: null }) } return u }
        return u
      }
      return q
    },
  } as unknown as SupabaseClient
  return { admin, clears, events }
}

const owed = [{ id: 't1', fab_job_id: null, quote_number: '26091401', variation_id: 'v-1', rework_id: null, completed_at: '2026-09-30T03:00:00Z', work_item_done_owed_at: '2026-09-30T03:00:00Z', fab_jobs: null }]
const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); process.env.HUB_TOKEN_FAB = 'fab-token' })
afterEach(() => vi.unstubAllGlobals())

describe('flushOwedWorkItems', () => {
  it('sends under HUB_TOKEN_FAB with hours from fab_time_entries, then clears the debt', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const a = fakeAdmin(owed)
    expect(await flushOwedWorkItems(a.admin)).toEqual({ sent: 1, failed: 0, dropped: 0 })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer fab-token')
    expect(JSON.parse(init.body)).toMatchObject({ event: 'work_item_done', quote_number: '26091401', payload: { actual_hours: 2, department: 'fabrication' } })
    expect(a.clears).toEqual(['t1'])
  })
  it('a Hub without the verb yet (400) keeps the debt; the just-closed task lands on Exceptions', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'unknown verb' }), { status: 400 }))
    const a = fakeAdmin(owed)
    expect(await flushOwedWorkItems(a.admin, { logFor: 't1', actor: 'Troy' })).toMatchObject({ failed: 1 })
    expect(a.clears).toEqual([])
    expect(a.events).toHaveLength(1)
  })
  it('a quiet retry logs nothing to Exceptions', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
    const a = fakeAdmin(owed)
    await flushOwedWorkItems(a.admin)
    expect(a.events).toHaveLength(0)
  })
})
