import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHostOnlyLoginCookies,
  sharedLoginCookieOptions,
  sharedLoginDomain,
  sharedLoginStorage,
} from '../shared-login'

// D232 shared login. The same test sits beside every copy of shared-login.ts.

// A made-up project reference — no code may name the live one.
const KEY = 'sb-testproject-auth-token'

// A browser cookie jar shared by several hosts: a cookie is identified by name
// + domain (or host-only), a Domain cookie is visible to every host under it,
// a host-only cookie only to the host that set it, Max-Age=0 deletes.
type Cookie = { name: string; value: string; domain: string | null; host: string }
function cookieJar() {
  const cookies: Cookie[] = []
  const visible = (c: Cookie, host: string) =>
    c.domain ? host === c.domain || host.endsWith(`.${c.domain}`) : c.host === host
  return {
    cookies,
    documentFor(host: string): Document {
      return {
        get cookie() {
          return cookies.filter(c => visible(c, host)).map(c => `${c.name}=${c.value}`).join('; ')
        },
        set cookie(line: string) {
          const [pair, ...attrs] = line.split(';').map(s => s.trim())
          const eq = pair.indexOf('=')
          const name = pair.slice(0, eq)
          const value = pair.slice(eq + 1)
          let domain: string | null = null
          let maxAge: number | null = null
          for (const a of attrs) {
            const [k, v] = a.split('=')
            if (k.toLowerCase() === 'domain') domain = v.replace(/^\./, '').toLowerCase()
            if (k.toLowerCase() === 'max-age') maxAge = Number(v)
          }
          if (domain && !(host === domain || host.endsWith(`.${domain}`))) return // browser refuses
          const i = cookies.findIndex(c => c.name === name && c.domain === domain && (domain || c.host === host))
          if (i >= 0) cookies.splice(i, 1)
          if (maxAge === null || maxAge > 0) cookies.push({ name, value, domain, host })
        },
      } as unknown as Document
    },
  }
}

// Reference values made with @supabase/ssr 0.12.0's own stringToBase64URL and
// createChunks (the library Purchasing uses) on 21/10/2026.
function bigSession(): string {
  const fill = createHash('sha256').update('hytek').digest('hex').repeat(80)
  return JSON.stringify({
    access_token: 'a.' + fill.slice(0, 2400),
    refresh_token: 'r1',
    user: { id: 'u1', email: 'zoë@hytekframing.com.au', user_metadata: { name: 'Zoë 🚧 Smith' } },
  })
}
const SSR_BIG_SHA = '8a7dc15d16d6adeef3f3a403be6ec521cafc672e76fbcf2164d7026f2268cd5a'
const SSR_SMALL = 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4IiwidXNlciI6eyJlbWFpbCI6Inpvw6tAeCJ9fQ'

afterEach(() => vi.unstubAllEnvs())

describe('sharedLoginDomain — the on/off switch', () => {
  it('is off when the variable is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_SHARED_LOGIN_DOMAIN', '')
    expect(sharedLoginDomain('hub.hytekframing.com.au')).toBeNull()
    expect(sharedLoginCookieOptions('hub.hytekframing.com.au')).toBeNull()
  })

  it('is on only for addresses under the domain', () => {
    vi.stubEnv('NEXT_PUBLIC_SHARED_LOGIN_DOMAIN', '.HytekFraming.com.au ')
    expect(sharedLoginDomain('hub.hytekframing.com.au')).toBe('hytekframing.com.au')
    expect(sharedLoginDomain('dispatch.hytekframing.com.au:443')).toBe('hytekframing.com.au')
    expect(sharedLoginDomain('hytek-hub.vercel.app')).toBeNull()
    expect(sharedLoginDomain('localhost')).toBeNull()
    expect(sharedLoginDomain('evilhytekframing.com.au')).toBeNull()
    expect(sharedLoginCookieOptions('purchasing.hytekframing.com.au')).toEqual({ domain: 'hytekframing.com.au', secure: true })
  })
})

