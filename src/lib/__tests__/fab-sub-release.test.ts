import { describe, it, expect } from 'vitest'
import { canReleaseDropShip, type DropShipFacts } from '../fab-sub-release'

const good: DropShipFacts = {
  package_type: 'fabrication',
  delivery_mode: 'drop_ship',
  drop_ship_released_at: null,
  ready_at: '2026-07-04T00:00:00Z',
  total_marks: 12,
  marks_with_made_photo: 12,
  cert_count: 2,
  cc_level: 'CC2',
  compliance_mode: 'permissive',
}

describe('canReleaseDropShip', () => {
  it('releases when everything is in order', () => {
    const v = canReleaseDropShip(good)
    expect(v.ok).toBe(true)
    expect(v.blockers).toEqual([])
  })

  it('blocks without certs (the core drop-ship rule)', () => {
    const v = canReleaseDropShip({ ...good, cert_count: 0 })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/certs/i)
  })

  it('blocks when the sub has not marked ready', () => {
    const v = canReleaseDropShip({ ...good, ready_at: null })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/ready/i)
  })

  it('blocks when pieces are missing made photos', () => {
    const v = canReleaseDropShip({ ...good, marks_with_made_photo: 7 })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/7 of 12/)
  })

  it('blocks an empty package', () => {
    const v = canReleaseDropShip({ ...good, total_marks: 0, marks_with_made_photo: 0 })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/no pieces/i)
  })

  it('blocks CC3/CC4 regardless of compliance_mode — fails CLOSED', () => {
    for (const cc of ['CC3', 'CC4'] as const) {
      for (const mode of ['enforced', 'permissive'] as const) {
        const v = canReleaseDropShip({ ...good, cc_level: cc, compliance_mode: mode })
        expect(v.ok).toBe(false)
        expect(v.blockers.join(' ')).toMatch(/in-house inspection/i)
      }
    }
  })

  it('allows CC1/CC2 to drop-ship (low-consequence classes)', () => {
    for (const cc of ['CC1', 'CC2'] as const) {
      expect(canReleaseDropShip({ ...good, cc_level: cc }).ok).toBe(true)
    }
  })

  it('blocks double-release', () => {
    const v = canReleaseDropShip({ ...good, drop_ship_released_at: '2026-07-03T00:00:00Z' })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/already released/i)
  })

  it('blocks return-to-brisbane packages (they go through in-house QC)', () => {
    const v = canReleaseDropShip({ ...good, delivery_mode: 'return_to_brisbane' })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/returns to brisbane/i)
  })

  it('blocks non-fabrication packages', () => {
    const v = canReleaseDropShip({ ...good, package_type: 'treatment' })
    expect(v.ok).toBe(false)
    expect(v.blockers.join(' ')).toMatch(/fabrication/i)
  })

  it('collects ALL blockers at once (the office checklist shows every gap)', () => {
    const v = canReleaseDropShip({
      ...good, cert_count: 0, ready_at: null, marks_with_made_photo: 3,
    })
    expect(v.ok).toBe(false)
    expect(v.blockers.length).toBe(3)
  })
})
