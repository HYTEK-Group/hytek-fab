// Pure builder for the read-only dispatch feed the driver app consumes. Given a
// job's loads and marks, it produces dispatchable units (loads + their marks, plus
// QC-passed marks not yet on a load) with per-load tonnage — so the dispatcher can
// build trips and sequence by on-site date. PURE (no DB) → testable.

export interface DispatchFeedJob {
  id: string
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  on_site_date: string | null
  dispatch_requested_at: string | null
}
export interface DispatchFeedLoad {
  id: string
  fab_job_id: string
  load_number: number
  description: string | null
  planned_date: string | null
  dispatched_at: string | null
  driver: string | null
}
export interface DispatchFeedMark {
  fab_job_id: string
  mark_id: string
  section: string | null
  weight_kg: number | null
  quantity: number | null
  status: string
  dispatch_load_id: string | null
}

export interface DispatchUnit {
  mark_id: string
  section: string | null
  weight_kg: number | null // per one
  quantity: number
}
export interface DispatchLoadOut {
  id: string
  load_number: number
  description: string | null
  planned_date: string | null
  dispatched_at: string | null
  driver: string | null
  tonnes: number
  marks: DispatchUnit[]
}
export interface DispatchJobOut {
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  on_site_date: string | null
  dispatch_requested_at: string | null
  loads: DispatchLoadOut[]
  /** QC-passed marks not yet assigned to a load — ready to be loaded. */
  unassigned_ready: DispatchUnit[]
  tonnes_ready: number
}

const toUnit = (m: DispatchFeedMark): DispatchUnit => ({
  mark_id: m.mark_id,
  section: m.section,
  weight_kg: m.weight_kg,
  // default null → 1, but keep an explicit 0 as 0 (don't inflate tonnage).
  quantity: Math.max(0, Math.round(m.quantity ?? 1)),
})

const tonnesOf = (units: DispatchUnit[]): number =>
  Math.round((units.reduce((s, u) => s + Math.max(0, u.weight_kg ?? 0) * u.quantity, 0) / 1000) * 1000) / 1000

export function buildDispatchFeed(
  jobs: DispatchFeedJob[],
  loads: DispatchFeedLoad[],
  marks: DispatchFeedMark[],
): DispatchJobOut[] {
  const loadsByJob = new Map<string, DispatchFeedLoad[]>()
  for (const l of loads) {
    const a = loadsByJob.get(l.fab_job_id) ?? []
    a.push(l); loadsByJob.set(l.fab_job_id, a)
  }
  const marksByJob = new Map<string, DispatchFeedMark[]>()
  for (const m of marks) {
    const a = marksByJob.get(m.fab_job_id) ?? []
    a.push(m); marksByJob.set(m.fab_job_id, a)
  }

  const out: DispatchJobOut[] = []
  for (const job of jobs) {
    const jobLoads = (loadsByJob.get(job.id) ?? []).slice().sort((a, b) => a.load_number - b.load_number)
    const jobMarks = marksByJob.get(job.id) ?? []

    const loadsOut: DispatchLoadOut[] = jobLoads.map(l => {
      const units = jobMarks.filter(m => m.dispatch_load_id === l.id).map(toUnit)
      return {
        id: l.id,
        load_number: l.load_number,
        description: l.description,
        planned_date: l.planned_date,
        dispatched_at: l.dispatched_at,
        driver: l.driver,
        tonnes: tonnesOf(units),
        marks: units,
      }
    })

    const unassignedReady = jobMarks
      .filter(m => m.status === 'qc_passed' && !m.dispatch_load_id)
      .map(toUnit)

    // Only surface jobs that are actually relevant to dispatch.
    if (loadsOut.length === 0 && unassignedReady.length === 0 && !job.dispatch_requested_at) continue

    out.push({
      quote_number: job.quote_number,
      hubspot_deal_id: job.hubspot_deal_id,
      name: job.name,
      on_site_date: job.on_site_date,
      dispatch_requested_at: job.dispatch_requested_at,
      loads: loadsOut,
      unassigned_ready: unassignedReady,
      tonnes_ready: tonnesOf(unassignedReady),
    })
  }

  // Sort by on-site date (soonest first); nulls last.
  out.sort((a, b) => {
    if (a.on_site_date && b.on_site_date) return a.on_site_date.localeCompare(b.on_site_date)
    if (a.on_site_date) return -1
    if (b.on_site_date) return 1
    return 0
  })
  return out
}
