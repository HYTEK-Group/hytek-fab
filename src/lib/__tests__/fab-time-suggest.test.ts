import { describe, it, expect } from 'vitest'
import { suggestMinutes, memberType, sectionFamily, categoryKey, type HistoryMark } from '../fab-time-suggest'

describe('memberType / sectionFamily', () => {
  it('reads the member type from the Tekla Name', () => {
    expect(memberType('BEAM')).toBe('BEAM')
    expect(memberType('COLUMN')).toBe('COLUMN')
    expect(memberType('COL')).toBe('COLUMN')
    expect(memberType('base plate')).toBe('PLATE')
    expect(memberType(null)).toBe('OTHER')
  })
  it('reads the profile family from the section', () => {
    expect(sectionFamily('310UC97')).toBe('UC')
    expect(sectionFamily('PFC150*75')).toBe('PFC')
    expect(sectionFamily('SHS100*100*4')).toBe('SHS')
    expect(sectionFamily('FL20')).toBe('FL')
  })
  it('categoryKey combines type and family', () => {
    expect(categoryKey({ description: 'BEAM', section: '310UC97' })).toBe('BEAM|UC')
  })
})

const hm = (p: Partial<HistoryMark>): HistoryMark => ({
  description: 'BEAM', section: '310UC97', weight_kg: 400, quantity: 1, actual_minutes: 90, ...p,
})

describe('suggestMinutes', () => {
  it('cold start: no history → weight × shop rate, low confidence', () => {
    const s = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 410, quantity: 1 }, [])
    expect(s.source).toBe('rate')
    expect(s.scope).toBe('default')
    expect(s.confidence).toBe('low')
    expect(s.minutes).toBeGreaterThan(0)
    expect(s.minutes % 15).toBe(0) // rounded to a quarter hour
  })

  it('learns the category rate once enough similar are built', () => {
    // 5 similar 310UC beams that actually took ~120 min for 0.4 t (300 min/t)
    const hist = Array.from({ length: 5 }, () => hm({ weight_kg: 400, actual_minutes: 120 }))
    const s = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 400, quantity: 1 }, hist)
    expect(s.source).toBe('history')
    expect(s.scope).toBe('category')
    expect(s.confidence).toBe('good')
    expect(s.samples).toBe(5)
    expect(s.minutes).toBe(120) // 300 min/t × 0.4 t
  })

  it('scales the suggestion with the assembly tonnage', () => {
    const hist = Array.from({ length: 5 }, () => hm({ weight_kg: 400, actual_minutes: 120 })) // 300 min/t
    const light = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 200, quantity: 1 }, hist)
    const heavy = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 800, quantity: 1 }, hist)
    expect(heavy.minutes).toBeGreaterThan(light.minutes)
  })

  it('learns a HIGHER minutes/tonne for fiddly plates than for beams', () => {
    const hist: HistoryMark[] = [
      ...Array.from({ length: 5 }, () => hm({ description: 'BEAM', section: '310UC97', weight_kg: 400, actual_minutes: 120 })), // 300 min/t
      ...Array.from({ length: 5 }, () => hm({ description: 'base plate', section: 'FL20', weight_kg: 8, quantity: 1, actual_minutes: 30 })), // 3750 min/t
    ]
    const beam = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 400, quantity: 1 }, hist)
    const plate = suggestMinutes({ description: 'base plate', section: 'FL20', weight_kg: 8, quantity: 1 }, hist)
    // per tonne, the plate is far more time even though it's far lighter
    expect(plate.minutes / (8 / 1000)).toBeGreaterThan(beam.minutes / (400 / 1000))
  })

  it('falls back to the shop average when the exact category is sparse', () => {
    const hist = Array.from({ length: 6 }, () => hm({ description: 'BEAM', section: '310UC97', weight_kg: 400, actual_minutes: 120 }))
    // asking about a COLUMN/UB we've never built → uses the shop average, medium confidence
    const s = suggestMinutes({ description: 'COLUMN', section: '250UB25', weight_kg: 300, quantity: 1 }, hist)
    expect(s.source).toBe('history')
    expect(s.scope).toBe('shop')
    expect(s.confidence).toBe('medium')
  })

  it('ignores history with no actual time (not yet done)', () => {
    const hist = Array.from({ length: 5 }, () => hm({ actual_minutes: null }))
    const s = suggestMinutes({ description: 'BEAM', section: '310UC97', weight_kg: 400, quantity: 1 }, hist)
    expect(s.source).toBe('rate') // nothing usable to learn from
  })
})
