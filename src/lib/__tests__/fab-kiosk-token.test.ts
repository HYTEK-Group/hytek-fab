import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { createKioskToken, verifyKioskToken } from '../fab-kiosk-token'

beforeEach(() => {
  process.env.KIOSK_SECRET = 'test-secret-test-secret-test-secret-1234'
})

describe('fab-kiosk-token', () => {
  it('round-trips a valid token', () => {
    const token = createKioskToken('Jamie', 'supervisor')
    const session = verifyKioskToken(token)
    expect(session).not.toBeNull()
    expect(session!.worker_name).toBe('Jamie')
    expect(session!.role).toBe('supervisor')
    expect(session!.exp).toBeGreaterThan(0)
  })

  it('rejects a tampered payload', () => {
    const token = createKioskToken('Jamie', 'fabricator')
    const [, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({
      worker_name: 'Jamie', role: 'admin', exp: 9999999999,
    })).toString('base64url')
    expect(verifyKioskToken(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects an expired token', () => {
    process.env.KIOSK_SECRET = 'test-secret-test-secret-test-secret-1234'
    const payload = Buffer.from(JSON.stringify({
      worker_name: 'Jamie', role: 'fabricator', exp: 1,
    })).toString('base64url')
    const sig = createHmac('sha256', process.env.KIOSK_SECRET)
      .update(payload).digest('base64url')
    expect(verifyKioskToken(`${payload}.${sig}`)).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(verifyKioskToken('')).toBeNull()
    expect(verifyKioskToken('nodot')).toBeNull()
    expect(verifyKioskToken('a.b.c.d')).toBeNull()
  })

  it('throws if KIOSK_SECRET is too short', () => {
    process.env.KIOSK_SECRET = 'short'
    expect(() => createKioskToken('Jamie', 'admin')).toThrow(/KIOSK_SECRET/)
  })
})
