import { describe, it, expect } from 'vitest'
import { stableSource, iffDate } from '../source-key'

describe('stableSource', () => {
  it('strips the extension and the _IFF_<date> issue suffix', () => {
    expect(stableSource('HG260012 Part Material List_IFF_1.2.26.xlsx')).toBe('HG260012 Part Material List')
    expect(stableSource('HG260012 Plate Part List.xlsx')).toBe('HG260012 Plate Part List')
  })
  it('collapses two issues of one report to the same key', () => {
    expect(stableSource('Bolt Summary_IFF_1.2.26.xlsx')).toBe(stableSource('Bolt Summary_IFF_5.3.26.xlsx'))
  })
})

describe('iffDate', () => {
  it('parses the _IFF_ date to epoch ms', () => {
    expect(iffDate('x_IFF_1.2.26.xlsx')).toBe(new Date(2026, 1, 1).getTime())
  })
  it('returns -1 when there is no issue date', () => {
    expect(iffDate('Plate Part List.xlsx')).toBe(-1)
  })
  it('orders a newer issue above an older one', () => {
    expect(iffDate('r_IFF_5.3.26.xlsx')).toBeGreaterThan(iffDate('r_IFF_1.2.26.xlsx'))
  })
})
