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
  estimated_hours: number | null  // allotted hours (supervisor's expectation)
  due_on: string | null           // target date
  created_by: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

// ── fab_marks ──────────────────────────────────────────────────────────────

export type MarkStatus =
  | 'not_started' | 'in_progress' | 'done' | 'at_contractor' | 'returned' | 'qc_passed'
  | 'sub_certified' // drop-ship: sub certs accepted by supervisor — dispatch-ready without in-house QC

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
  contractor_package_id: string | null
  assigned_to: string | null
  rework_count: number
  rework_note: string | null
  dispatch_load_id: string | null
  // ── per-assembly assignment + time + drawing (sql/006) ──
  suggested_minutes: number | null // what the app suggested (measures the learning)
  allotted_minutes: number | null  // supervisor's allotted time (his edit)
  assigned_at: string | null
  started_at: string | null        // worker tapped Start
  finished_at: string | null       // worker tapped Done
  actual_minutes: number | null    // floor actual (ground truth)
  drawing_file: string | null
  drawing_page: number | null
  part_count: number | null
  created_at: string
  updated_at: string
}

// ── fab_proof_photos (append-only proof-of-work chain, sql/007) ──────────────

export type ProofStage = 'made' | 'treatment_out' | 'treatment_in' | 'bundled' | 'loaded'

export interface FabProofPhoto {
  id: string
  fab_job_id: string
  fab_mark_id: string | null
  fab_package_id: string | null
  fab_load_id: string | null
  stage: ProofStage
  treatment_type: string | null
  storage_path: string
  file_name: string | null
  caption: string | null
  taken_by: string
  taken_at: string
  created_at: string
}

// A mark enriched with its learned time suggestion (for the assign view).
export interface AssemblyRow extends FabMark {
  suggestion: {
    minutes: number
    basis: string
    confidence: 'low' | 'medium' | 'good'
    samples: number
  }
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

/** One stream's latest "Release to Factory" (Hub flow_releases). Present once the
 *  detailing app has deliberately released the stream; null/absent before that. */
export interface ReleaseSummary {
  version: number
  released_at: string | null
  released_by: string | null
  note: string | null
}

export interface HubJobState {
  ok: boolean
  deal_id: string | null
  quote_number: string | null
  state: string
  tier: string | null
  /** true = all SS drawing tasks approved via detailing_handoffs (internal QA —
   *  demoted: a precondition, NOT the manufacturing trigger). */
  ready_to_ship: boolean
  /** The deliberate "Release to Factory" per stream (the real trigger). Optional:
   *  absent until the Hub publishes it — fab falls back to ready_to_ship until then. */
  ss_release?: ReleaseSummary | null
  lws_release?: ReleaseSummary | null
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
  /** true = a deliberate "Release to Factory" (ss_release) is present on the Hub. */
  ss_released: boolean
  /** the ss_release version, when released. */
  release_version: number | null
  /** Both signals true — show "Start fabrication" */
  ready: boolean
}

// ── fab_pins ───────────────────────────────────────────────────────────────

export interface FabPin {
  id: string
  worker_name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

// ── fab_contractor_packages ─────────────────────────────────────────────────

export type PackageType = 'fabrication' | 'treatment' | 'other'
export type TreatmentType = 'hdg' | 'etch_primer' | 'powder_coat' | 'two_pack' | 'other'
export type ContractorPackageStatus =
  | 'pending' | 'sent' | 'in_progress' | 'returned' | 'inspected'
/** How the package's steel reaches site (sql/008). Drop-ship skips in-house QC,
 *  so it needs sub certs + a supervisor release before dispatch. */
export type DeliveryMode = 'return_to_brisbane' | 'drop_ship'

export interface FabContractorPackage {
  id: string
  fab_job_id: string
  package_type: PackageType
  treatment_type: TreatmentType | null
  contractor_name: string
  contractor_contact: string | null
  scope_note: string | null
  sent_at: string | null
  expected_return_date: string | null
  returned_at: string | null
  status: ContractorPackageStatus
  delivery_mode: DeliveryMode
  /** Sub tapped "ready to collect" (sql/008). */
  ready_at: string | null
  /** Supervisor accepted the drop-ship (certs sighted) — marks became sub_certified. */
  drop_ship_released_at: string | null
  drop_ship_released_by: string | null
  created_by: string
  created_at: string
  updated_at: string
}

// ── fab_sub_accounts + fab_sub_grants (subcontractor guest access, sql/008) ──

export interface FabSubAccount {
  id: string
  contractor_name: string
  login_slug: string
  /** bcrypt hash; null until the sub sets a PIN on first open. NEVER sent to a client. */
  pin_hash: string | null
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface FabSubGrant {
  id: string
  sub_account_id: string
  package_id: string
  granted_by: string
  granted_at: string
  revoked_at: string | null
}

// ── fab_package_certs (append-only QA/mill/weld/coating certs, sql/008) ──────

export type CertKind = 'qa' | 'weld' | 'mill' | 'coating' | 'itp' | 'other'

export interface FabPackageCert {
  id: string
  fab_package_id: string
  fab_job_id: string
  kind: CertKind
  storage_path: string
  file_name: string | null
  note: string | null
  uploaded_by: string
  uploaded_at: string
  created_at: string
}

export interface FabContractorUpdate {
  id: string
  package_id: string
  logged_at: string
  note: string
  reported_pct: number | null
  eta: string | null
  entered_by: string
  created_at: string
}

// ── fab_qc_events ──────────────────────────────────────────────────────────

export type QcResult = 'pass' | 'fail'
export type ReworkType = 'inhouse' | 'contractor'

export interface FabQcEvent {
  id: string
  fab_job_id: string
  mark_id: string
  inspected_by: string
  result: QcResult
  defect_note: string | null
  rework_type: ReworkType | null
  created_at: string
}

// ── fab_dispatch_loads ─────────────────────────────────────────────────────

export interface FabDispatchLoad {
  id: string
  fab_job_id: string
  load_number: number
  description: string | null
  planned_date: string | null
  dispatched_at: string | null
  driver: string | null
  note: string | null
  created_by: string
  created_at: string
}

// ── flow_fab_progress (Hub feed) ───────────────────────────────────────────

export type FabProgressStatus = 'in_progress' | 'complete' | 'dispatch_ready' | 'dispatched'

export interface FabProgressPackageSummary {
  package_id: string
  package_type: PackageType
  treatment_type: TreatmentType | null
  contractor_name: string
  scope_note: string | null
  total_marks: number
  marks_done: number
  pct: number
  status: ContractorPackageStatus
  last_update_date: string | null
  last_update_note: string | null
  expected_return_date: string | null
  returned_at: string | null
}

export interface FabProgressLoadSummary {
  load_number: number
  description: string | null
  total_marks: number
  dispatched_at: string | null
  planned_date: string | null
}

export interface FabProgressRow {
  fab_job_id: string
  quote_number: string
  hubspot_deal_id: string | null
  total_marks: number
  marks_qc_passed: number
  marks_dispatched: number
  pct_complete: number
  inhouse_total: number
  inhouse_complete: number
  rework_total: number
  /** Σ weight×qty of all marks, in tonnes (Hub feed). */
  tonnes_total: number
  /** Σ weight×qty of QC-passed marks, in tonnes (Hub "complete"). */
  tonnes_complete: number
  contractor_packages: FabProgressPackageSummary[]
  dispatch_loads: FabProgressLoadSummary[]
  narrative: string
  status: FabProgressStatus
}
