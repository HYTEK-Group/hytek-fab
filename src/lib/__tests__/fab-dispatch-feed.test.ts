import { describe, it, expect } from 'vitest'
import {
  buildDispatchFeed,
  type DispatchFeedJob, type DispatchFeedLoad, type DispatchFeedMark,
  type DispatchFeedPackage, type DispatchFeedStage,
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

  // ── delivery stages (the plan the Hub mirrors onto the board) ──────────────

  const stage = (p: Partial<DispatchFeedStage>): DispatchFeedStage => ({
    id: 'ST1', fab_job_id: 'J1', stage_ref: 'st_abc', name: 'Stage 1',
    required_on_site_date: '2026-08-08', sequence_no: 1, ...p,
  })

  it('surfaces a job that only has stages (planned early, nothing ready yet)', () => {
    const feed = buildDispatchFeed(
      [job({})], [],
      [
        mark({ mark_id: 'B1', status: 'not_started', weight_kg: 500, quantity: 2, delivery_stage_id: 'ST1' }),
        mark({ mark_id: 'B2', status: 'not_started', weight_kg: 250, quantity: 1, delivery_stage_id: 'ST1' }),
      ],
      [], [stage({})],
    )
    expect(feed).toHaveLength(1)
    expect(feed[0].stages).toHaveLength(1)
    expect(feed[0].stages[0].stage_ref).toBe('st_abc')
    expect(feed[0].stages[0].required_on_site_date).toBe('2026-08-08')
    expect(feed[0].stages[0].marks.map(m => m.mark_id)).toEqual(['B1', 'B2'])
    expect(feed[0].stages[0].tonnes).toBe(1.25)
    expect(feed[0].stages[0].pieces).toBe(3)
  })

  it('breaks a shared sequence_no deterministically by stage_ref (no reload flip)', () => {
    const build = (order: DispatchFeedStage[]) => buildDispatchFeed(
      [job({})], [],
      [
        mark({ mark_id: 'A', status: 'not_started', weight_kg: 100, quantity: 1, delivery_stage_id: 'S_b' }),
        mark({ mark_id: 'B', status: 'not_started', weight_kg: 100, quantity: 1, delivery_stage_id: 'S_a' }),
      ],
      [], order,
    )[0].stages.map(s => s.stage_ref)
    // Same sequence_no on both stages; whatever order the DB hands us, the feed
    // must always return them in the same (stage_ref-sorted) order.
    const a = stage({ id: 'S_a', stage_ref: 's_aaa', sequence_no: 1 })
    const b = stage({ id: 'S_b', stage_ref: 's_bbb', sequence_no: 1 })
    expect(build([a, b])).toEqual(['s_aaa', 's_bbb'])
    expect(build([b, a])).toEqual(['s_aaa', 's_bbb'])
  })

  it('orders stages by build sequence and only counts their own pieces', () => {
    const feed = buildDispatchFeed(
      [job({})], [],
      [
        mark({ mark_id: 'A', status: 'not_started', weight_kg: 100, quantity: 1, delivery_stage_id: 'ST2' }),
        mark({ mark_id: 'B', status: 'not_started', weight_kg: 100, quantity: 1, delivery_stage_id: 'ST1' }),
        mark({ mark_id: 'C', status: 'not_started', weight_kg: 100, quantity: 1, delivery_stage_id: null }), // unstaged
      ],
      [],
      [stage({ id: 'ST1', stage_ref: 's1', sequence_no: 1 }), stage({ id: 'ST2', stage_ref: 's2', sequence_no: 2 })],
    )
    expect(feed[0].stages.map(s => s.stage_ref)).toEqual(['s1', 's2'])
    expect(feed[0].stages[0].marks.map(m => m.mark_id)).toEqual(['B'])
    expect(feed[0].stages[1].marks.map(m => m.mark_id)).toEqual(['A'])
  })
})
