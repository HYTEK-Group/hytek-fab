import { describe, it, expect } from 'vitest'
import { computeCompleteness, type CompMark, type CompPhoto } from '../fab-completeness'

const marks = (ids: string[]): CompMark[] => ids.map(x => ({ id: x, mark_id: x.toUpperCase() }))
const made = (ids: string[]): CompPhoto[] => ids.map(x => ({ fab_mark_id: x, stage: 'made' }))

describe('computeCompleteness', () => {
  it('ready when every piece has a made photo', () => {
    const r = computeCompleteness(marks(['a', 'b', 'c']), made(['a', 'b', 'c']))
    expect(r.ready).toBe(true)
    expect(r.blockers).toEqual([])
    expect(r.made).toBe(3)
    expect(r.missing_marks).toEqual([])
  })

  it('blocks and NAMES the pieces with no photo', () => {
    const r = computeCompleteness(marks(['a', 'b', 'c']), made(['a']))
    expect(r.ready).toBe(false)
    expect(r.missing_marks).toEqual(['B', 'C'])
    expect(r.blockers[0]).toMatch(/2 of 3 pieces have no photo/)
    expect(r.blockers[0]).toMatch(/B, C/)
  })

  it('a job with no pieces is not blocked (nothing to photograph)', () => {
    const r = computeCompleteness([], [])
    expect(r.ready).toBe(true)
    expect(r.blockers).toEqual([])
  })

  it('a photo with no mark id does not satisfy any piece', () => {
    const r = computeCompleteness(marks(['a']), [{ fab_mark_id: null, stage: 'made' }])
    expect(r.ready).toBe(false)
    expect(r.missing_marks).toEqual(['A'])
  })

  it('non-made photos do not count toward pieces made', () => {
    const photos: CompPhoto[] = [
      { fab_mark_id: 'a', stage: 'bundled' },
      { fab_mark_id: 'a', stage: 'loaded' },
    ]
    const r = computeCompleteness(marks(['a']), photos)
    expect(r.ready).toBe(false)
    expect(r.has_bundled).toBe(true)
    expect(r.has_loaded).toBe(true)
  })

  it('truncates the named list past 12 but keeps the count', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `m${i}`)
    const r = computeCompleteness(marks(ids), [])
    expect(r.missing_marks).toHaveLength(20)
    expect(r.blockers[0]).toMatch(/20 of 20/)
    expect(r.blockers[0]).toMatch(/\+8 more/)
  })
})
