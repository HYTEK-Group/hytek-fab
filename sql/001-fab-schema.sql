-- ============================================================================
-- hytek-fab — v1 schema  |  TARGET: gqtikz (gqtikzguvhukpujyxkez)
-- ============================================================================
-- ⚠️  HELD — DO NOT RUN WITHOUT SCOTT'S EXPLICIT OK.
-- gqtikz is the SHARED operations DB (Hub/Detailing/Dispatch/Install/Purchasing).
-- This is a stop-and-coordinate change: one person on the DB at a time.
--
-- BEFORE RUNNING:
--   1. node scripts/whichdb.mjs   → must print ref gqtikzguvhukpujyxkez
--   2. Confirm the project ref in the Supabase editor URL matches.
--   3. Paste this whole file into that project's SQL editor.
--
-- NOTE: the `ALTER TABLE public.flow_jobs ...` block touches a HUB-OWNED table.
--       Recommend Scott runs/owns that line (or it lands via a Hub change),
--       not the fab build. It is included here for completeness only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fab_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL,
  hubspot_deal_id text,
  name text NOT NULL,
  client text,
  on_site_date date,
  cc_level text CHECK (cc_level IN ('CC1','CC2','CC3','CC4')),
  award_price_excl_gst numeric,
  budget_steel_supply numeric,
  budget_laser_plates numeric,
  budget_fixings numeric,
  budget_tmi_fab numeric,
  budget_site_welding numeric,
  budget_hdg numeric,
  budget_hdg_freight numeric,
  budget_form15 numeric,
  budget_cranage numeric,
  budget_install numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','in_progress','complete','dispatched')),
  fab_complete_at timestamptz,
  compliance_mode text NOT NULL DEFAULT 'permissive' CHECK (compliance_mode IN ('permissive','enforced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  mark text NOT NULL,
  profile text,
  grade text,
  length_mm integer,
  qty integer,
  weight_kg_each numeric,
  weight_kg_total numeric,
  assembly_coating text,
  treatment_type text CHECK (treatment_type IN ('hdg','paint','powder','none') OR treatment_type IS NULL),
  allocated_to text DEFAULT 'internal' CHECK (allocated_to IN ('internal','subcontractor')),
  sub_package_id uuid,
  phase text DEFAULT 'not_started' CHECK (phase IN ('not_started','cutting','fit','weld','inspect','finish','complete')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_material_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  section text,
  grade text,
  heat_number text,
  length_mm integer,
  qty integer,
  weight_kg numeric,
  supplier_name text,
  acrs_certified boolean,
  mill_cert_url text,
  heat_number_acknowledged boolean DEFAULT false,
  mill_cert_acknowledged boolean DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by text
);

CREATE TABLE IF NOT EXISTS public.fab_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('cutting','fit','weld','inspect','finish')),
  worker_name text,
  hours numeric NOT NULL CHECK (hours > 0),
  entry_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_sub_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  cost_code text,
  subcontractor_name text,
  budget_amount numeric,
  quoted_amount numeric,
  awarded_amount numeric,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quoted','awarded','in_progress','delivered','accepted','invoiced')),
  mill_certs_received boolean DEFAULT false,
  welder_quals_received boolean DEFAULT false,
  itp_received boolean DEFAULT false,
  doc_of_conformance_received boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_treatment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_type text NOT NULL CHECK (treatment_type IN ('hdg','paint','powder')),
  plant_name text,
  standard text,
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','dispatched_out','in_treatment','dispatched_back','returned','accepted')),
  planned_dispatch_date date,
  actual_dispatch_date date,
  expected_return_date date,
  actual_return_date date,
  treatment_cost numeric,
  transport_cost_out numeric,
  transport_cost_return numeric,
  cost_allocation_method text DEFAULT 'by_tonne',
  inspection_result text CHECK (inspection_result IN ('pass','conditional','fail')),
  inspection_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_treatment_batch_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.fab_treatment_batches(id) ON DELETE CASCADE,
  fab_mark_id uuid NOT NULL REFERENCES public.fab_marks(id),
  fab_job_id uuid NOT NULL REFERENCES public.fab_jobs(id),
  dft_readings jsonb,
  dft_pass boolean,
  ncr_raised boolean DEFAULT false,
  ncr_notes text
);

-- ⚠️ HUB-OWNED TABLE — confirm with Scott before running this line.
ALTER TABLE public.flow_jobs
  ADD COLUMN IF NOT EXISTS ss_drawings_issued boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS materials_received boolean DEFAULT false;

ALTER TABLE public.fab_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_material_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_sub_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_treatment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fab_treatment_batch_marks ENABLE ROW LEVEL SECURITY;

-- Permissive auth_all policy (USING + WITH CHECK — required for FOR ALL inserts).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fab_jobs','fab_marks','fab_material_receipts',
    'fab_time_entries','fab_sub_packages','fab_treatment_batches','fab_treatment_batch_marks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "auth_all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
