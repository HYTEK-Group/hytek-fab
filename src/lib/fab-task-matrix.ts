// Pure productivity matrix. The supervisor breaks a job into tasks, each with
// allotted (estimated) hours and the marks it covers (→ tonnes). Actual hours are
// logged against the task. This turns those into expected-vs-actual + tonnes/hour,
// per task and per job. In-house only — contractor work has no allotted time.

export interface MatrixTask {
  id: string
  description: string
  estimated_hours: number | null
  actual_hours: number // already summed from time entries for this task
  tonnes: number       // already summed from the task's linked marks (weight×qty/1000)
}

export interface TaskMatrixRow extends MatrixTask {
  variance_hours: number | null   // actual − estimated (null if no estimate set)
  tonnes_per_hour: number | null  // tonnes ÷ actual_hours (null if no hours logged)
}

export interface JobMatrix {
  tasks: TaskMatrixRow[]
  total_estimated: number
  total_actual: number
  total_tonnes: number
  tonnes_per_hour: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildTaskMatrix(tasks: MatrixTask[]): JobMatrix {
  const rows: TaskMatrixRow[] = tasks.map(t => ({
    ...t,
    variance_hours: t.estimated_hours == null ? null : round2(t.actual_hours - t.estimated_hours),
    tonnes_per_hour: t.actual_hours > 0 ? round2(t.tonnes / t.actual_hours) : null,
  }))
  const total_estimated = round2(rows.reduce((s, t) => s + (t.estimated_hours ?? 0), 0))
  const total_actual = round2(rows.reduce((s, t) => s + t.actual_hours, 0))
  const total_tonnes = round2(rows.reduce((s, t) => s + t.tonnes, 0))
  return {
    tasks: rows,
    total_estimated,
    total_actual,
    total_tonnes,
    tonnes_per_hour: total_actual > 0 ? round2(total_tonnes / total_actual) : null,
  }
}
