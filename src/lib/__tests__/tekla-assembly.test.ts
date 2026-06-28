import { describe, it, expect } from 'vitest'
import { parseAssemblyRows, type Row } from '../tekla-assembly'

// Mirrors the real HG260012 Assembly List layout (title block, 2-row header,
// data rows, a trailing Total row, blanks).
const rows: Row[] = [
  ['Assembly List — TH1 & TH2 — ISSUED FOR APPROVAL'],
  ['Project Number', 'HG260012'],
  ['Project Name', '23 SPRINGWOOD ST TOWNHOUSES'],
  ['Building Number', 'B1 & B2,TH1 TO TH4'],
  ['Date', '17.04.2026'],
  [],
  ['Assembly Mark', 'Qty', 'Profile', 'Name', 'Length (mm)', 'Assembly Weight', 'Assembly Weight', 'Assembly Area', 'Assembly Area', 'Assembly Coating'],
  ['', '', '', '', '', '(kg) for one', '(kg) for all', '(m2) for one', '(m2) for all'],
  ['TH1-B1', '1', 'PFC150*75', 'BEAM', '4340', '85.1', '85.1', '3.19', '3.19', 'ETCH PRIMER'],
  ['TH1-B2', '1', 'EA75*75*5', 'BEAM', '4070', '21.5', '21.5', '1.18', '1.18', 'DURAGAL OR SIMILAR'],
  ['TH1-C1', '2', 'SHS89*89*3.5', 'COLUMN', '3000', '50', '100', '', '', 'ETCH PRIMER'],
  ['Total', '', '', '', '', '', '206.6'],
]

describe('parseAssemblyRows', () => {
  it('extracts title-block metadata', () => {
    const r = parseAssemblyRows(rows)
    expect(r.project_number).toBe('HG260012')
    expect(r.issued_status).toBe('ISSUED FOR APPROVAL')
    expect(r.date).toBe('17.04.2026')
  })

  it('parses each mark with section, length, weight(one), qty, coating', () => {
    const r = parseAssemblyRows(rows)
    expect(r.marks).toHaveLength(3)
    expect(r.marks[0]).toEqual({
      mark_id: 'TH1-B1', quantity: 1, section: 'PFC150*75', description: 'BEAM',
      length_mm: 4340, weight_kg: 85.1, coating: 'ETCH PRIMER',
    })
    expect(r.marks[2]).toMatchObject({ mark_id: 'TH1-C1', quantity: 2, weight_kg: 50, section: 'SHS89*89*3.5' })
  })

  it('totals tonnage as weight(one) × qty and skips the Total row', () => {
    const r = parseAssemblyRows(rows)
    // 85.1*1 + 21.5*1 + 50*2 = 206.6
    expect(r.total_kg).toBe(206.6)
    expect(r.marks.some(m => m.mark_id.toLowerCase().startsWith('total'))).toBe(false)
  })

  it('returns empty (no throw) when no Assembly Mark header is present', () => {
    const r = parseAssemblyRows([['something else'], ['a', 'b']])
    expect(r.marks).toEqual([])
    expect(r.total_kg).toBe(0)
  })
})
