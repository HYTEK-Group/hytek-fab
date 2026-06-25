// Shared types for hytek-fab. Mirror the gqtikz schema in sql/001-fab-schema.sql.

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'supervisor' | 'detailer' | string
  active?: boolean
}

export type FabStatus = 'pending' | 'ready' | 'in_progress' | 'complete' | 'dispatched'
export type ComplianceMode = 'permissive' | 'enforced'
export type CcLevel = 'CC1' | 'CC2' | 'CC3' | 'CC4'
export type TreatmentType = 'hdg' | 'paint' | 'powder' | 'none'
export type MarkPhase = 'not_started' | 'cutting' | 'fit' | 'weld' | 'inspect' | 'finish' | 'complete'
export type AllocatedTo = 'internal' | 'subcontractor'

export interface FabJob {
  id: string
  quote_number: string
  hubspot_deal_id: string | null
  name: string
  client: string | null
  on_site_date: string | null
  cc_level: CcLevel | null
  award_price_excl_gst: number | null
  budget_steel_supply: number | null
  budget_laser_plates: number | null
  budget_fixings: number | null
  budget_tmi_fab: number | null
  budget_site_welding: number | null
  budget_hdg: number | null
  budget_hdg_freight: number | null
  budget_form15: number | null
  budget_cranage: number | null
  budget_install: number | null
  status: FabStatus
  fab_complete_at: string | null
  compliance_mode: ComplianceMode
  created_at: string
  updated_at: string
}

export interface FabMark {
  id: string
  fab_job_id: string
  mark: string
  profile: string | null
  grade: string | null
  length_mm: number | null
  qty: number | null
  weight_kg_each: number | null
  weight_kg_total: number | null
  assembly_coating: string | null
  treatment_type: TreatmentType | null
  allocated_to: AllocatedTo
  sub_package_id: string | null
  phase: MarkPhase
  created_at: string
}

export interface FabMaterialReceipt {
  id: string
  fab_job_id: string
  section: string | null
  grade: string | null
  heat_number: string | null
  length_mm: number | null
  qty: number | null
  weight_kg: number | null
  supplier_name: string | null
  acrs_certified: boolean | null
  mill_cert_url: string | null
  heat_number_acknowledged: boolean
  mill_cert_acknowledged: boolean
  received_at: string
  received_by: string | null
}

export interface FabTimeEntry {
  id: string
  fab_job_id: string
  phase: 'cutting' | 'fit' | 'weld' | 'inspect' | 'finish'
  worker_name: string | null
  hours: number
  entry_date: string
  note: string | null
  created_at: string
}

export interface FabSubPackage {
  id: string
  fab_job_id: string
  name: string
  cost_code: string | null
  subcontractor_name: string | null
  budget_amount: number | null
  quoted_amount: number | null
  awarded_amount: number | null
  status: 'draft' | 'quoted' | 'awarded' | 'in_progress' | 'delivered' | 'accepted' | 'invoiced'
  mill_certs_received: boolean
  welder_quals_received: boolean
  itp_received: boolean
  doc_of_conformance_received: boolean
  created_at: string
}

// Cross-app job-state from Hub (v1 reads gqtikz flow_jobs directly — see fab.ts getJobState)
export interface JobState {
  ss_drawings_issued: boolean
  materials_received: boolean
}
