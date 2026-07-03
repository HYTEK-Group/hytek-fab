import { describe, it, expect } from 'vitest'
import { buildProofPack, type ProofPhotoView } from '../fab-proof-pack'

const ph = (p: Partial<ProofPhotoView>): ProofPhotoView => ({
  id: 'p', stage: 'made', treatment_type: null, fab_mark_id: null, fab_package_id: null,
  fab_load_id: null, mark_label: null, url: 'u', caption: null, taken_by: 'CD', taken_at: '2026-08-12T00:00:00Z', ...p,
})

describe('buildProofPack', () => {
  it('splits photos into made / treatment legs / bundled / loaded', () => {
    const pack = buildProofPack([
      ph({ id: '1', stage: 'made', fab_mark_id: 'm1' }),
      ph({ id: '2', stage: 'made', fab_mark_id: 'm2' }),
      ph({ id: '3', stage: 'bundled' }),
      ph({ id: '4', stage: 'loaded' }),
    ])
    expect(pack.made).toHaveLength(2)
    expect(pack.bundled).toHaveLength(1)
    expect(pack.loaded).toHaveLength(1)
    expect(pack.counts.marks_photographed).toBe(2)
  })

  it('pairs each coating package into a sent/returned leg with the contractor name', () => {
    const pack = buildProofPack(
      [
        ph({ id: 'o', stage: 'treatment_out', fab_package_id: 'pk1', treatment_type: 'hdg', taken_at: '2026-08-15T00:00:00Z' }),
        ph({ id: 'i', stage: 'treatment_in', fab_package_id: 'pk1', treatment_type: 'hdg', taken_at: '2026-08-20T00:00:00Z' }),
      ],
      [{ id: 'pk1', treatment_type: 'hdg', contractor_name: 'GalvCo' }],
    )
    expect(pack.treatments).toHaveLength(1)
    expect(pack.treatments[0]).toMatchObject({ treatment_type: 'hdg', contractor_name: 'GalvCo' })
    expect(pack.treatments[0].sent.map(p => p.id)).toEqual(['o'])
    expect(pack.treatments[0].returned.map(p => p.id)).toEqual(['i'])
  })

  it('keeps two different coatings as two legs, ordered by when they went out', () => {
    const pack = buildProofPack([
      ph({ id: 'g-out', stage: 'treatment_out', fab_package_id: 'galv', taken_at: '2026-08-15T00:00:00Z' }),
      ph({ id: 'p-out', stage: 'treatment_out', fab_package_id: 'paint', taken_at: '2026-08-21T00:00:00Z' }),
      ph({ id: 'g-in', stage: 'treatment_in', fab_package_id: 'galv', taken_at: '2026-08-20T00:00:00Z' }),
    ])
    expect(pack.treatments.map(t => t.package_id)).toEqual(['galv', 'paint'])
  })

  it('handles an empty log', () => {
    const pack = buildProofPack([])
    expect(pack.counts.total).toBe(0)
    expect(pack.treatments).toEqual([])
  })
})
