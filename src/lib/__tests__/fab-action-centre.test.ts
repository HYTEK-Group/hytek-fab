import { describe, it, expect } from 'vitest'
import { jobActionSummary } from '../fab-action-centre'

describe('jobActionSummary', () => {
  it('counts QC waiting (done|returned) and dispatch-ready (qc_passed not on a load)', () => {
    const marks = [
      { status: 'done' }, { status: 'returned' }, { status: 'in_progress' },
      { status: 'qc_passed', dispatch_load_id: null },
      { status: 'qc_passed', dispatch_load_id: 'L1' }, // already on a load → not ready
    ]
    const s = jobActionSummary(marks, [], '2026-06-28')
    expect(s.qc_waiting).toBe(2)
    expect(s.dispatch_ready).toBe(1)
  })

  it('counts contractor packages out and flags overdue', () => {
    const pkgs = [
      { status: 'sent', expected_return_date: '2026-06-20' },        // overdue
      { status: 'in_progress', expected_return_date: '2026-07-10' }, // out, not overdue
      { status: 'pending', expected_return_date: '2026-06-01' },     // not out yet
      { status: 'inspected', expected_return_date: '2026-06-01' },   // done
    ]
    const s = jobActionSummary([], pkgs, '2026-06-28')
    expect(s.packages_out).toBe(2)
    expect(s.packages_overdue).toBe(1)
  })

  it('is all-zero for an idle job', () => {
    const s = jobActionSummary([{ status: 'not_started' }], [], '2026-06-28')
    expect(s).toEqual({ qc_waiting: 0, dispatch_ready: 0, packages_out: 0, packages_overdue: 0 })
  })
})
