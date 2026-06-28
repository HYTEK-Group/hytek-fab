import { describe, it, expect } from 'vitest'
import { buildTaskMatrix } from '../fab-task-matrix'

describe('buildTaskMatrix', () => {
  it('computes variance (actual − estimated) and tonnes/hour per task', () => {
    const m = buildTaskMatrix([
      { id: '1', description: 'Cut', estimated_hours: 8, actual_hours: 10, tonnes: 5 },
      { id: '2', description: 'Weld', estimated_hours: 12, actual_hours: 9, tonnes: 3 },
    ])
    expect(m.tasks[0].variance_hours).toBe(2)   // 10 − 8 (over)
    expect(m.tasks[0].tonnes_per_hour).toBe(0.5) // 5 / 10
    expect(m.tasks[1].variance_hours).toBe(-3)  // 9 − 12 (under)
    expect(m.tasks[1].tonnes_per_hour).toBe(0.33) // 3 / 9 → 0.333 → 0.33
  })

  it('leaves variance null when no estimate, and t/h null when no hours', () => {
    const m = buildTaskMatrix([
      { id: '1', description: 'Fit', estimated_hours: null, actual_hours: 4, tonnes: 2 },
      { id: '2', description: 'Paint', estimated_hours: 5, actual_hours: 0, tonnes: 1 },
    ])
    expect(m.tasks[0].variance_hours).toBeNull()
    expect(m.tasks[0].tonnes_per_hour).toBe(0.5)
    expect(m.tasks[1].variance_hours).toBe(-5)
    expect(m.tasks[1].tonnes_per_hour).toBeNull()
  })

  it('rolls up job totals + overall tonnes/hour', () => {
    const m = buildTaskMatrix([
      { id: '1', description: 'A', estimated_hours: 8, actual_hours: 10, tonnes: 5 },
      { id: '2', description: 'B', estimated_hours: 12, actual_hours: 10, tonnes: 5 },
    ])
    expect(m.total_estimated).toBe(20)
    expect(m.total_actual).toBe(20)
    expect(m.total_tonnes).toBe(10)
    expect(m.tonnes_per_hour).toBe(0.5) // 10 / 20
  })

  it('handles an empty task list', () => {
    const m = buildTaskMatrix([])
    expect(m).toEqual({ tasks: [], total_estimated: 0, total_actual: 0, total_tonnes: 0, tonnes_per_hour: null })
  })
})
