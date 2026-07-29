-- =====================================================================
-- HYTEK Fab — 012: delivery stages (the fab-owned delivery plan)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez). Apply under the gqtikz
-- coordination_lock. Idempotent, additive.
--
-- A DELIVERY STAGE = an ordered set of a job's pieces + a required-on-site date,
-- in install build order. Fab OWNS this plan (the steel + marks live here). It's
-- exposed read-only on the dispatch bridge; the Hub mirrors each stage onto the
-- /deliveries board (flow_parcels) and Troy books trucks against it. Fab never
-- writes Hub/dispatch tables — hub-and-spoke, per the cross-app rules.
--
-- A stage is NOT a load: a load is the physical truck-grouping (late, qc_passed
-- marks); a stage is the planned grouping (early). One stage ships as 1..N loads,
-- so loads roll UP into a stage.

CREATE TABLE IF NOT EXISTS public.fab_delivery_stages (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id            uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  stage_ref             text        NOT NULL,   -- stable cross-app ref (the Hub uses it as the parcel_ref)
  name                  text        NOT NULL,
  required_on_site_date date,
  sequence_no           integer     NOT NULL DEFAULT 1,  -- install build order
  note                  text        CHECK (note IS NULL OR char_length(note) <= 500),
  created_by            text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fab_job_id, stage_ref)
);
CREATE INDEX IF NOT EXISTS idx_fab_stages_job ON public.fab_delivery_stages (fab_job_id, sequence_no);

-- Membership: a piece belongs to at most one stage (delivers once).
ALTER TABLE public.fab_marks
  ADD COLUMN IF NOT EXISTS delivery_stage_id uuid REFERENCES public.fab_delivery_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fab_marks_stage ON public.fab_marks (delivery_stage_id) WHERE delivery_stage_id IS NOT NULL;

-- Loads roll up into a stage.
ALTER TABLE public.fab_dispatch_loads
  ADD COLUMN IF NOT EXISTS delivery_stage_id uuid REFERENCES public.fab_delivery_stages(id) ON DELETE SET NULL;

-- RLS: authenticated read, service_role write (standard fab pattern).
ALTER TABLE public.fab_delivery_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_delivery_stages_select_auth ON public.fab_delivery_stages;
CREATE POLICY fab_delivery_stages_select_auth ON public.fab_delivery_stages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fab_delivery_stages_all_service ON public.fab_delivery_stages;
CREATE POLICY fab_delivery_stages_all_service ON public.fab_delivery_stages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
