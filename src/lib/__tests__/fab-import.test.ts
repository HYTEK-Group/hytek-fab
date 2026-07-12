import { describe, it, expect } from 'vitest'
import { diffMarks, needsReview, markHasWork, buildMarkUpserts, MARK_UPSERT_OPTIONS, type ExistingMark } from '../fab-import'
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

  it('matches a colliding mark from another source as a protected change, not an add', () => {
    const d = diffMarks(
      [pm({ mark_id: 'A1', weight_kg: 99 })],
      [em({ mark_id: 'A1', weight_kg: 50, source_file: 'OTHER', manually_edited: true })],
      'THIS',
    )
    expect(d.added).toHaveLength(0)
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0].isProtected).toBe(true) // manually_edited → not overwritten
  })

  it('scopes removals to the source being re-imported', () => {
    const existing = [em({ mark_id: 'A1', source_file: 'BLOCK1' }), em({ mark_id: 'B1', source_file: 'BLOCK2' })]
    const d = diffMarks([], existing, 'BLOCK1')
    expect(d.removed.map(x => x.mark_id)).toEqual(['A1']) // B1 (other source) untouched
  })

  it('markHasWork: package/load/rework all count', () => {
    expect(markHasWork(em({ status: 'not_started', contractor_package_id: 'p' }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started', dispatch_load_id: 'L' }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started', rework_count: 1 }))).toBe(true)
    expect(markHasWork(em({ status: 'not_started' }))).toBe(false)
  })
})

describe('buildMarkUpserts + MARK_UPSERT_OPTIONS (mixed re-issue regression)', () => {
  // The 12/07/2026 bug: one re-issue that both ADDS a mark and RESPECS a clean
  // mark produced a mixed batch (added rows set status, changed rows omit it);
  // with supabase-js's default defaultToNull:true the changed rows went up as
  // status:null → fab_marks.status NOT NULL violation → the WHOLE import 500'd.
  const meta = { fabJobId: 'job-1', version: 2, sourceKey: 'BLOCK1', sourceHash: 'h' }
  const mixedDiff = () => diffMarks(
    [pm({ mark_id: 'NEW1' }), pm({ mark_id: 'A1', weight_kg: 99 })],
    [em({ mark_id: 'A1', weight_kg: 50, status: 'not_started' })],
  )

  it('added rows stamp status, changed rows OMIT it (never null)', () => {
    const rows = buildMarkUpserts(mixedDiff(), meta)
    const add = rows.find(r => r.mark_id === 'NEW1')!
    const chg = rows.find(r => r.mark_id === 'A1')!
    expect(add.status).toBe('not_started')
    expect('status' in chg).toBe(false)      // omitted — kept by defaultToNull:false
    expect(chg.status).not.toBeNull()
  })

  it('defaultToNull stays false so the mixed batch cannot null status on update', () => {
    expect(MARK_UPSERT_OPTIONS.defaultToNull).toBe(false)
    expect(MARK_UPSERT_OPTIONS.onConflict).toBe('fab_job_id,mark_id')
  })

  it('protected changes are excluded from the write entirely', () => {
    const d = diffMarks(
      [pm({ mark_id: 'W1', weight_kg: 99 })],
      [em({ mark_id: 'W1', weight_kg: 50, status: 'done' })],
    )
    expect(buildMarkUpserts(d, meta)).toHaveLength(0)
  })
})
