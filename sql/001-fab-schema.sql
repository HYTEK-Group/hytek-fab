-- =====================================================================
-- HYTEK Fab — 001: initial fab schema
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- to confirm the project ref in the URL matches gqtikzguvhukpujyxkez.
--
-- HELD: do not apply without Scott's sign-off (one person on the DB at a time).
-- Status: HELD — see README "Database schema: HELD for Scott".
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.

-- ── fab_jobs ──────────────────────────────────────────────────────────────
-- Created when supervisor hits "Start fabrication" from the ready queue.
-- Keyed on quote_number (universal job key) + hubspot_deal_id for Hub lookups.

CREATE TABLE IF NOT EXISTS public.fab_jobs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number         text        NOT NULL,
  hubspot_deal_id      text,
  name                 text        NOT NULL,
  client               text,
  on_site_date         date,
  cc_level             text        CHECK (cc_level IN ('CC1','CC2','CC3','CC4')),
  status               text        NOT NULL DEFAULT 'in_progress'
                                   CHECK (status IN ('in_progress','complete','dispatched')),
  fab_complete_at      timestamptz,
  dispatch_requested_at timestamptz,
  compliance_mode      text        NOT NULL DEFAULT 'permissive'
                                   CHECK (compliance_mode IN ('permissive','enforced')),
  started_by           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_number)
);

CREATE INDEX IF NOT EXISTS idx_fab_jobs_quote ON public.fab_jobs (quote_number);
CREATE INDEX IF NOT EXISTS idx_fab_jobs_deal  ON public.fab_jobs (hubspot_deal_id);

-- ── fab_tasks ─────────────────────────────────────────────────────────────
-- Free-form tasks written by supervisor. No fixed phases.

CREATE TABLE IF NOT EXISTS public.fab_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id   uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  description  text        NOT NULL,
  assigned_to  text,
  status       text        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','in_progress','done')),
  created_by   text        NOT NULL,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_tasks_job ON public.fab_tasks (fab_job_id);

-- ── fab_marks ─────────────────────────────────────────────────────────────
-- Individual steel members. Populated from Tekla assembly list (v1: manual or
-- xlsx upload). mark_id is the fabricator's label (e.g. 'A1', 'B3', 'C12').

CREATE TABLE IF NOT EXISTS public.fab_marks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id  uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  mark_id     text        NOT NULL,
  description text,
  section     text,
  length_mm   integer,
  weight_kg   numeric,
  quantity    integer     NOT NULL DEFAULT 1,
  status      text        NOT NULL DEFAULT 'not_started'
                          CHECK (status IN
                            ('not_started','in_progress','done','at_treatment','returned')),
  note        text        CHECK (note IS NULL OR char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fab_job_id, mark_id)
);

CREATE INDEX IF NOT EXISTS idx_fab_marks_job ON public.fab_marks (fab_job_id);

-- ── fab_time_entries ──────────────────────────────────────────────────────
-- Worker hours logged against a job (not a task — keeps it simple).

CREATE TABLE IF NOT EXISTS public.fab_time_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id  uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  worker_name text        NOT NULL,
  hours       numeric     NOT NULL CHECK (hours > 0),
  work_date   date        NOT NULL DEFAULT CURRENT_DATE,
  note        text        CHECK (note IS NULL OR char_length(note) <= 500),
  entered_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_time_job ON public.fab_time_entries (fab_job_id);

-- ── fab_weekly_entries ────────────────────────────────────────────────────
-- Per-job weekly tonnes (fab's own record).
-- When submitted, the API ALSO writes the week's TOTAL to flow_fab_entries
-- (Hub's existing SS tonnes feed — unchanged schema, unchanged reader).

CREATE TABLE IF NOT EXISTS public.fab_weekly_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id   uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  quote_number text        NOT NULL,
  week_start   date        NOT NULL CHECK (EXTRACT(isodow FROM week_start) = 1),
  tonnes       numeric     NOT NULL CHECK (tonnes >= 0),
  hours        numeric     CHECK (hours IS NULL OR hours >= 0),
  note         text        CHECK (note IS NULL OR char_length(note) <= 500),
  entered_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_weekly_job  ON public.fab_weekly_entries (fab_job_id);
CREATE INDEX IF NOT EXISTS idx_fab_weekly_week ON public.fab_weekly_entries (week_start DESC);

-- ── fab_sub_packages ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fab_sub_packages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  supplier   text,
  status     text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN
                           ('pending','ordered','in_progress','delivered','complete')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── fab_treatment_batches ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fab_treatment_batches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id     uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  batch_name     text        NOT NULL,
  treatment_type text        NOT NULL
                             CHECK (treatment_type IN
                               ('hdg','etch_primer','powder_coat','two_pack','other')),
  supplier       text,
  status         text        NOT NULL DEFAULT 'preparing'
                             CHECK (status IN
                               ('preparing','dispatched','at_plant','returned','inspected')),
  dispatched_at  timestamptz,
  returned_at    timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fab_treatment_batch_marks (
  batch_id uuid NOT NULL REFERENCES public.fab_treatment_batches(id) ON DELETE CASCADE,
  mark_id  uuid NOT NULL REFERENCES public.fab_marks(id)             ON DELETE CASCADE,
  PRIMARY KEY (batch_id, mark_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Service role handles all writes (API routes use service-role key).
-- Authenticated users can read. Anon gets nothing.

DO $$ DECLARE
  tbl text;
BEGIN
  FOR tbl IN VALUES
    ('fab_jobs'),('fab_tasks'),('fab_marks'),('fab_time_entries'),
    ('fab_weekly_entries'),('fab_sub_packages'),
    ('fab_treatment_batches'),('fab_treatment_batch_marks')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      tbl || '_select_auth', tbl
    );
    EXECUTE format(
      $p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)$p$,
      tbl || '_select_auth', tbl
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      tbl || '_all_service', tbl
    );
    EXECUTE format(
      $p$CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)$p$,
      tbl || '_all_service', tbl
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
