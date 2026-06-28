import { describe, it, expect } from 'vitest'
import { diffMarks, needsReview, markHasWork, type ExistingMark } from '../fab-import'
import type { ParsedMark } from '../tekla-assembly'

const pm = (p: Partial<ParsedMark>): ParsedMark => ({
  mark_id: 'A1', quantity: 1, section: 'PFC150*75', description: 'BEAM',
  length_mm: 4000, weight_kg: 80, coating: 'ETCH PRIMER', ...p,
})
const em = (p: Partial<ExistingMark>): ExistingMark => ({
  mark_id: 'A1', status: 'not_started', section: 'PFC150*75', length_mm: 4000,
  weight_kg: 80, quantity: 1, ...p,
})

describe('diffMarks', () => {
  it('classifies added / unchanged / changed / removed', () => {
    const parsed = [pm({ mark_id: 'A1' }), pm({ mark_id: 'A2', weight_kg: 99 }), pm({ mark_id: 'NEW1' })]
    const existing = [em({ mark_id: 'A1' }), em({ mark_id: 'A2', weight_kg: 50 }), em({ mark_id: 'GONE1' })]
    const d = diffMarks(parsed, existing)
    expect(d.added.map(x => x.mark_id)).toEqual(['NEW1'])
    expect(d.unchanged.map(x => x.mark_id)).toEqual(['A1'])
    expect(d.changed.map(x => x.mark_id)).toEqual(['A2'])
    expect(d.changed[0].fields).toContain('weight_kg')
    expect(d.removed.map(x => x.mark_id)).toEqual(['GONE1'])
  })

  it('protects a changed mark that has work against it', () => {
    const d = diffMarks([pm({ mark_id: 'A1', weight_kg: 99 })], [em({ mark_id: 'A1', weight_kg: 50, status: 'done' })])
    expect(d.changed[0].isProtected).toBe(true)
    expect(d.changed[0].hasWork).toBe(true)
    expect(needsReview(d)).toBe(true)
  })

  it('protects a manually-edited mark even with no work', () => {
    const d = diffMarks([pm({ mark_id: 'A1', section: 'NEW' })], [em({ mark_id: 'A1', section: 'OLD', manually_edited: true })])
    expect(d.changed[0].isProtected).toBe(true)
  })

  it('a changed mark with no work is NOT protected (safe to auto-apply)', () => {
    const d = diffMarks([pm({ mark_id: 'A1', weight_kg: 99 })], [em({ mark_id: 'A1', weight_kg: 50, status: 'not_started' })])
    expect(d.changed[0].isProtected).toBe(false)
    expect(needsReview(d)).toBe(false)
  })

  it('any removal needs review (never auto-deleted)', () => {
    const d = diffMarks([], [em({ mark_id: 'A1' })])
    expect(d.removed).toHaveLength(1)
    expect(needsReview(d)).toBe(true)
  })

  it('markHasWork: package/load/rework all count', () => {
    expect(markHasWork(em({ status: 'not_started', contractor_package_id: 'p' }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started', dispatch_load_id: 'L' }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started', rework_count: 1 }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started' }))).toBe(false)
  })
})
