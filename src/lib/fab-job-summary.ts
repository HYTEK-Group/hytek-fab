// Pure. Turns one fab_jobs row with its nested children into the summary shape
// GET /api/fab/jobs has always returned per job. Shared by the list route and
// GET /api/fab/jobs/[id], so the job page gets the same fields for one job
// without downloading every job.
import { tonnageSummary } from './fab-tonnage'
import { jobActionSummary } from './fab-action-centre'

/** The nested select both routes use — keep them identical. */
export const FAB_JOB_SUMMARY_SELECT = `
      *,
      fab_tasks(id, status),
      fab_time_entries(hours),
      fab_marks(id, status, weight_kg, quantity, dispatch_load_id),
      fab_contractor_packages(id, status, package_type, expected_return_date)
    `

export function summariseFabJob(j: Record<string, unknown>, today: string) {
  const tasks = (j.fab_tasks as Array<{ id: string; status: string }>) ?? []
  const marks = (j.fab_marks as Array<{ id: string; status: string; weight_kg: number | null; quantity: number | null; dispatch_load_id: string | null }>) ?? []
  const timeEntries = (j.fab_time_entries as Array<{ hours: number }>) ?? []
  const packages = (j.fab_contractor_packages as Array<{ id: string; status: string; package_type: string; expected_return_date: string | null }>) ?? []
  const tonnage = tonnageSummary(marks)
  const action = jobActionSummary(marks, packages, today)
  return {
    ...j,
    fab_tasks: undefined,
    fab_marks: undefined,
    fab_time_entries: undefined,
    fab_contractor_packages: undefined,
    task_count: tasks.length,
    task_done: tasks.filter(t => t.status === 'done').length,
    mark_count: marks.length,
    mark_done: marks.filter(m => m.status === 'done' || m.status === 'qc_passed').length,
    total_hours: timeEntries.reduce((s, e) => s + (e.hours ?? 0), 0),
    has_active_packages: packages.some(p => p.status === 'sent' || p.status === 'in_progress'),
    // Tonnage-weighted progress (weight × qty; "made" = done|qc_passed).
    total_kg: tonnage.total_kg,
    made_kg: tonnage.made_kg,
    tonnage_pct: tonnage.pct,
    marks_missing_weight: tonnage.missing_weight,
    // Action Centre rollups (cross-job "what needs me").
    qc_waiting: action.qc_waiting,
    dispatch_ready: action.dispatch_ready,
    packages_out: action.packages_out,
    packages_overdue: action.packages_overdue,
  }
}
