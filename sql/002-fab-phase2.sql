-- =====================================================================
-- HYTEK Fab — 002: Phase 2 (PIN kiosk, packages, QC, dispatch, progress)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkez.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS / DROP POLICY throughout.
-- Leaves fab_sub_packages and fab_treatment_batches untouched (no new writes).

-- ── fab_pins ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fab_pins (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text        NOT NULL,
  pin_hash    text        NOT NULL,
  role        text        NOT NULL DEFAULT 'fabricator'
                          CHECK (role IN ('admin','supervisor','fabricator')),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_pins_active ON public.fab_pins (is_active);

-- ── fab_dispatch_loads (created before fab_marks alter — FK target) ─────────
CREATE TABLE IF NOT EXISTS public.fab_dispatch_loads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id    uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  load_number   integer     NOT NULL,
  description   text,
  planned_date  date,
  dispatched_at timestamptz,
  driver        text,
  note          text        CHECK (note IS NULL OR char_length(note) <= 500),
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fab_job_id, load_number)
);
CREATE INDEX IF NOT EXISTS idx_fab_dispatch_job ON public.fab_dispatch_loads (fab_job_id);

-- ── fab_contractor_packages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fab_contractor_packages (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id           uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  package_type         text        NOT NULL DEFAULT 'fabrication'
                                   CHECK (package_type IN ('fabrication','treatment','other')),
  treatment_type       text        CHECK (treatment_type IN
                                     ('hdg','etch_primer','powder_coat','two_pack','other')),
  contractor_name      text        NOT NULL,
  contractor_contact   text,
  scope_note           text        CHECK (scope_note IS NULL OR char_length(scope_note) <= 500),
  sent_at              timestamptz,
  expected_return_date date,
  returned_at          timestamptz,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN
                                     ('pending','sent','in_progress','returned','inspected')),
  created_by           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_pkg_job ON public.fab_contractor_packages (fab_job_id);

-- ── fab_contractor_updates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fab_contractor_updates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   uuid        NOT NULL REFERENCES public.fab_contractor_packages(id) ON DELETE CASCADE,
  logged_at    date        NOT NULL DEFAULT CURRENT_DATE,
  note         text        NOT NULL CHECK (char_length(note) <= 500),
  reported_pct integer     CHECK (reported_pct BETWEEN 0 AND 100),
  eta          date,
  entered_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_pkg_updates_pkg ON public.fab_contractor_updates (package_id);

-- ── fab_qc_events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fab_qc_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id   uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  mark_id      uuid        NOT NULL REFERENCES public.fab_marks(id) ON DELETE CASCADE,
  inspected_by text        NOT NULL,
  result       text        NOT NULL CHECK (result IN ('pass','fail')),
  defect_note  text        CHECK (defect_note IS NULL OR char_length(defect_note) <= 500),
  rework_type  text        CHECK (rework_type IN ('inhouse','contractor')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_qc_job  ON public.fab_qc_events (fab_job_id);
CREATE INDEX IF NOT EXISTS idx_fab_qc_mark ON public.fab_qc_events (mark_id);

-- ── fab_marks additions ────────────────────────────────────────────────────
ALTER TABLE public.fab_marks
  ADD COLUMN IF NOT EXISTS contractor_package_id uuid REFERENCES public.fab_contractor_packages(id),
  ADD COLUMN IF NOT EXISTS assigned_to           text,
  ADD COLUMN IF NOT EXISTS rework_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_note           text,
  ADD COLUMN IF NOT EXISTS dispatch_load_id      uuid REFERENCES public.fab_dispatch_loads(id);

CREATE INDEX IF NOT EXISTS idx_fab_marks_pkg      ON public.fab_marks (contractor_package_id);
CREATE INDEX IF NOT EXISTS idx_fab_marks_load     ON public.fab_marks (dispatch_load_id);
CREATE INDEX IF NOT EXISTS idx_fab_marks_assigned ON public.fab_marks (assigned_to);

-- Update status CHECK: drop old, add qc_passed/at_contractor, drop at_treatment.
ALTER TABLE public.fab_marks DROP CONSTRAINT IF EXISTS fab_marks_status_check;
-- Migrate any legacy rows before re-adding the constraint.
UPDATE public.fab_marks SET status = 'at_contractor' WHERE status = 'at_treatment';
ALTER TABLE public.fab_marks
  ADD CONSTRAINT fab_marks_status_check CHECK (status IN
    ('not_started','in_progress','done','at_contractor','returned','qc_passed'));

-- ── flow_fab_progress (Hub feed) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_fab_progress (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id           uuid        NOT NULL REFERENCES public.fab_jobs(id),
  quote_number         text        NOT NULL,
  hubspot_deal_id      text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  total_marks          integer     NOT NULL DEFAULT 0,
  marks_qc_passed      integer     NOT NULL DEFAULT 0,
  marks_dispatched     integer     NOT NULL DEFAULT 0,
  pct_complete         integer     NOT NULL DEFAULT 0,
  inhouse_total        integer     NOT NULL DEFAULT 0,
  inhouse_complete     integer     NOT NULL DEFAULT 0,
  rework_total         integer     NOT NULL DEFAULT 0,
  contractor_packages  jsonb       NOT NULL DEFAULT '[]',
  dispatch_loads       jsonb       NOT NULL DEFAULT '[]',
  narrative            text        NOT NULL DEFAULT '',
  status               text        NOT NULL DEFAULT 'in_progress'
                                   CHECK (status IN
                                     ('in_progress','complete','dispatch_ready','dispatched')),
  UNIQUE (fab_job_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_fab_progress_quote ON public.flow_fab_progress (quote_number);
CREATE INDEX IF NOT EXISTS idx_flow_fab_progress_deal  ON public.flow_fab_progress (hubspot_deal_id);

-- ── RLS: authenticated SELECT, service_role ALL ────────────────────────────
DO $$ DECLARE tbl text;
BEGIN
  FOR tbl IN VALUES
    ('fab_pins'),('fab_contractor_packages'),('fab_contractor_updates'),
    ('fab_qc_events'),('fab_dispatch_loads'),('flow_fab_progress')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_auth', tbl);
    EXECUTE format(
      $p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)$p$,
      tbl || '_select_auth', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_all_service', tbl);
    EXECUTE format(
      $p$CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)$p$,
      tbl || '_all_service', tbl);
  END LOOP;
END $$;

-- fab_pins: harden — authenticated cannot read pin_hash via PostgREST.
-- Revoke direct SELECT; all PIN reads go through the service-role API only.
REVOKE SELECT ON public.fab_pins FROM authenticated;
DROP POLICY IF EXISTS fab_pins_select_auth ON public.fab_pins;

NOTIFY pgrst, 'reload schema';
