import { describe, it, expect } from 'vitest'
import { computeProgressRow } from '../fab-progress'
import type {
  FabMark, FabContractorPackage, FabContractorUpdate, FabDispatchLoad,
} from '../types'

function mark(p: Partial<FabMark>): FabMark {
  return {
    id: 'm', fab_job_id: 'j', mark_id: 'A1', description: null, section: null,
    length_mm: null, weight_kg: null, quantity: 1, status: 'not_started',
    note: null, contractor_package_id: null, assigned_to: null,
    rework_count: 0, rework_note: null, dispatch_load_id: null,
    suggested_minutes: null, allotted_minutes: null, assigned_at: null,
    started_at: null, finished_at: null, actual_minutes: null,
    drawing_file: null, drawing_page: null, part_count: null,
    created_at: '', updated_at: '', ...p,
  }
}

const job = {
  fab_job_id: 'job-1', quote_number: 'Q100', hubspot_deal_id: 'D1',
  on_site_date: '2026-08-01',
}

describe('computeProgressRow', () => {
  it('pct_complete is tonnage-weighted (made = done|qc_passed by weight)', () => {
    const marks = [
      mark({ id: '1', status: 'qc_passed', weight_kg: 400, quantity: 1 }),  // 400 made
      mark({ id: '2', status: 'done', weight_kg: 100, quantity: 1 }),       // 100 made
      mark({ id: '3', status: 'in_progress', weight_kg: 200, quantity: 1 }), // 200 not
      mark({ id: '4', status: 'not_started', weight_kg: 300, quantity: 1 }), // 300 not
    ]
    const row = computeProgressRow(job, marks, [], [], [], '2026-06-27')
    expect(row.total_marks).toBe(4)
    expect(row.marks_qc_passed).toBe(1)
    expect(row.pct_complete).toBe(50) // 500 made / 1000 total kg
    expect(row.tonnes_total).toBe(1) // 1000 kg
    expect(row.tonnes_complete).toBe(0.4) // 400 kg qc-passed
  })

  it('counts in-house pool (no package) complete = done|qc_passed', () => {
    const marks = [
      mark({ id: '1', status: 'done' }),
      mark({ id: '2', status: 'qc_passed' }),
      mark({ id: '3', status: 'in_progress' }),
      mark({ id: '4', status: 'at_contractor', contractor_package_id: 'p1' }),
    ]
    const row = computeProgressRow(job, marks, [], [], [], '2026-06-27')
    expect(row.inhouse_total).toBe(3)
    expect(row.inhouse_complete).toBe(2)
  })

  it('summarises a contractor package with its latest update', () => {
    const pkg: FabContractorPackage = {
      id: 'p1', fab_job_id: 'job-1', package_type: 'treatment',
      treatment_type: 'hdg', contractor_name: 'QLD Galv', contractor_contact: null,
      scope_note: 'HDG columns', sent_at: '2026-06-20', expected_return_date: '2026-06-27',
      returned_at: null, status: 'sent', delivery_mode: 'return_to_brisbane',
      ready_at: null, drop_ship_released_at: null, drop_ship_released_by: null,
      created_by: 'sup', created_at: '', updated_at: '',
    }
    const marks = [
      mark({ id: '1', status: 'at_contractor', contractor_package_id: 'p1' }),
      mark({ id: '2', status: 'returned', contractor_package_id: 'p1' }),
    ]
    const updates: FabContractorUpdate[] = [
      { id: 'u1', package_id: 'p1', logged_at: '2026-06-22', note: '50% done',
        reported_pct: 50, eta: '2026-06-27', entered_by: 'sup', created_at: '2026-06-22' },
      { id: 'u2', package_id: 'p1', logged_at: '2026-06-24', note: 'almost there',
        reported_pct: 80, eta: '2026-06-27', entered_by: 'sup', created_at: '2026-06-24' },
    ]
    const row = computeProgressRow(job, marks, [pkg], updates, [], '2026-06-27')
    expect(row.contractor_packages).toHaveLength(1)
    const p = row.contractor_packages[0]
    expect(p.total_marks).toBe(2)
    expect(p.marks_done).toBe(1)
    expect(p.last_update_note).toBe('almost there')
  })

  it('counts rework_total as marks with rework_count > 0', () => {
    const marks = [
      mark({ id: '1', rework_count: 2 }),
      mark({ id: '2', rework_count: 0 }),
      mark({ id: '3', rework_count: 1 }),
    ]
    const row = computeProgressRow(job, marks, [], [], [], '2026-06-27')
    expect(row.rework_total).toBe(2)
  })

  it('counts dispatched marks and summarises loads', () => {
    const loads: FabDispatchLoad[] = [
      { id: 'L1', fab_job_id: 'job-1', load_number: 1, description: 'beams',
        planned_date: '2026-06-27', dispatched_at: '2026-06-27', driver: 'Bob',
        note: null, created_by: 'sup', created_at: '' },
      { id: 'L2', fab_job_id: 'job-1', load_number: 2, description: 'plates',
        planned_date: '2026-06-28', dispatched_at: null, driver: null,
        note: null, created_by: 'sup', created_at: '' },
    ]
    const marks = [
      mark({ id: '1', status: 'qc_passed', dispatch_load_id: 'L1' }),
      mark({ id: '2', status: 'qc_passed', dispatch_load_id: 'L1' }),
      mark({ id: '3', status: 'qc_passed', dispatch_load_id: 'L2' }),
    ]
    const row = computeProgressRow(job, marks, [], [], loads, '2026-06-27')
    expect(row.marks_dispatched).toBe(2)
    expect(row.dispatch_loads).toHaveLength(2)
    expect(row.dispatch_loads[0].total_marks).toBe(2)
  })

  it('sets status=dispatched when every mark is in a dispatched load', () => {
    const loads: FabDispatchLoad[] = [
      { id: 'L1', fab_job_id: 'job-1', load_number: 1, description: null,
        planned_date: null, dispatched_at: '2026-06-27', driver: null, note: null,
        created_by: 'sup', created_at: '' },
    ]
    const marks = [
      mark({ id: '1', status: 'qc_passed', dispatch_load_id: 'L1' }),
      mark({ id: '2', status: 'qc_passed', dispatch_load_id: 'L1' }),
    ]
    const row = computeProgressRow(job, marks, [], [], loads, '2026-06-27')
    expect(row.status).toBe('dispatched')
  })

  it('sets status=dispatch_ready when all qc_passed but none dispatched', () => {
    const marks = [
      mark({ id: '1', status: 'qc_passed' }),
      mark({ id: '2', status: 'qc_passed' }),
    ]
    const row = computeProgressRow(job, marks, [], [], [], '2026-06-27')
    expect(row.status).toBe('dispatch_ready')
  })

  it('handles zero marks without dividing by zero', () => {
    const row = computeProgressRow(job, [], [], [], [], '2026-06-27')
    expect(row.total_marks).toBe(0)
    expect(row.pct_complete).toBe(0)
    expect(row.status).toBe('in_progress')
  })
})
