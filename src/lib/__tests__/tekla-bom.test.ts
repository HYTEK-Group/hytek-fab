import { describe, it, expect } from 'vitest'
import { parseBomRows, bomCategoryFromFilename, type Row } from '../tekla-bom'

describe('bomCategoryFromFilename', () => {
  it('maps each Tekla report name to its category', () => {
    expect(bomCategoryFromFilename('HG260012 Part Material List_IFF_1.2.26.xlsx')).toBe('section')
    expect(bomCategoryFromFilename('HG260012 Plate Part List.xlsx')).toBe('plate')
    expect(bomCategoryFromFilename('HG260012 Loose Plate List.xlsx')).toBe('loose') // loose wins over plate
    expect(bomCategoryFromFilename('Erection Bolt List.xlsx')).toBe('bolt')
    expect(bomCategoryFromFilename('Bolt Summary.xlsx')).toBe('bolt')
    expect(bomCategoryFromFilename('Chemset Tube Summary.xlsx')).toBe('chemset')
    expect(bomCategoryFromFilename('Miscellaneous List.xlsx')).toBe('misc')
  })
  it('returns null for the Assembly List (marks, not BOM) and unknowns', () => {
    expect(bomCategoryFromFilename('HG260012 Assembly List.xlsx')).toBeNull()
    expect(bomCategoryFromFilename('drawing.pdf')).toBeNull()
  })
})

describe('parseBomRows — Part Material List (sections)', () => {
  const rows: Row[] = [
    ['Project Number', 'HG260012'],
    ['Part Material List', 'For Ordering'],
    ['Part Mark', 'Profile', 'Grade', 'Length (mm)', 'Weight (kg) for one', 'Weight (kg) for all', 'From Stock', 'From Order'],
    ['P1', 'PFC150*75', 'G300', 4340, 85.1, 170.2, 'No', 'Yes'],
    ['P2', 'SHS100*100*4', 'C350', 6000, 47.2, 47.2, 'Yes', 'No'],
    ['Total', '', '', '', 217.4, '', '', ''],
  ]
  it('parses sections with one-weight, length, stock/order flags; skips totals', () => {
    const { category, lines } = parseBomRows(rows, 'section')
    expect(category).toBe('section')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      category: 'section', part_mark: 'P1', profile: 'PFC150*75', grade: 'G300',
      length_mm: 4340, weight_kg: 85.1, from_stock: false, from_order: true,
    })
    expect(lines[1]).toMatchObject({ part_mark: 'P2', from_stock: true, from_order: false, weight_kg: 47.2 })
  })
})

describe('parseBomRows — Plate Part List', () => {
  const rows: Row[] = [
    ['Plate Part List'],
    ['Part Mark', 'Profile', 'Qty', 'Material', 'Length', 'Weight (kg)'],
    ['p1', 'FL10*150', 4, 'G250', 300, 3.5],
    ['p2', 'FL12*200', 2, 'G250', 250, 4.7],
  ]
  it('parses plate qty + profile + grade(from Material)', () => {
    const { lines } = parseBomRows(rows, 'plate')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ category: 'plate', part_mark: 'p1', profile: 'FL10*150', qty: 4, grade: 'G250', length_mm: 300, weight_kg: 3.5 })
    expect(lines[1].qty).toBe(2)
  })
})

describe('parseBomRows — Bolt list', () => {
  const rows: Row[] = [
    ['Erection Bolt List'],
    ['Bolt Dia', 'Grade', 'Finish', 'Length', 'Qty'],
    ['M20', '8.8', 'HDG', 60, 48],
    ['M16', '8.8', 'HDG', 50, 24],
  ]
  it('parses bolt dia into profile + qty (no part mark column)', () => {
    const { lines } = parseBomRows(rows, 'bolt')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ category: 'bolt', profile: 'M20', grade: '8.8', length_mm: 60, qty: 48 })
    expect(lines[0].part_mark).toBeNull()
  })
})

describe('parseBomRows — robustness', () => {
  it('returns no lines when no recognisable header exists', () => {
    const rows: Row[] = [['just a title'], ['some note'], ['', '']]
    expect(parseBomRows(rows, 'misc').lines).toHaveLength(0)
  })
  it('drops fully-empty data rows', () => {
    const rows: Row[] = [
      ['Part Mark', 'Profile', 'Qty', 'Weight (kg)'],
      ['P1', 'PFC150', 1, 85],
      [null, null, null, null],
      ['', '', '', ''],
    ]
    expect(parseBomRows(rows, 'section').lines).toHaveLength(1)
  })
})

describe('parseBomRows — header detection (hardened)', () => {
  it('ignores a title row that only shares keyword substrings (Diaphragm/Material)', () => {
    const rows: Row[] = [
      ['Diaphragm plate stiffeners', 'Material spec note'], // 'dia'/'plate' are substrings, not columns
      ['Part Mark', 'Profile', 'Qty', 'Weight (kg)'],
      ['P1', 'PFC150', 1, 85],
    ]
    const { lines } = parseBomRows(rows, 'section')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ part_mark: 'P1', profile: 'PFC150', qty: 1, weight_kg: 85 })
  })

  it('picks the BEST header row (most columns), not the first that merely scores 2', () => {
    const rows: Row[] = [
      ['Section A', 'Material list'], // scores 2 (section + material) but is a title
      ['Part Mark', 'Profile', 'Grade', 'Qty', 'Weight (kg)'], // the real header, scores 5
      ['P1', 'PFC150', 'G300', 2, 85],
    ]
    const { lines } = parseBomRows(rows, 'section')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ part_mark: 'P1', grade: 'G300', qty: 2, weight_kg: 85 })
  })

  it('does not mistake a row-number "No." column for qty', () => {
    const rows: Row[] = [
      ['No.', 'Part Mark', 'Qty', 'Weight (kg)'],
      [1, 'P1', 3, 85],
    ]
    expect(parseBomRows(rows, 'section').lines[0].qty).toBe(3)
  })

  it('prefers the per-one weight column over the all-up column', () => {
    const rows: Row[] = [
      ['Part Mark', 'Weight (kg) for all', 'Weight (kg) for one'],
      ['P1', 200, 100],
    ]
    expect(parseBomRows(rows, 'section').lines[0].weight_kg).toBe(100)
  })
})
