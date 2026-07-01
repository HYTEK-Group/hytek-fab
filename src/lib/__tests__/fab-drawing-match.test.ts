import { describe, it, expect } from 'vitest'
import { pickAssemblyDrawing } from '../fab-drawing-match'

describe('pickAssemblyDrawing', () => {
  const hg12 = [
    'HG260012 TH 1 & 2_ASSEMBLIES_IFF 17.04.2026.pdf',
    'HG260012 TH 1 & 2_PLATES_IFF 17.04.2026.pdf',
    'HG260012 TH 1 & 2_SHAFTS_IFF 17.04.2026.pdf',
    'HG260012 TH 3 & 4_ASSEMBLIES_IFF 30.03.2026.pdf',
    'HG260012 TH 3 & 4_PLATES_IFF 30.03.2026.pdf',
  ]

  it('prefers the ASSEMBLIES drawing over plates/shafts', () => {
    const pick = pickAssemblyDrawing(hg12, 'HG260012 TH 1 & 2 Assembly List')
    expect(pick).toMatch(/ASSEMBLIES/)
  })

  it('picks the block that matches the mark source (TH 1 & 2, not TH 3 & 4)', () => {
    const pick = pickAssemblyDrawing(hg12, 'HG260012 TH 1 & 2 Assembly List')
    expect(pick).toBe('HG260012 TH 1 & 2_ASSEMBLIES_IFF 17.04.2026.pdf')
  })

  it('ignores report PDFs (Assembly List / Bolt Summary)', () => {
    const withReports = [
      'HG260037 BLOCK E_Assembly List_IFF_10.06.2026.pdf',
      'HG260037 BLOCK E_Bolt Summary_IFF_10.06.2026.pdf',
      'ASSEMBLY DRAWING_IFF 11.06.2026.pdf',
    ]
    expect(pickAssemblyDrawing(withReports, 'HG260037 BLOCK E Assembly List')).toBe('ASSEMBLY DRAWING_IFF 11.06.2026.pdf')
  })

  it('returns null when there are no PDFs', () => {
    expect(pickAssemblyDrawing(['notes.txt'], 'x')).toBeNull()
  })

  it('returns null (not a report) when only report PDFs are uploaded', () => {
    const onlyReports = [
      'HG260012 TH 1 & 2_Assembly List_IFF.pdf',
      'HG260012 TH 1 & 2_Bolt Summary_IFF.pdf',
    ]
    expect(pickAssemblyDrawing(onlyReports, 'HG260012 TH 1 & 2 Assembly List')).toBeNull()
  })
})
