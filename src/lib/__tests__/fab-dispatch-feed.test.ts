import { describe, it, expect } from 'vitest'
import {
  buildDispatchFeed,
  type DispatchFeedJob, type DispatchFeedLoad, type DispatchFeedMark,
  type DispatchFeedPackage,
} from '../fab-dispatch-feed'

const job = (p: Partial<DispatchFeedJob>): DispatchFeedJob => ({
  id: 'J1', quote_number: 'HG260012', hubspot_deal_id: null, name: 'Job', on_site_date: null,
  dispatch_requested_at: null, ...p,
})
const load = (p: Partial<DispatchFeedLoad>): DispatchFeedLoad => ({
  id: 'L1', fab_job_id: 'J1', load_number: 1, description: null, planned_date: null,
  dispatched_at: null, driver: null, ...p,
})
const mark = (p: Partial<DispatchFeedMark>): DispatchFeedMark => ({
  fab_job_id: 'J1', mark_id: 'M1', section: 'PFC150', weight_kg: 100, quantity: 1,
  status: 'qc_passed', dispatch_load_id: null, ...p,
})

describe('buildDispatchFeed', () => {
  it('groups marks under their load and totals load tonnage', () => {
    const feed = buildDispatchFeed(
      [job({})],
      [load({ id: 'L1', load_number: 1 })],
      [
        mark({ mark_id: 'M1', weight_kg: 100, quantity: 2, dispatch_load_id: 'L1' }), // 0.2 t
        mark({ mark_id: 'M2', weight_kg: 500, quantity: 1, dispatch_load_id: 'L1' }), // 0.5 t
      ],
    )
    expect(feed).toHaveLength(1)
    expect(feed[0].loads).toHaveLength(1)
    expect(feed[0].loads[0].marks.map(m => m.mark_id)).toEqual(['M1', 'M2'])
    expect(feed[0].loads[0].tonnes).toBe(0.7)
  })

  it('lists QC-passed marks not yet on a load as unassigned_ready (with tonnes)', () => {
    const feed = buildDispatchFeed(
      [job({})], [],
      [
        mark({ mark_id: 'R1', status: 'qc_passed', weight_kg: 250, quantity: 1, dispatch_load_id: null }),
        mark({ mark_id: 'X1', status: 'in_progress', dispatch_load_id: null }), // not ready
      ],
    )
    expect(feed[0].unassigned_ready.map(m => m.mark_id)).toEqual(['R1'])
    expect(feed[0].tonnes_ready).toBe(0.25)
  })

  it('excludes jobs with no loads, no ready marks, and no dispatch request', () => {
    const feed = buildDispatchFeed(
      [job({ id: 'J1' }), job({ id: 'J2', quote_number: 'HG999' })],
      [],
      [mark({ fab_job_id: 'J1', status: 'in_progress', dispatch_load_id: null })], // J1 has only WIP
    )
    expect(feed).toHaveLength(0)
  })

  it('includes a job flagged dispatch_requested_at even with no loads yet', () => {
    const feed = buildDispatchFeed([job({ dispatch_requested_at: '2026-06-20T00:00:00Z' })], [], [])
    expect(feed).toHaveLength(1)
  })

  it('sorts jobs by on-site date, soonest first, nulls last', () => {
    const feed = buildDispatchFeed(
      [
        job({ id: 'A', quote_number: 'A', on_site_date: null, dispatch_requested_at: 'x' }),
        job({ id: 'B', quote_number: 'B', on_site_date: '2026-07-01', dispatch_requested_at: 'x' }),
        job({ id: 'C', quote_number: 'C', on_site_date: '2026-06-15', dispatch_requested_at: 'x' }),
      ],
      [], [],
    )
    expect(feed.map(j => j.quote_number)).toEqual(['C', 'B', 'A'])
  })

  it('keeps an explicit quantity 0 as 0 (does not inflate to 1)', () => {
    const feed = buildDispatchFeed(
      [job({})], [load({ id: 'L1' })],
      [mark({ mark_id: 'Z', weight_kg: 100, quantity: 0, dispatch_load_id: 'L1' })],
    )
    expect(feed[0].loads[0].marks[0].quantity).toBe(0)
    expect(feed[0].loads[0].tonnes).toBe(0)
  })

  it('clamps negative/null weights to 0 in tonnage', () => {
    const feed = buildDispatchFeed(
      [job({})], [load({ id: 'L1' })],
      [
        mark({ mark_id: 'M1', weight_kg: -50, quantity: 1, dispatch_load_id: 'L1' }),
        mark({ mark_id: 'M2', weight_kg: null, quantity: 1, dispatch_load_id: 'L1' }),
      ],
    )
    expect(feed[0].loads[0].tonnes).toBe(0)
  })

  // ── subcontractor drop-ship (sub_certified + pickups) ──────────────────────

  const pkg = (p: Partial<DispatchFeedPackage>): DispatchFeedPackage => ({
    id: 'P1', fab_job_id: 'J1', contractor_name: 'Precision Steel',
    contractor_contact: '0400 000 000', delivery_mode: 'drop_ship',
    drop_ship_released_at: '2026-07-04T00:00:00Z', ...p,
  })

  it('drop-ship steel surfaces under pickups ONLY, never double-counted in tonnes_ready', () => {
    const feed = buildDispatchFeed(
      [job({ dispatch_requested_at: 'x' })], [],
      [
        mark({ mark_id: 'S1', status: 'sub_certified', weight_kg: 300, quantity: 2, contractor_package_id: 'P1' }),
        mark({ mark_id: 'X1', status: 'at_contractor', contractor_package_id: 'P1' }), // still being made
      ],
      [pkg({})],
    )
    // sub_certified steel is a sub-yard pickup, NOT factory-floor ready tonnage
    expect(feed[0].unassigned_ready).toHaveLength(0)
    expect(feed[0].tonnes_ready).toBe(0)
    expect(feed[0].pickups).toHaveLength(1)
    expect(feed[0].pickups[0].tonnes).toBe(0.6)
  })

  it('in-house qc_passed steel still lists as unassigned_ready alongside drop-ship pickups', () => {
    const feed = buildDispatchFeed(
      [job({})], [],
      [
        mark({ mark_id: 'H1', status: 'qc_passed', weight_kg: 500, quantity: 1, dispatch_load_id: null }), // in-house
        mark({ mark_id: 'S1', status: 'sub_certified', weight_kg: 300, quantity: 2, contractor_package_id: 'P1' }),
        mark({ mark_id: 'S2', status: 'sub_certified', weight_kg: 100, quantity: 1, contractor_package_id: 'P1' }),
      ],
      [pkg({})],
    )
    expect(feed[0].unassigned_ready.map(m => m.mark_id)).toEqual(['H1']) // in-house only
    expect(feed[0].tonnes_ready).toBe(0.5)
    expect(feed[0].pickups[0].contractor_name).toBe('Precision Steel')
    expect(feed[0].pickups[0].tonnes).toBe(0.7)
    expect(feed[0].pickups[0].pieces).toBe(3)
  })

  it('shows NO pickup for unreleased or return-to-brisbane packages', () => {
    const feed = buildDispatchFeed(
      [job({ dispatch_requested_at: 'x' })], [],
      [mark({ mark_id: 'S1', status: 'at_contractor', contractor_package_id: 'P1' })],
      [
        pkg({ id: 'P1', drop_ship_released_at: null }),                     // not released yet
        pkg({ id: 'P2', delivery_mode: 'return_to_brisbane' }),             // comes back to us
      ],
    )
    expect(feed[0].pickups).toHaveLength(0)
  })
})
