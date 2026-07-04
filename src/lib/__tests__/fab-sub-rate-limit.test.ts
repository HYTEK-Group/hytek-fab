import { describe, it, expect } from 'vitest'
import { subFailureDelayMs, isLocked, LOCK_THRESHOLD } from '../fab-sub-rate-limit'

describe('fab-sub-rate-limit', () => {
  it('has NO free first attempt (unlike the shared-tablet kiosk)', () => {
    expect(subFailureDelayMs(1)).toBeGreaterThan(0)
  })

  it('ramps the delay with each miss and caps it', () => {
    expect(subFailureDelayMs(0)).toBe(0)
    expect(subFailureDelayMs(1)).toBe(750)
    expect(subFailureDelayMs(2)).toBe(1500)
    expect(subFailureDelayMs(8)).toBe(6000)
    expect(subFailureDelayMs(50)).toBe(6000) // capped
  })

  it('locks the account at the threshold, not before', () => {
    expect(isLocked(LOCK_THRESHOLD - 1)).toBe(false)
    expect(isLocked(LOCK_THRESHOLD)).toBe(true)
    expect(isLocked(LOCK_THRESHOLD + 5)).toBe(true)
  })

  it('threshold is small enough to stop enumerating a 4-digit space', () => {
    // 10,000 PINs; a hard lock at 10 misses means an attacker can try < 0.1%
    expect(LOCK_THRESHOLD).toBeLessThanOrEqual(20)
  })
})
