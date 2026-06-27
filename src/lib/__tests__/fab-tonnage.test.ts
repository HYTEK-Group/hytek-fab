import { describe, it, expect } from 'vitest'
import { tonnageSummary, kgToTonnes } from '../fab-tonnage'

const m = (status: string, weight_kg: number | null, quantity = 1) => ({ status, weight_kg, quantity })

describe('tonnageSummary', () => {
  it('weights progress by tonnage, not count', () => {
    // one heavy made column vs several light not-made plates
    const s = tonnageSummary([
      m('qc_passed', 400, 1), // 400 kg made
      m('not_started', 10, 4), // 40 kg not made
    ])
    expect(s.total_kg).toBe(440)
    expect(s.made_kg).toBe(400)
    expect(s.pct).toBe(91) // 400/440 ≈ 90.9 → 91, not 50% (count would say 50)
  })

  it('counts both done and qc_passed as made', () => {
    const s = tonnageSummary([
      m('done', 100), m('qc_passed', 100), m('in_progress', 100), m('not_started', 100),
    ])
    expect(s.made_kg).toBe(200)
    expect(s.pct).toBe(50)
  })

  it('multiplies weight by quantity', () => {
    const s = tonnageSummary([m('done', 50, 4)])
    expect(s.total_kg).toBe(200)
    expect(s.made_kg).toBe(200)
  })

  it('flags marks missing weight and never divides by zero', () => {
    const s = tonnageSummary([m('done', null, 2), m('not_started', 0, 1)])
    expect(s.total_kg).toBe(0)
    expect(s.made_kg).toBe(0)
    expect(s.pct).toBe(0)
    expect(s.missing_weight).toBe(2)
  })

  it('handles an empty mark list', () => {
    const s = tonnageSummary([])
    expect(s.total_kg).toBe(0)
    expect(s.pct).toBe(0)
    expect(s.missing_weight).toBe(0)
  })

  it('kgToTonnes rounds to 2dp', () => {
    expect(kgToTonnes(3140)).toBe(3.14)
    expect(kgToTonnes(0)).toBe(0)
    expect(kgToTonnes(1254)).toBe(1.25)
    expect(kgToTonnes(1256)).toBe(1.26)
  })
})