describe('sharedLoginStorage — the cookie', () => {
  it('writes exactly what @supabase/ssr writes, chunked past 3180 characters', () => {
    const jar = cookieJar()
    sharedLoginStorage('hytekframing.com.au', jar.documentFor('hub.hytekframing.com.au')).setItem(KEY, bigSession())
    expect(jar.cookies.map(c => c.name)).toEqual([`${KEY}.0`, `${KEY}.1`])
    expect(jar.cookies.every(c => c.domain === 'hytekframing.com.au')).toBe(true)
    const sha = createHash('sha256').update(jar.cookies.map(c => `${c.name}=${c.value}`).join(';')).digest('hex')
    expect(sha).toBe(SSR_BIG_SHA)

    sharedLoginStorage('hytekframing.com.au', jar.documentFor('hub.hytekframing.com.au'))
      .setItem(KEY, JSON.stringify({ access_token: 'x', user: { email: 'zoë@x' } }))
    expect(jar.cookies).toHaveLength(1) // the old chunks are cleared
    expect(jar.cookies[0]).toMatchObject({ name: KEY, value: SSR_SMALL })
  })

  it('reads a cookie @supabase/ssr wrote', async () => {
    const jar = cookieJar()
    jar.documentFor('purchasing.hytekframing.com.au').cookie = `${KEY}=${SSR_SMALL}; Domain=hytekframing.com.au; Path=/`
    const read = await sharedLoginStorage('hytekframing.com.au', jar.documentFor('hub.hytekframing.com.au')).getItem(KEY)
    expect(read).toBe(JSON.stringify({ access_token: 'x', user: { email: 'zoë@x' } }))
  })

  it('a login made in one app is seen by the others; signing out signs out of all', async () => {
    const jar = cookieJar()
    const hub = sharedLoginStorage('hytekframing.com.au', jar.documentFor('hub.hytekframing.com.au'))
    const detailing = sharedLoginStorage('hytekframing.com.au', jar.documentFor('detailing.hytekframing.com.au'))
    hub.setItem(KEY, bigSession())
    expect(await detailing.getItem(KEY)).toBe(bigSession())
    detailing.removeItem(KEY)
    expect(await hub.getItem(KEY)).toBeNull()
    expect(jar.cookies).toHaveLength(0)
  })

  it('treats a mixed-up or damaged cookie as signed out', async () => {
    const jar = cookieJar()
    const doc = jar.documentFor('hub.hytekframing.com.au')
    doc.cookie = `${KEY}=base64-bm90IGpzb24; Domain=hytekframing.com.au` // "not json"
    expect(await sharedLoginStorage('hytekframing.com.au', doc).getItem(KEY)).toBeNull()
  })

  it('leaves other cookies alone', () => {
    const jar = cookieJar()
    const doc = jar.documentFor('hub.hytekframing.com.au')
    doc.cookie = `${KEY}-code-verifier=abc; Domain=hytekframing.com.au`
    doc.cookie = 'hub_owner=1'
    sharedLoginStorage('hytekframing.com.au', doc).removeItem(KEY)
    expect(jar.cookies.map(c => c.name)).toEqual([`${KEY}-code-verifier`, 'hub_owner'])
  })
})

describe('clearHostOnlyLoginCookies', () => {
  it('removes this address\'s old host-only login and never the shared one', () => {
    const jar = cookieJar()
    const doc = jar.documentFor('purchasing.hytekframing.com.au')
    doc.cookie = `${KEY}.0=old`
    doc.cookie = `${KEY}.1=old`
    doc.cookie = `${KEY}=${SSR_SMALL}; Domain=hytekframing.com.au`
    clearHostOnlyLoginCookies(KEY, doc)
    expect(jar.cookies).toEqual([expect.objectContaining({ name: KEY, domain: 'hytekframing.com.au' })])
  })
})
