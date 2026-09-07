// Which credential does fab actually connect with?
//
// The answer decides whether the passport is a description or a constraint, so
// it is asserted rather than assumed. These tests read the headers the client
// was built with — a comment claiming "runs as app_fab" is exactly the kind of
// unenforced assertion this restructure exists to remove.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSupabaseAdmin, supabaseAdminKeyMode, __resetSupabaseAdminForTests } from '../supabase-admin'

const created = vi.hoisted(() => ({ calls: [] as Array<{ url: string; key: string; opts: Record<string, unknown> }> }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts: Record<string, unknown>) => {
    created.calls.push({ url, key, opts })
    return { __client: true } as unknown
  },
}))

const ENV = { ...process.env }

beforeEach(() => {
  created.calls = []
  __resetSupabaseAdminForTests()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  delete process.env.SUPABASE_ROLE_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ENV }
  vi.restoreAllMocks()
})

const auth = (i = 0) =>
  ((created.calls[i].opts.global as { headers?: Record<string, string> } | undefined)?.headers ?? {}).Authorization

describe('getSupabaseAdmin', () => {
  it('uses the ANON key as apikey and the ROLE key as the bearer — that is what makes it app_fab', () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_ROLE_KEY = 'role-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key' // present, and must NOT be used
    getSupabaseAdmin()
    expect(created.calls).toHaveLength(1)
    expect(created.calls[0].key).toBe('anon-key')
    expect(auth()).toBe('Bearer role-key')
    expect(supabaseAdminKeyMode()).toBe('role')
    // The service key is nowhere in the client that was built.
    expect(JSON.stringify(created.calls[0])).not.toContain('service-key')
  })

  it('falls back to the service key when the role key is absent — and SAYS SO', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    getSupabaseAdmin()
    expect(created.calls[0].key).toBe('service-key')
    expect(auth()).toBeUndefined()
    expect(supabaseAdminKeyMode()).toBe('service-role')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('SERVICE-ROLE key'))
  })

  it('a role key with no anon key falls back and names the missing half', () => {
    // The half-configured case. Silently sending a role JWT with no apikey gets
    // a gateway rejection on every query, which reads as "the database is down".
    process.env.SUPABASE_ROLE_KEY = 'role-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    getSupabaseAdmin()
    expect(created.calls[0].key).toBe('service-key')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
  })

  it('throws with both names when there is no credential at all', () => {
    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_ROLE_KEY/)
    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('throws when the URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    expect(() => getSupabaseAdmin()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('caches — one client per process, not one per request', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin())
    expect(created.calls).toHaveLength(1)
  })

  it('the test reset clears the cache AND the mode', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    getSupabaseAdmin()
    __resetSupabaseAdminForTests()
    expect(supabaseAdminKeyMode()).toBeNull()
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_ROLE_KEY = 'role-key'
    getSupabaseAdmin()
    expect(supabaseAdminKeyMode()).toBe('role')
  })
})
