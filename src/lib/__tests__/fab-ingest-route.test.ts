// The DOOR, not the decision. fab-ingest.test.ts covers the pure logic; this
// covers the three things only the route can get wrong: the gate, the status
// code it hands the outbox worker, and whether it touches the database at all
// before it has decided the caller is allowed in.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const admin = vi.hoisted(() => {
  const state = {
    queueRow: null as Record<string, unknown> | null,
    fabJob: null as Record<string, unknown> | null,
    taskDup: null as Record<string, unknown> | null,
    upserts: [] as Array<{ table: string; row: unknown }>,
    inserts: [] as Array<{ table: string; row: unknown }>,
    updates: [] as Array<{ table: string; patch: unknown }>,
    error: null as { message: string } | null,
    touched: 0,
  }
  const from = (table: string) => {
    state.touched++
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'neq', 'is', 'in', 'limit', 'order']) chain[m] = self
    chain.maybeSingle = async () => {
      if (state.error) return { data: null, error: state.error }
      if (table === 'fab_ready_queue') return { data: state.queueRow, error: null }
      if (table === 'fab_jobs') return { data: state.fabJob, error: null }
      if (table === 'fab_tasks') return { data: state.taskDup, error: null }
      return { data: null, error: null }
    }
    chain.upsert = async (row: unknown) => {
      state.upserts.push({ table, row })
      return { error: state.error }
    }
    chain.insert = (row: unknown) => {
      state.inserts.push({ table, row })
      const ins: Record<string, unknown> = {
        select: () => ins,
        maybeSingle: async () => ({ data: { id: 'task-1' }, error: state.error }),
        then: (r: (v: { error: unknown }) => unknown) => r({ error: state.error }),
      }
      return ins
    }
    chain.update = (patch: unknown) => {
      state.updates.push({ table, patch })
      const up: Record<string, unknown> = {}
      for (const m of ['eq', 'neq', 'is', 'in']) up[m] = () => up
      up.select = async () => ({ data: [{ id: 'x' }], error: state.error })
      return up
    }
    return chain
  }
  return { state, client: { from } }
})

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => admin.client }))

const { POST } = await import('@/app/api/fab/ingest/route')

const SECRET = 'a-32-character-or-longer-test-secret'
const post = (body: unknown, secret?: string) =>
  POST(
    new Request('https://hytek-fab.vercel.app/api/fab/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-fab-import-secret': secret } : {}) },
      body: JSON.stringify(body),
    }),
  )

const release = {
  event_id: 'ev-1',
  event_type: 'job.released',
  quote_number: '26079902',
  occurred_at: '2026-09-07T02:00:00.000Z',
  payload: { quote_number: '26079902', stream: 'SS', release_version: 2, is_test: false },
}

beforeEach(() => {
  Object.assign(admin.state, {
    queueRow: null, fabJob: null, taskDup: null,
    upserts: [], inserts: [], updates: [], error: null, touched: 0,
  })
  process.env.FAB_IMPORT_SECRET = SECRET
})

describe('POST /api/fab/ingest — the gate', () => {
  it('401s with no header, and does not touch the database', async () => {
    const res = await post(release)
    expect(res.status).toBe(401)
    expect(admin.state.touched).toBe(0)
  })

  it('401s on a wrong secret', async () => {
    const res = await post(release, 'nope')
    expect(res.status).toBe(401)
    expect(admin.state.touched).toBe(0)
  })

  it('FAILS CLOSED when FAB_IMPORT_SECRET is unset — the right secret is refused too', async () => {
    delete process.env.FAB_IMPORT_SECRET
    expect((await post(release, SECRET)).status).toBe(401)
    expect((await post(release)).status).toBe(401)
    expect(admin.state.touched).toBe(0)
  })
})

describe('POST /api/fab/ingest — what the outbox worker is told', () => {
  it('an SS release is applied: 200 and one fab_ready_queue upsert', async () => {
    const res = await post(release, SECRET)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, applied: 'job.released', quote_number: '26079902' })
    expect(admin.state.upserts).toHaveLength(1)
    expect(admin.state.upserts[0].table).toBe('fab_ready_queue')
  })

  it('a stale redelivery is 200 {stale:true} and writes NOTHING', async () => {
    admin.state.queueRow = { quote_number: '26079902', last_event_at: '2026-09-09T00:00:00.000Z', materials_received: false, is_test: false, consumed_at: null }
    const res = await post(release, SECRET)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, stale: true })
    expect(admin.state.upserts).toHaveLength(0)
  })

  it("an LWS release is 200 ignored — not 4xx, which would red-card a healthy subscriber", async () => {
    const res = await post({ ...release, payload: { ...release.payload, stream: 'LWS' } }, SECRET)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, ignored: 'stream:LWS' })
    expect(admin.state.upserts).toHaveLength(0)
  })

  it('an unknown verb is 200 ignored', async () => {
    const res = await post({ ...release, event_type: 'job.won' }, SECRET)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, ignored: 'job.won' })
  })

  it('a malformed envelope is 400 — the one thing a person should be told about', async () => {
    const res = await post({}, SECRET)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ ok: false })
  })

  it('a database fault is 500, so the worker retries', async () => {
    admin.state.error = { message: 'connection reset' }
    const res = await post(release, SECRET)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/fab/ingest — fab_tasks', () => {
  const rework = {
    event_id: 'ev-r1',
    event_type: 'rework.raised',
    quote_number: '26079902',
    occurred_at: '2026-09-07T02:00:00.000Z',
    payload: { rework_id: 'rw-1', rework_number: 'RW-042', description: 'Beam short', affects_depts: 'fabrication' },
  }

  it('inserts a fab_task when fab has the job', async () => {
    admin.state.fabJob = { id: 'fabjob-1' }
    const res = await post(rework, SECRET)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, applied: 'rework.raised', fab_task_id: 'task-1' })
    expect(admin.state.inserts[0]).toMatchObject({ table: 'fab_tasks', row: { rework_id: 'rw-1', status: 'open' } })
  })

  it('a redelivered raise is 200 {duplicate:true} and inserts nothing', async () => {
    admin.state.fabJob = { id: 'fabjob-1' }
    admin.state.taskDup = { id: 'existing' }
    const res = await post(rework, SECRET)
    await expect(res.json()).resolves.toEqual({ ok: true, duplicate: true })
    expect(admin.state.inserts).toHaveLength(0)
  })

  it('skips when fab has not started the job — the Hub logs and carries on too', async () => {
    admin.state.fabJob = null
    await expect((await post(rework, SECRET)).json()).resolves.toMatchObject({ ok: true, ignored: expect.stringContaining('fab_jobs') })
    expect(admin.state.inserts).toHaveLength(0)
  })

  it('rework.resolved closes, and never asks for a fab_jobs row it does not need', async () => {
    const res = await post({ ...rework, event_id: 'ev-r2', event_type: 'rework.resolved', payload: { rework_id: 'rw-1' } }, SECRET)
    await expect(res.json()).resolves.toMatchObject({ ok: true, applied: 'rework.resolved', closed: 1 })
    expect(admin.state.updates[0]).toMatchObject({ table: 'fab_tasks', patch: { status: 'done' } })
  })

  it('rework.reopened clears completed_at', async () => {
    const res = await post({ ...rework, event_id: 'ev-r3', event_type: 'rework.reopened', payload: { rework_id: 'rw-1' } }, SECRET)
    await expect(res.json()).resolves.toMatchObject({ ok: true, reopened: 1 })
    expect(admin.state.updates[0]).toMatchObject({ table: 'fab_tasks', patch: { status: 'open', completed_at: null } })
  })
})
