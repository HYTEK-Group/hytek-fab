-- =====================================================================
-- HYTEK Fab — 004: SS ingest from detailing (Tekla IFF reports)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkey)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkey.
--
-- Idempotent. Additive only. Scoped to fab_* / flow_fab_progress / job_bom.

-- ── fab_marks: import provenance ────────────────────────────────────────────
ALTER TABLE public.fab_marks
  ADD COLUMN IF NOT EXISTS source          text,     -- 'manual' | 'auto' | null (hand-created)
  ADD COLUMN IF NOT EXISTS source_issue    integer,  -- release/issue version it came from
  ADD COLUMN IF NOT EXISTS source_file     text,
  ADD COLUMN IF NOT EXISTS source_hash     text,
  ADD COLUMN IF NOT EXISTS manually_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cut_length_mm   integer,
  ADD COLUMN IF NOT EXISTS coating         text;     -- Tekla "Assembly Coating" (drives treatment later)

-- ── fab_import_batches: one row per imported report set (audit + re-issue) ───
CREATE TABLE IF NOT EXISTS public.fab_import_batches (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id    uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  quote_number  text        NOT NULL,
  stream        text        NOT NULL DEFAULT 'SS' CHECK (stream IN ('SS','LWS')),
  issue_version integer     NOT NULL DEFAULT 1,
  block         text,
  source_file   text,
  source_hash   text,
  parsed_marks  integer     NOT NULL DEFAULT 0,
  total_kg      numeric     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'applied'
                            CHECK (status IN ('pending_review','applied','superseded')),
  imported_by   text        NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_import_batches_job ON public.fab_import_batches (fab_job_id);

-- ── job_bom: bill of materials from the Tekla material lists (PURCHASING reads) ─
CREATE TABLE IF NOT EXISTS public.job_bom (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number    text        NOT NULL,
  hubspot_deal_id text,
  issue_version   integer     NOT NULL DEFAULT 1,
  category        text        NOT NULL CHECK (category IN
                              ('section','plate','bolt','chemset','loose','misc')),
  part_mark       text,
  profile         text,       -- e.g. PFC150*75, FL10*150, bolt dia/grade
  grade           text,
  length_mm       integer,
  qty             numeric,
  weight_kg       numeric,
  from_stock      boolean,
  from_order      boolean,
  source_file     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_bom_quote ON public.job_bom (quote_number);
CREATE INDEX IF NOT EXISTS idx_job_bom_deal  ON public.job_bom (hubspot_deal_id);

-- ── flow_fab_progress: tonnes (the Hub's open "Part A" — auto-upgrades to tonnes) ─
ALTER TABLE public.flow_fab_progress
  ADD COLUMN IF NOT EXISTS tonnes_total    numeric,
  ADD COLUMN IF NOT EXISTS tonnes_complete numeric;

-- ── RLS: authenticated SELECT, service_role ALL (new tables) ─────────────────
DO $$ DECLARE tbl text;
BEGIN
  FOR tbl IN VALUES ('fab_import_batches'),('job_bom')
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

NOTIFY pgrst, 'reload schema';
