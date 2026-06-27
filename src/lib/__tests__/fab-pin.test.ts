import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin, isValidPinFormat } from '../fab-pin'

describe('fab-pin', () => {
  it('validates 4-digit PIN format', () => {
    expect(isValidPinFormat('1234')).toBe(true)
    expect(isValidPinFormat('0000')).toBe(true)
    expect(isValidPinFormat('123')).toBe(false)
    expect(isValidPinFormat('12345')).toBe(false)
    expect(isValidPinFormat('12a4')).toBe(false)
    expect(isValidPinFormat('')).toBe(false)
  })

  it('hashes then verifies the same PIN', async () => {
    const hash = await hashPin('4821')
    expect(hash).not.toBe('4821')
    expect(await verifyPin('4821', hash)).toBe(true)
  })

  it('rejects a wrong PIN', async () => {
    const hash = await hashPin('4821')
    expect(await verifyPin('0000', hash)).toBe(false)
  })

  it('produces different hashes for the same PIN (salted)', async () => {
    const a = await hashPin('4821')
    const b = await hashPin('4821')
    expect(a).not.toBe(b)
    expect(await verifyPin('4821', a)).toBe(true)
    expect(await verifyPin('4821', b)).toBe(true)
  })
})
