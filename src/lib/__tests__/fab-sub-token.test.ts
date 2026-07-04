import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSubToken, verifySubToken } from '../fab-sub-token'
import { createKioskToken, verifyKioskToken } from '../fab-kiosk-token'

const SUB_SECRET = 'sub-secret-0123456789abcdef0123456789abcdef'
const KIOSK_SECRET = 'kiosk-secret-0123456789abcdef0123456789abcdef'

describe('fab-sub-token', () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env, SUB_TOKEN_SECRET: SUB_SECRET, KIOSK_SECRET }
  })
  afterEach(() => {
    process.env = env
  })

  it('round-trips a valid token', () => {
    const t = createSubToken('acc-123', 'Precision Steel')
    const s = verifySubToken(t)
    expect(s).not.toBeNull()
    expect(s!.aud).toBe('sub')
    expect(s!.sub_account_id).toBe('acc-123')
    expect(s!.contractor_name).toBe('Precision Steel')
    expect(s!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects a tampered payload', () => {
    const t = createSubToken('acc-123', 'Precision Steel')
    const [payload, sig] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)]
    const forged = Buffer.from(
      JSON.stringify({ aud: 'sub', sub_account_id: 'acc-EVIL', contractor_name: 'X', exp: 9999999999 }),
    ).toString('base64url')
    expect(verifySubToken(`${forged}.${sig}`)).toBeNull()
    expect(verifySubToken(`${payload}.AAAA`)).toBeNull()
  })

  it('rejects garbage and empty tokens', () => {
    expect(verifySubToken('')).toBeNull()
    expect(verifySubToken('no-dot-here')).toBeNull()
    expect(verifySubToken('a.b')).toBeNull()
  })

  it('rejects an expired token', () => {
    // Hand-craft an expired token with the real secret.
    const { createHmac } = require('crypto') as typeof import('crypto')
    const payload = Buffer.from(
      JSON.stringify({
        aud: 'sub', sub_account_id: 'acc-1', contractor_name: 'X',
        exp: Math.floor(Date.now() / 1000) - 10,
      }),
    ).toString('base64url')
    const sig = createHmac('sha256', SUB_SECRET).update(payload).digest('base64url')
    expect(verifySubToken(`${payload}.${sig}`)).toBeNull()
  })

  it('a KIOSK token never validates as a sub token (separate secret + aud)', () => {
    const kiosk = createKioskToken('Supervisor', 'supervisor')
    expect(verifySubToken(kiosk)).toBeNull()
  })

  it('a SUB token never validates as a kiosk token', () => {
    const sub = createSubToken('acc-123', 'Precision Steel')
    expect(verifyKioskToken(sub)).toBeNull()
  })

  it('even with IDENTICAL secrets, aud/shape checks keep the tokens apart', () => {
    process.env.SUB_TOKEN_SECRET = SUB_SECRET
    process.env.KIOSK_SECRET = SUB_SECRET
    const sub = createSubToken('acc-123', 'Precision Steel')
    const kiosk = createKioskToken('Supervisor', 'supervisor')
    expect(verifyKioskToken(sub)).toBeNull()   // no worker_name/role in payload
    expect(verifySubToken(kiosk)).toBeNull()   // no aud:'sub' in payload
  })

  it('throws when the secret is missing or short', () => {
    delete process.env.SUB_TOKEN_SECRET
    expect(() => createSubToken('a', 'b')).toThrow()
    process.env.SUB_TOKEN_SECRET = 'short'
    expect(() => createSubToken('a', 'b')).toThrow()
    // verify returns null (never throws) when the secret is bad
    expect(verifySubToken('x.y')).toBeNull()
  })
})
