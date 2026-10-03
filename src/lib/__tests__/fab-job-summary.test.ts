import { describe, it, expect } from 'vitest'
import { summariseFabJob } from '../fab-job-summary'

describe('summariseFabJob', () => {
  it('rolls nested children into the list-route summary fields and drops the arrays', () => {
    const out: Record<string, unknown> = summariseFabJob({
      id: 'j1',
      quote_number: '26010101',
      fab_tasks: [{ id: 't1', status: 'done' }, { id: 't2', status: 'todo' }],
      fab_time_entries: [{ hours: 2.5 }, { hours: 1 }],
      fab_marks: [
        { id: 'm1', status: 'done', weight_kg: 100, quantity: 2, dispatch_load_id: null },
        { id: 'm2', status: 'qc_passed', weight_kg: 50, quantity: 1, dispatch_load_id: null },
        { id: 'm3', status: 'not_started', weight_kg: null, quantity: 1, dispatch_load_id: null },
      ],
      fab_contractor_packages: [{ id: 'p1', status: 'sent', package_type: 'galv', expected_return_date: null }],
    }, '2026-09-30')

    expect(out.id).toBe('j1')
    expect(out.quote_number).toBe('26010101')
    expect(out.fab_tasks).toBeUndefined()
    expect(out.fab_marks).toBeUndefined()
    expect(out.fab_time_entries).toBeUndefined()
    expect(out.fab_contractor_packages).toBeUndefined()
    expect(out.task_count).toBe(2)
    expect(out.task_done).toBe(1)
    expect(out.mark_count).toBe(3)
    expect(out.mark_done).toBe(2)
    expect(out.total_hours).toBe(3.5)
    expect(out.has_active_packages).toBe(true)
    expect(out.total_kg).toBe(250)
    expect(out.made_kg).toBe(250)
    expect(out.marks_missing_weight).toBe(1)
    expect(out.qc_waiting).toBe(1)
    expect(out.packages_out).toBe(1)
  })

  it('treats missing children as empty', () => {
    const out: Record<string, unknown> = summariseFabJob({ id: 'j2' }, '2026-09-30')
    expect(out.task_count).toBe(0)
    expect(out.mark_count).toBe(0)
    expect(out.total_hours).toBe(0)
    expect(out.has_active_packages).toBe(false)
  })
})
