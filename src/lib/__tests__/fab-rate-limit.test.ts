import { describe, it, expect } from 'vitest'
import {
  clientIp,
  failureDelayMs,
  warnSupervisor,
  recordPinFailure,
  clearPinFailures,
  ATTEMPT_WINDOW_MS,
  SEE_SUPERVISOR_THRESHOLD,
  MAX_DELAY_MS,
} from '../fab-rate-limit'

// ── A faithful in-memory stand-in for the Supabase admin client ──────────────
// Stores rows and supports exactly the query shapes fab-rate-limit uses:
//   .from(t).insert(obj)
//   .from(t).delete().eq(col,val)[.lt(col,val)]
//   .from(t).select(cols, {count:'exact',head:true}).eq(col,val).gte(col,val)
// ISO timestamps compare lexicographically === chronologically.
function makeFakeAdmin(initial: Array<{ ip: string; created_at: string }> = []) {
  let rows = initial.map((r, i) => ({ id: i + 1, ...r }))
  let idSeq = rows.length
  return {
    _rows: () => rows,
    from() {
      return {
        insert(obj: { ip: string; created_at?: string }) {
          const o = obj
          rows.push({ id: ++idSeq, ip: o.ip, created_at: o.created_at ?? new Date().toISOString() })
          return Promise.resolve({ error: null })
        },
        delete() {
          const filters: Array<(r: { ip: string; created_at: string }) => boolean> = []
          const builder = {
            eq(col: 'ip' | 'created_at', val: string) {
              filters.push((r) => r[col] === val)
              return builder
            },
            lt(col: 'ip' | 'created_at', val: string) {
              filters.push((r) => r[col] < val)
              return builder
            },
            then(resolve: (v: { error: null }) => void) {
              rows = rows.filter((r) => !filters.every((f) => f(r)))
              resolve({ error: null })
            },
          }
          return builder
        },
        select() {
          const filters: Array<(r: { ip: string; created_at: string }) => boolean> = []
          const builder = {
            eq(col: 'ip' | 'created_at', val: string) {
              filters.push((r) => r[col] === val)
              return builder
            },
            gte(col: 'ip' | 'created_at', val: string) {
              filters.push((r) => r[col] >= val)
              return builder
            },
            then(resolve: (v: { count: number; error: null }) => void) {
              const matched = rows.filter((r) => filters.every((f) => f(r)))
              resolve({ count: matched.length, error: null })
            },
          }
          return builder
        },
      }
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAdmin = (f: ReturnType<typeof makeFakeAdmin>) => f as any

describe('clientIp', () => {
  it('uses the first hop of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })
    expect(clientIp(h)).toBe('203.0.113.7')
  })

  it('trims whitespace around the first hop', () => {
    const h = new Headers({ 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' })
    expect(clientIp(h)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip when no forwarded-for', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.9' })
    expect(clientIp(h)).toBe('198.51.100.9')
  })

  it('returns "unknown" when no client-ip headers are present', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})

describe('failureDelayMs', () => {
  it('does not delay the first miss', () => {
    expect(failureDelayMs(1)).toBe(0)
  })

  it('grows the delay with each successive miss', () => {
    expect(failureDelayMs(2)).toBeGreaterThan(0)
    expect(failureDelayMs(3)).toBeGreaterThan(failureDelayMs(2))
  })

  it('caps the delay at MAX_DELAY_MS', () => {
    expect(failureDelayMs(50)).toBe(MAX_DELAY_MS)
    expect(failureDelayMs(5)).toBeLessThanOrEqual(MAX_DELAY_MS)
  })
})

describe('warnSupervisor', () => {
  it('is false below the threshold', () => {
    expect(warnSupervisor(SEE_SUPERVISOR_THRESHOLD - 1)).toBe(false)
  })

  it('is true at or above the threshold', () => {
    expect(warnSupervisor(SEE_SUPERVISOR_THRESHOLD)).toBe(true)
    expect(warnSupervisor(SEE_SUPERVISOR_THRESHOLD + 5)).toBe(true)
  })

  it('first nudges the worker to their supervisor on the 4th miss', () => {
    // Three plain "wrong PIN" tries; the 4th switches to the supervisor message.
    expect(warnSupervisor(3)).toBe(false)
    expect(warnSupervisor(4)).toBe(true)
  })
})

describe('recordPinFailure', () => {
  it('returns 1 on the first failure for an IP', async () => {
    const fake = makeFakeAdmin()
    const count = await recordPinFailure(asAdmin(fake), '203.0.113.7')
    expect(count).toBe(1)
  })

  it('counts successive failures for the same IP within the window', async () => {
    const fake = makeFakeAdmin()
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    const third = await recordPinFailure(asAdmin(fake), '203.0.113.7')
    expect(third).toBe(3)
  })

  it('ignores failures older than the window', async () => {
    const stale = new Date(Date.now() - ATTEMPT_WINDOW_MS - 60_000).toISOString()
    const fake = makeFakeAdmin([
      { ip: '203.0.113.7', created_at: stale },
      { ip: '203.0.113.7', created_at: stale },
    ])
    const count = await recordPinFailure(asAdmin(fake), '203.0.113.7')
    expect(count).toBe(1)
  })

  it('keeps separate counts per IP', async () => {
    const fake = makeFakeAdmin()
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    const other = await recordPinFailure(asAdmin(fake), '198.51.100.9')
    expect(other).toBe(1)
  })
})

describe('clearPinFailures', () => {
  it('resets the count for an IP after a successful sign-in', async () => {
    const fake = makeFakeAdmin()
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    await clearPinFailures(asAdmin(fake), '203.0.113.7')
    const after = await recordPinFailure(asAdmin(fake), '203.0.113.7')
    expect(after).toBe(1)
  })

  it('only clears the given IP', async () => {
    const fake = makeFakeAdmin()
    await recordPinFailure(asAdmin(fake), '203.0.113.7')
    await recordPinFailure(asAdmin(fake), '198.51.100.9')
    await clearPinFailures(asAdmin(fake), '203.0.113.7')
    const other = await recordPinFailure(asAdmin(fake), '198.51.100.9')
    expect(other).toBe(2)
  })
})
