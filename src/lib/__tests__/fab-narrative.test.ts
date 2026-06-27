import { describe, it, expect } from 'vitest'
import { buildNarrative, type NarrativeInput } from '../fab-narrative'

function base(p: Partial<NarrativeInput>): NarrativeInput {
  return {
    inhouse_total: 0, inhouse_complete: 0,
    contractor_packages: [], dispatch_loads: [],
    rework_total: 0, on_site_date: null, ...p,
  }
}

describe('buildNarrative', () => {
  it('reports in-house progress', () => {
    const n = buildNarrative(base({ inhouse_total: 10, inhouse_complete: 4 }), '2026-06-27')
    expect(n).toContain('In-house fabrication 40% complete (4/10 marks).')
  })

  it('describes a sent package with no updates', () => {
    const n = buildNarrative(base({
      contractor_packages: [{
        package_id: 'p', package_type: 'fabrication', treatment_type: null,
        contractor_name: 'ABC Engineering', scope_note: 'CNC base plates',
        total_marks: 6, marks_done: 0, pct: 0, status: 'sent',
        last_update_date: null, last_update_note: null,
        expected_return_date: '2026-06-30', returned_at: null,
      }],
    }), '2026-06-27')
    expect(n).toContain('ABC Engineering — CNC base plates: sent, awaiting update.')
  })

  it('describes an inspected package', () => {
    const n = buildNarrative(base({
      contractor_packages: [{
        package_id: 'p', package_type: 'treatment', treatment_type: 'hdg',
        contractor_name: 'QLD Galv', scope_note: 'HDG columns',
        total_marks: 8, marks_done: 8, pct: 100, status: 'inspected',
        last_update_date: '2026-06-25', last_update_note: 'all back',
        expected_return_date: '2026-06-24', returned_at: '2026-06-25',
      }],
    }), '2026-06-27')
    expect(n).toContain('QLD Galv — HDG columns: complete and QC approved.')
  })

  it('notes rework', () => {
    const n = buildNarrative(base({ inhouse_total: 5, inhouse_complete: 5, rework_total: 2 }), '2026-06-27')
    expect(n).toContain('Note: 2 mark(s) required rework.')
  })

  it('reports dispatch loads', () => {
    const n = buildNarrative(base({
      dispatch_loads: [
        { load_number: 1, description: 'beams', total_marks: 24, dispatched_at: '2026-06-26', planned_date: '2026-06-26' },
        { load_number: 2, description: 'plates', total_marks: 8, dispatched_at: null, planned_date: '2026-06-28' },
      ],
    }), '2026-06-27')
    expect(n).toContain('Load 1 dispatched 2026-06-26 (24 marks).')
    expect(n).toContain('Load 2 planned 2026-06-28 (8 marks).')
  })

  it('says on track when on-site date is far out', () => {
    const n = buildNarrative(base({ inhouse_total: 1, inhouse_complete: 0, on_site_date: '2026-08-01' }), '2026-06-27')
    expect(n).toContain('On track for on-site date.')
  })

  it('warns when on-site date is approaching', () => {
    const n = buildNarrative(base({ inhouse_total: 1, inhouse_complete: 0, on_site_date: '2026-06-30' }), '2026-06-27')
    expect(n).toContain('On-site date approaching.')
  })
})
