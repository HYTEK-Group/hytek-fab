// Pure builder for the read-only dispatch feed the driver app consumes. Given a
// job's loads and marks, it produces dispatchable units (loads + their marks, plus
// dispatch-ready marks not yet on a load) with per-load tonnage — so the dispatcher
// can build trips and sequence by on-site date. PURE (no DB) → testable.
//
// Dispatch-ready = 'qc_passed' (in-house QC) OR 'sub_certified' (drop-ship steel a
// subcontractor made, released on their certs by a supervisor — it never comes to
// Brisbane). Drop-ship jobs also carry a pickup hint: the truck collects from the
// SUB'S yard, not the HYTEK factory.

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
  /** Which contractor package fabricated this mark (null = made in-house). */
  contractor_package_id?: string | null
  /** Which delivery stage this piece is planned into (sql/012; null = unstaged). */
  delivery_stage_id?: string | null
}
/** Drop-ship released packages — the pickup-at-sub-yard hint for the dispatcher. */
export interface DispatchFeedPackage {
  id: string
  fab_job_id: string
  contractor_name: string
  contractor_contact: string | null
  delivery_mode: string
  drop_ship_released_at: string | null
}
/** A fab-planned delivery stage (the Hub mirrors each onto the /deliveries board). */
export interface DispatchFeedStage {
  id: string
  fab_job_id: string
  stage_ref: string
  name: string
  required_on_site_date: string | null
  sequence_no: number
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
/** One pickup-at-subcontractor hint (drop-ship steel waiting at the sub's yard). */
export interface DispatchPickup {
  contractor_name: string
  contractor_contact: string | null
  released_at: string
  tonnes: number
  pieces: number
}
/** A fab-planned delivery stage, ready for the Hub to mirror onto the board.
 *  CONTRACT: `tonnes`/`marks` here are the PLAN and deliberately OVERLAP the same
 *  job's `loads`, `unassigned_ready` and `pickups` (a stage is what's intended for
 *  a drop; loads/ready/pickups are the physical roll-up as it happens). Consumers
 *  MUST NOT sum stages with loads/ready/pickups — that double-counts the steel. */
export interface DispatchStageOut {
  stage_ref: string
  name: string
  required_on_site_date: string | null
  sequence_no: number
  marks: DispatchUnit[]
  tonnes: number
  pieces: number
}

export interface DispatchJobOut {
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  on_site_date: string | null
  dispatch_requested_at: string | null
  loads: DispatchLoadOut[]
  /** Dispatch-ready marks (qc_passed | sub_certified) not yet assigned to a load. */
  unassigned_ready: DispatchUnit[]
  tonnes_ready: number
  /** Drop-ship steel: collect from these subcontractor yards, not the factory. */
  pickups: DispatchPickup[]
  /** Fab-planned delivery stages (pieces + on-site date + build order). */
  stages: DispatchStageOut[]
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
  packages: DispatchFeedPackage[] = [],
  stages: DispatchFeedStage[] = [],
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
  const packagesByJob = new Map<string, DispatchFeedPackage[]>()
  for (const p of packages) {
    const a = packagesByJob.get(p.fab_job_id) ?? []
    a.push(p); packagesByJob.set(p.fab_job_id, a)
  }
  const stagesByJob = new Map<string, DispatchFeedStage[]>()
  for (const s of stages) {
    const a = stagesByJob.get(s.fab_job_id) ?? []
    a.push(s); stagesByJob.set(s.fab_job_id, a)
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

    // In-house steel ready to load at the FACTORY (qc_passed). Drop-ship
    // (sub_certified) steel is deliberately NOT here — it never touches the
    // factory floor; it surfaces only under `pickups` (collect at the sub's
    // yard), so the same tonnage is never counted in two places.
    const unassignedReady = jobMarks
      .filter(m => m.status === 'qc_passed' && !m.dispatch_load_id)
      .map(toUnit)

    // Pickup hints: drop-ship released packages → collect at the sub's yard.
    // Tonnage/pieces per pickup come from that package's sub_certified marks.
    const pickups: DispatchPickup[] = (packagesByJob.get(job.id) ?? [])
      .filter(p => p.delivery_mode === 'drop_ship' && p.drop_ship_released_at)
      .map(p => {
        const units = jobMarks
          .filter(m => m.contractor_package_id === p.id && m.status === 'sub_certified')
          .map(toUnit)
        return {
          contractor_name: p.contractor_name,
          contractor_contact: p.contractor_contact,
          released_at: p.drop_ship_released_at as string,
          tonnes: tonnesOf(units),
          pieces: units.reduce((s, u) => s + u.quantity, 0),
        }
      })

    // Fab-planned delivery stages (the Hub mirrors these onto the board). Built
    // EARLY — a stage exists before its steel is ready — so a job with stages is
    // surfaced even if nothing is loaded/ready yet.
    const stagesOut: DispatchStageOut[] = (stagesByJob.get(job.id) ?? [])
      .slice().sort((a, b) => a.sequence_no - b.sequence_no || a.stage_ref.localeCompare(b.stage_ref))
      .map(s => {
        const units = jobMarks.filter(m => m.delivery_stage_id === s.id).map(toUnit)
        return {
          stage_ref: s.stage_ref,
          name: s.name,
          required_on_site_date: s.required_on_site_date,
          sequence_no: s.sequence_no,
          marks: units,
          tonnes: tonnesOf(units),
          pieces: units.reduce((sum, u) => sum + u.quantity, 0),
        }
      })

    // Only surface jobs that are actually relevant to dispatch.
    if (loadsOut.length === 0 && unassignedReady.length === 0 && stagesOut.length === 0 && !job.dispatch_requested_at) continue

    out.push({
      quote_number: job.quote_number,
      hubspot_deal_id: job.hubspot_deal_id,
      name: job.name,
      on_site_date: job.on_site_date,
      dispatch_requested_at: job.dispatch_requested_at,
      loads: loadsOut,
      unassigned_ready: unassignedReady,
      tonnes_ready: tonnesOf(unassignedReady),
      pickups,
      stages: stagesOut,
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
