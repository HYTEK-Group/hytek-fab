// Pure per-job "what needs the supervisor" rollup, so the Action Centre can show
// QC / dispatch / contractor work across ALL jobs on one screen instead of
// opening each job and checking each tab.

export interface ActionMark { status: string; dispatch_load_id?: string | null }
export interface ActionPackage { status: string; expected_return_date?: string | null }

export interface JobActionSummary {
  qc_waiting: number       // done|returned marks awaiting QC
  dispatch_ready: number   // qc_passed marks not yet on a dispatch load
  packages_out: number     // contractor packages sent|in_progress
  packages_overdue: number // of those, past their expected return date
}

export function jobActionSummary(
  marks: ActionMark[],
  packages: ActionPackage[],
  today: string,
): JobActionSummary {
  const qc_waiting = marks.filter(m => m.status === 'done' || m.status === 'returned').length
  const dispatch_ready = marks.filter(m => m.status === 'qc_passed' && !m.dispatch_load_id).length
  const out = packages.filter(p => p.status === 'sent' || p.status === 'in_progress')
  const packages_overdue = out.filter(p => !!p.expected_return_date && p.expected_return_date < today).length
  return { qc_waiting, dispatch_ready, packages_out: out.length, packages_overdue }
}
