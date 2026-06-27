// HMAC-signed kiosk session tokens. NOT Supabase auth — used by the shared
// factory-floor tablet. Token = base64url(payload).base64url(hmac-sha256).
import { createHmac, timingSafeEqual } from 'crypto'

export interface KioskSession {
  worker_name: string
  role: 'admin' | 'supervisor' | 'fabricator'
  exp: number // unix seconds
}

const TTL_SECONDS = 30 * 60

function secret(): string {
  const s = process.env.KIOSK_SECRET
  if (!s || s.length < 32) throw new Error('KIOSK_SECRET must be set to 32+ chars')
  return s
}

export function createKioskToken(worker_name: string, role: KioskSession['role']): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const payload = Buffer.from(JSON.stringify({ worker_name, role, exp })).toString('base64url')
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyKioskToken(token: string): KioskSession | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payload || !sig) return null

  let expected: string
  try {
    expected = createHmac('sha256', secret()).update(payload).digest('base64url')
  } catch {
    return null
  }
  const eBuf = Buffer.from(expected)
  const sBuf = Buffer.from(sig)
  if (eBuf.length !== sBuf.length) return null
  if (!timingSafeEqual(eBuf, sBuf)) return null

  let session: KioskSession
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
  if (
    typeof session.worker_name !== 'string' ||
    !['admin', 'supervisor', 'fabricator'].includes(session.role) ||
    typeof session.exp !== 'number'
  ) {
    return null
  }
  if (session.exp < Math.floor(Date.now() / 1000)) return null
  return session
}
