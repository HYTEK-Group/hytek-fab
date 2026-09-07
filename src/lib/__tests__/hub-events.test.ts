import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendFabEvent, sendFabEventLogged, summariseSends } from '../hub-events'
import { hubConfigured, hubToken, HUB_NOT_CONFIGURED } from '../hub'
import type { FabEventBody } from '../hub-event-builders'

const BODY: FabEventBody = {
  event: 'fab_progress',
  quote_number: '26070101',
  deal_id: null,
  occurred_at: '2026-09-07T02:00:00.000Z',
  payload: { total_marks: 1 },
  idempotency_key: 'fab_progress:26070101:abcdef0123456789',
}

/** Minimal fab_events recorder — enough for logFabEvent's single insert. */
function fakeAdmin() {
  const inserted: Record<string, unknown>[] = []
  const admin = {
    from(table: string) {
      expect(table).toBe('fab_events')
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, inserted }
}

describe('the token', () => {
  afterEach(() => {
    delete process.env.HUB_TOKEN_FAB
    delete process.env.HUB_INTERNAL_TOKEN
  })

  it('is HUB_TOKEN_FAB and nothing else — the unscoped Hub token is gone', () => {
    process.env.HUB_INTERNAL_TOKEN = 'the-master-key'
    expect(hubToken()).toBe('')
    expect(hubConfigured()).toBe(false)
    process.env.HUB_TOKEN_FAB = 'fab-scoped'
    expect(hubToken()).toBe('fab-scoped')
    expect(hubConfigured()).toBe(true)
  })

  it('treats whitespace as unset', () => {
    process.env.HUB_TOKEN_FAB = '   '
    expect(hubConfigured()).toBe(false)
  })
})

describe('sendFabEvent', () => {
  beforeEach(() => {
    process.env.HUB_TOKEN_FAB = 'fab-scoped'
  })
  afterEach(() => {
    delete process.env.HUB_TOKEN_FAB
    vi.unstubAllGlobals()
  })

  it('skips — never pretends — when the token is unset', async () => {
    delete process.env.HUB_TOKEN_FAB
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await sendFabEvent(BODY)
    expect(res).toEqual({ ok: false, status: 0, error: HUB_NOT_CONFIGURED, skipped: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs the body to the one door with the fab bearer', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchSpy)
    const res = await sendFabEvent(BODY)
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url).endsWith('/api/flow/event')).toBe(true)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer fab-scoped')
    expect(JSON.parse(init.body)).toEqual(BODY)
  })

  it('reports a rejected verb rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ ok: false, error: 'unknown event type "fab_progress"' }),
    }))
    const res = await sendFabEvent(BODY)
    expect(res).toEqual({ ok: false, status: 400, error: 'unknown event type "fab_progress"' })
  })

  it('treats a 200 that says ok:false as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: false, error: 'spoke fab may not send fab_progress' }),
    }))
    const res = await sendFabEvent(BODY)
    expect(res.ok).toBe(false)
  })

  it('never throws when the network does', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const res = await sendFabEvent(BODY)
    expect(res).toMatchObject({ ok: false, status: 503 })
  })

  it('hands the fetch an abort signal, and an abort is a failed send', async () => {
    let seen: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => {
      seen = init.signal
      // Simulate the timeout firing: the controller aborts, fetch rejects.
      return Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    }))
    const res = await sendFabEvent(BODY)
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(res).toMatchObject({ ok: false, status: 503 })
  })
})

describe('sendFabEventLogged', () => {
  afterEach(() => {
    delete process.env.HUB_TOKEN_FAB
    vi.unstubAllGlobals()
  })

  it('writes a hub_send_failed exception on a genuine failure', async () => {
    process.env.HUB_TOKEN_FAB = 'fab-scoped'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }))
    const { admin, inserted } = fakeAdmin()
    const res = await sendFabEventLogged(admin, BODY, 'job-1', 'jamie')
    expect(res.ok).toBe(false)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ fab_job_id: 'job-1', kind: 'hub_send_failed', actor: 'jamie' })
    expect(inserted[0].detail).toMatchObject({ event: 'fab_progress', status: 401 })
  })

  it('does NOT raise an exception when fab simply has no Hub credential', async () => {
    delete process.env.HUB_TOKEN_FAB
    const { admin, inserted } = fakeAdmin()
    const res = await sendFabEventLogged(admin, BODY, 'job-1', 'jamie')
    expect(res).toMatchObject({ skipped: true })
    expect(inserted).toHaveLength(0)
  })

  it('writes nothing on success', async () => {
    process.env.HUB_TOKEN_FAB = 'fab-scoped'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    const { admin, inserted } = fakeAdmin()
    expect((await sendFabEventLogged(admin, BODY, 'job-1', 'jamie')).ok).toBe(true)
    expect(inserted).toHaveLength(0)
  })
})

describe('summariseSends', () => {
  it('separates a failure from a skip so the browser can tell them apart', () => {
    expect(summariseSends([
      { ok: true },
      { ok: false, status: 400, error: 'nope' },
      { ok: false, status: 0, error: HUB_NOT_CONFIGURED, skipped: true },
    ])).toEqual({ sent: 1, failed: 1, skipped: 1, reason: HUB_NOT_CONFIGURED })
  })
})
