// HMAC-signed SUBCONTRACTOR session tokens. NOT Supabase auth and NOT a kiosk
// token: a distinct audience ('sub') signed with a SEPARATE secret so a sub
// token can never validate against getUserCaller/getSupervisorCaller and a
// kiosk token can never validate here. Token = base64url(payload).base64url(hmac).
//
// The token deliberately carries only the account id — grants (which packages
// the sub may touch) are re-expanded LIVE from fab_sub_grants on every request,
// so revoking a grant or deactivating the account takes effect immediately,
// regardless of token TTL.
import { createHmac, timingSafeEqual } from 'crypto'

export interface SubSession {
  aud: 'sub'
  sub_account_id: string
  contractor_name: string
  exp: number // unix seconds
}

// A sub works from their own phone (not a shared tablet), so the TTL is a shift,
// not 30 minutes. Instant revocation comes from the live grant expansion above.
const TTL_SECONDS = 12 * 60 * 60

function secret(): string {
  const s = process.env.SUB_TOKEN_SECRET
  if (!s || s.length < 32) throw new Error('SUB_TOKEN_SECRET must be set to 32+ chars')
  return s
}

export function createSubToken(sub_account_id: string, contractor_name: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const payload = Buffer.from(
    JSON.stringify({ aud: 'sub', sub_account_id, contractor_name, exp }),
  ).toString('base64url')
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySubToken(token: string): SubSession | null {
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

  let session: SubSession
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
  if (
    session.aud !== 'sub' ||
    typeof session.sub_account_id !== 'string' ||
    typeof session.contractor_name !== 'string' ||
    typeof session.exp !== 'number'
  ) {
    return null
  }
  if (session.exp < Math.floor(Date.now() / 1000)) return null
  return session
}
