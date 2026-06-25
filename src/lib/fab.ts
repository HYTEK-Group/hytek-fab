// hytek-fab domain logic — data access + the cross-app stub.
// CARDINAL RULE: all cross-app reach goes through Hub. v1 uses a temporary
// gqtikz stub (getJobState) until the Hub endpoint exists — see CLAUDE.md.

import { supabase } from './supabase'
import type { FabJob, FabStatus, JobState, MarkPhase, TreatmentType } from './types'

// --- Budget cost codes (from Hub import). Maps a code to its fab_jobs column. ---
export const BUDGET_CODES = [
  { code: '0100', label: 'Form 15', field: 'budget_form15' },
  { code: '0200', label: 'Steel supply', field: 'budget_steel_supply' },
  { code: '0300', label: 'Laser plates', field: 'budget_laser_plates' },
  { code: '0400', label: 'Fixings', field: 'budget_fixings' },
  { code: '0500', label: 'TMI fab', field: 'budget_tmi_fab' },
  { code: '1100', label: 'Site welding', field: 'budget_site_welding' },
  { code: '1500', label: 'HDG', field: 'budget_hdg' },
  { code: 'HDGF', label: 'HDG freight', field: 'budget_hdg_freight' },
  { code: 'CRANE', label: 'Cranage', field: 'budget_cranage' },
  { code: 'INST', label: 'Install total', field: 'budget_install' },
] as const
// NOTE/conflict vs brief: the brief lists a "site delivery" budget code but the
// approved schema has no budget_site_delivery column. Omitted here to match the
// schema; flagged for Scott if a column is wanted.

export const STATUS_LABEL: Record<FabStatus, string> = {
  pending: 'Pending',
  ready: 'Ready to fab',
  in_progress: 'In progress',
  complete: 'Complete',
  dispatched: 'Dispatched',
}

export const PHASE_LABEL: Record<MarkPhase, string> = {
  not_started: 'Not started',
  cutting: 'Cutting',
  fit: 'Fit-up',
  weld: 'Welding',
  inspect: 'Inspection',
  finish: 'Finish',
  complete: 'Complete',
}

export const TREATMENT_LABEL: Record<TreatmentType, string> = {
  hdg: 'Galvanising (HDG)',
  paint: 'Paint',
  powder: 'Powder coat',
  none: 'No treatment',
}

// Sum of every budget cost code on a job.
export function totalBudget(j: FabJob): number {
  return BUDGET_CODES.reduce((sum, c) => sum + (Number(j[c.field as keyof FabJob]) || 0), 0)
}

// Award price − total budget = headline margin $ (gross, pre-actuals).
export function marginDollars(j: FabJob): number {
  return (Number(j.award_price_excl_gst) || 0) - totalBudget(j)
}

// Classify a Tekla "Assembly Coating" into a surface-treatment batch type.
//   HDG → galvanising · ETCH PRIMER → paint · DURAGAL/similar → none.
export function classifyCoating(coating: string | null | undefined): TreatmentType {
  const c = (coating || '').toUpperCase()
  if (c.includes('HDG') || c.includes('GALV')) return 'hdg'
  if (c.includes('ETCH') || c.includes('PRIMER') || c.includes('PAINT')) return 'paint'
  if (c.includes('POWDER')) return 'powder'
  return 'none' // DURAGAL or similar — pre-finished, no treatment needed
}

// --- Data access ---
export async function listFabJobs(): Promise<FabJob[]> {
  const { data, error } = await supabase
    .from('fab_jobs')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as FabJob[]
}

export async function getFabJob(id: string): Promise<FabJob | null> {
  const { data, error } = await supabase.from('fab_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as FabJob) ?? null
}

// TEMPORARY STUB — reads Hub-owned flow_jobs directly from gqtikz.
// Deliberate, flagged deviation from hub-and-spoke (cross-app read). Replace
// with: GET {HUB_BASE}/api/flow/job-state/{deal_id} once the Hub endpoint is built.
export async function getJobState(dealId: string | null): Promise<JobState> {
  if (!dealId) return { ss_drawings_issued: false, materials_received: false }
  const { data } = await supabase
    .from('flow_jobs')
    .select('ss_drawings_issued, materials_received')
    .eq('hubspot_deal_id', dealId)
    .maybeSingle()
  return {
    ss_drawings_issued: !!data?.ss_drawings_issued,
    materials_received: !!data?.materials_received,
  }
}

// Bulk job-state lookup for the /ready queue (one query instead of N).
export async function fetchJobStateMap(): Promise<Record<string, JobState>> {
  const { data } = await supabase
    .from('flow_jobs')
    .select('hubspot_deal_id, ss_drawings_issued, materials_received')
  const map: Record<string, JobState> = {}
  for (const r of (data || []) as Array<{ hubspot_deal_id: string | null; ss_drawings_issued: boolean; materials_received: boolean }>) {
    if (r.hubspot_deal_id) {
      map[r.hubspot_deal_id] = {
        ss_drawings_issued: !!r.ss_drawings_issued,
        materials_received: !!r.materials_received,
      }
    }
  }
  return map
}
