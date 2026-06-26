// Types for hytek-fab. Mirrors gqtikz schema columns we actually use.
// Duplicated from shared schema (no shared package) — divergence caught by tsc.

export type UserRole = 'admin' | 'supervisor' | 'fabricator'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  created_at: string
}

// ── gqtikz shared tables (READ-ONLY from fab) ──────────────────────────────

export interface SharedJob {
  id: string
  quote_number: string
  name: string
  client: string | null
  location: string | null
  status: string | null
}

// ── fab_jobs ───────────────────────────────────────────────────────────────

export type FabJobStatus = 'in_progress' | 'complete' | 'dispatched'
export type ComplianceMode = 'permissive' | 'enforced'
export type CcLevel = 'CC1' | 'CC2' | 'CC3' | 'CC4'

export interface FabJob {
  id: string
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  client: string | null
  on_site_date: string | null
  cc_level: CcLevel | null
  status: FabJobStatus
  fab_complete_at: string | null
  dispatch_requested_at: string | null
  compliance_mode: ComplianceMode
  started_by: string
  created_at: string
  updated_at: string
}

// ── fab_tasks ──────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'done'

export interface FabTask {
  id: string
  fab_job_id: string
  description: string
  assigned_to: string | null
  status: TaskStatus
  created_by: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

// ── fab_marks ──────────────────────────────────────────────────────────────

export type MarkStatus = 'not_started' | 'in_progress' | 'done' | 'at_treatment' | 'returned'

export interface FabMark {
  id: string
  fab_job_id: string
  mark_id: string
  description: string | null
  section: string | null
  length_mm: number | null
  weight_kg: number | null
  quantity: number
  status: MarkStatus
  note: string | null
  created_at: string
  updated_at: string
}

// ── fab_time_entries ───────────────────────────────────────────────────────

export interface FabTimeEntry {
  id: string
  fab_job_id: string
  worker_name: string
  hours: number
  work_date: string
  note: string | null
  entered_by: string
  created_at: string
}

// ── fab_weekly_entries ─────────────────────────────────────────────────────

export interface FabWeeklyEntry {
  id: string
  fab_job_id: string
  quote_number: string
  week_start: string
  tonnes: number
  hours: number | null
  note: string | null
  entered_by: string
  created_at: string
}

// ── Hub job-state response ─────────────────────────────────────────────────

export interface HubJobState {
  ok: boolean
  deal_id: string | null
  quote_number: string | null
  state: string
  tier: string | null
  /** true = all SS drawing tasks approved via detailing_handoffs */
  ready_to_ship: boolean
  missing: string[]
  /** true = purchasing confirmed steel delivered (not yet in Hub — default false) */
  materials_received?: boolean
  delivered: boolean
  on_site_date: string | null
  locked: boolean
}

// ── Ready-queue item (enriched from Hub) ───────────────────────────────────

export interface ReadyQueueItem {
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  client: string | null
  on_site_date: string | null
  ss_drawings_issued: boolean
  materials_received: boolean
  /** Both signals true — show "Start fabrication" */
  ready: boolean
}
