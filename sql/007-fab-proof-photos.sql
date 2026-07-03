-- =====================================================================
-- HYTEK Fab — 007: proof-of-work photo chain (made → coating → bundle → load)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkez.
-- CLAIM THE DB LOCK (worklog) + tell the team before applying.
--
-- Idempotent. Additive only. New table + private storage bucket.
--
-- One append-only, EVIDENCE-LOCKED photo log for the whole fab proof chain, so
-- the dispatcher (and the customer) can see every piece was made, went to/came
-- back from coating, was bundled, and was loaded — landing beside the dispatch
-- app's existing delivery photos. Mirrors the dispatch evidence-lock pattern:
-- a wrong photo is corrected by ADDING a new one, never edited or deleted.

CREATE TABLE IF NOT EXISTS public.fab_proof_photos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id     uuid        NOT NULL REFERENCES public.fab_jobs(id) ON DELETE CASCADE,
  fab_mark_id    uuid        REFERENCES public.fab_marks(id)               ON DELETE SET NULL,
  fab_package_id uuid        REFERENCES public.fab_contractor_packages(id) ON DELETE SET NULL,
  fab_load_id    uuid        REFERENCES public.fab_dispatch_loads(id)      ON DELETE SET NULL,
  stage          text        NOT NULL CHECK (stage IN
                             ('made','treatment_out','treatment_in','bundled','loaded')),
  treatment_type text,       -- copied from the package when stage is a coating leg
  storage_path   text        NOT NULL,   -- path inside the fab-proof bucket
  file_name      text,
  caption        text,
  taken_by       text        NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_proof_job   ON public.fab_proof_photos (fab_job_id);
CREATE INDEX IF NOT EXISTS idx_fab_proof_mark  ON public.fab_proof_photos (fab_mark_id);
CREATE INDEX IF NOT EXISTS idx_fab_proof_load  ON public.fab_proof_photos (fab_load_id);
CREATE INDEX IF NOT EXISTS idx_fab_proof_stage ON public.fab_proof_photos (stage);

-- ── Evidence lock: append-only. No UPDATE / DELETE (correct by adding). ───────
CREATE OR REPLACE FUNCTION public.fab_proof_photos_no_mutate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fab_proof_photos is append-only (evidence lock) — add a correcting photo instead of editing/deleting';
END $$;

DROP TRIGGER IF EXISTS fab_proof_photos_lock ON public.fab_proof_photos;
CREATE TRIGGER fab_proof_photos_lock
  BEFORE UPDATE OR DELETE ON public.fab_proof_photos
  FOR EACH ROW EXECUTE FUNCTION public.fab_proof_photos_no_mutate();

-- TRUNCATE does not fire row-level triggers, so guard it too (statement-level) —
-- otherwise the service role could wipe the whole evidence log. Same as dispatch.
DROP TRIGGER IF EXISTS fab_proof_photos_no_truncate ON public.fab_proof_photos;
CREATE TRIGGER fab_proof_photos_no_truncate
  BEFORE TRUNCATE ON public.fab_proof_photos
  FOR EACH STATEMENT EXECUTE FUNCTION public.fab_proof_photos_no_mutate();

-- ── RLS: authenticated read; service_role writes (API routes). ────────────────
ALTER TABLE public.fab_proof_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_proof_photos_select_auth ON public.fab_proof_photos;
CREATE POLICY fab_proof_photos_select_auth ON public.fab_proof_photos
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fab_proof_photos_all_service ON public.fab_proof_photos;
CREATE POLICY fab_proof_photos_all_service ON public.fab_proof_photos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Private storage bucket for the proof photos ───────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('fab-proof', 'fab-proof', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
