// One login across the HYTEK apps on hytekframing.com.au (D226, 21/10/2026).
//
// Each app used to keep its Supabase login in its own browser storage, so
// signing into the Hub told Detailing, Install, Fab and Purchasing nothing and
// every app asked again. Staff who can't save passwords in Chrome typed it
// every time.
//
// With NEXT_PUBLIC_SHARED_LOGIN_DOMAIN set (to "hytekframing.com.au") and the
// page served from that domain, the login lives in ONE cookie for the whole
// domain instead. The cookie is written in exactly the format @supabase/ssr
// uses — "base64-" + base64url(JSON), split into <key>.0, <key>.1 … past 3180
// characters — because Purchasing already keeps its login that way, and all
// five apps must read each other's cookie.
//
// Unset, or on any other address (vercel.app, staging, previews, localhost),
// nothing changes: the login stays in this app's localStorage exactly as
// before. Turning it off = remove the variable and redeploy.
//
// The same file sits in hytek-hub, hytek-detailing, hytek-fab, hytek-install
// and hytek-purchasing. Keep the copies identical.

const BASE64_PREFIX = 'base64-'
// @supabase/ssr's MAX_CHUNK_SIZE. base64url never needs URI-escaping, so a
// chunk is simply the next 3180 characters.
const MAX_CHUNK_SIZE = 3180
// @supabase/ssr's cookie lifetime: 400 days, the most a browser allows.
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/** The shared-login domain when the switch is on AND `host` sits under it; otherwise null. */
export function sharedLoginDomain(host: string | null | undefined): string | null {
  // Literal process.env.NEXT_PUBLIC_… so Next.js inlines it into the browser bundle.
  const domain = (process.env.NEXT_PUBLIC_SHARED_LOGIN_DOMAIN ?? '').trim().replace(/^\.+/, '').toLowerCase()
  if (!domain || !host) return null
  const h = host.split(':')[0].trim().toLowerCase()
  return h === domain || h.endsWith(`.${domain}`) ? domain : null
}

/** Cookie options for @supabase/ssr clients (Purchasing) — null when the switch is off for this host. */
export function sharedLoginCookieOptions(host: string | null | undefined): { domain: string; secure: true } | null {
  const domain = sharedLoginDomain(host)
  return domain ? { domain, secure: true } : null
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
}

/** The cookie itself or one of its numbered chunks (same rule as @supabase/ssr's isChunkLike). */
function isChunkOf(name: string, key: string): boolean {
  if (name === key) return true
  const m = name.match(/^(.*)[.](0|[1-9][0-9]*)$/)
  return !!m && m[1] === key
}

function readCookies(doc: Document): Map<string, string> {
  const jar = new Map<string, string>()
  for (const part of doc.cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name || jar.has(name)) continue
    let value = part.slice(eq + 1).trim()
    try { value = decodeURIComponent(value) } catch { /* keep it raw */ }
    jar.set(name, value)
  }
  return jar
}

function setCookie(doc: Document, name: string, value: string, maxAge: number, domain: string | null): void {
  doc.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure` +
    (domain ? `; Domain=${domain}` : '')
}

/**
 * Remove leftover HOST-ONLY copies of the login cookie on this address.
 * Purchasing kept its login in a host-only cookie of the same name; left in
 * place it would shadow the shared one. Clearing without a Domain attribute
 * can never touch the shared cookie.
 */
export function clearHostOnlyLoginCookies(storageKey: string, doc: Document = document): void {
  for (const name of readCookies(doc).keys()) {
    if (isChunkOf(name, storageKey)) setCookie(doc, name, '', 0, null)
  }
}

/** A supabase-js `auth.storage` that keeps the login in the shared domain cookie. */
export function sharedLoginStorage(domain: string, doc: Document = document) {
  return {
    getItem(key: string): string | null {
      const jar = readCookies(doc)
      let raw = jar.get(key) ?? null
      if (!raw) {
        const parts: string[] = []
        for (let i = 0; jar.get(`${key}.${i}`); i++) parts.push(jar.get(`${key}.${i}`) as string)
        raw = parts.length ? parts.join('') : null
      }
      if (!raw) return null
      if (!raw.startsWith(BASE64_PREFIX)) return raw
      try {
        const decoded = fromBase64Url(raw.slice(BASE64_PREFIX.length))
        JSON.parse(decoded) // chunks from two different writes → treat as signed out, as @supabase/ssr does
        return decoded
      } catch {
        return null
      }
    },
    setItem(key: string, value: string): void {
      const encoded = BASE64_PREFIX + toBase64Url(value)
      const chunks = encoded.length <= MAX_CHUNK_SIZE
        ? [{ name: key, value: encoded }]
        : Array.from({ length: Math.ceil(encoded.length / MAX_CHUNK_SIZE) }, (_, i) => ({
          name: `${key}.${i}`,
          value: encoded.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
        }))
      const keep = new Set(chunks.map(c => c.name))
      for (const name of readCookies(doc).keys()) {
        if (isChunkOf(name, key) && !keep.has(name)) setCookie(doc, name, '', 0, domain)
      }
      for (const c of chunks) setCookie(doc, c.name, c.value, MAX_AGE_SECONDS, domain)
    },
    removeItem(key: string): void {
      for (const name of readCookies(doc).keys()) {
        if (isChunkOf(name, key)) {
          setCookie(doc, name, '', 0, domain)
          setCookie(doc, name, '', 0, null)
        }
      }
    },
  }
}

/**
 * supabase-js options for this app's browser client: the shared cookie when
 * the switch is on for this address, otherwise undefined (today's
 * localStorage). Only `storage` changes — flow type, refresh and the rest stay
 * as they were.
 */
export function sharedLoginClientOptions() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
  const domain = sharedLoginDomain(window.location.hostname)
  return domain ? { auth: { storage: sharedLoginStorage(domain) } } : undefined
}
