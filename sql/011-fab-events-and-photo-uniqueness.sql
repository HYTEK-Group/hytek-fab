-- =====================================================================
-- HYTEK Fab — 011: audit events + DB-enforced photo uniqueness (review fixes)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez). Apply under the gqtikz
-- coordination_lock. Idempotent, additive/tightening.
--
-- (1) fab_events — an append-only audit log. First use: the supervisor's
--     "dispatch override" (releasing steel that isn't fully photographed, with a
--     logged reason). Foundation for the wider gatekeeper controls (W4).
-- (2) Make the proof-photo de-dup DB-ENFORCED: swap the plain index for a
--     partial UNIQUE index, so the check-then-insert race can't slip a duplicate
--     through — the DB itself is the backstop.

-- ── (1) append-only audit events ─────────────────────────────────────────────
-- fab_job_id is a plain uuid (NO FK) so the immutable audit survives a job
-- delete and the append-only trigger never fights a cascade.
CREATE TABLE IF NOT EXISTS public.fab_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id uuid,
  kind       text        NOT NULL,
  actor      text        NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_events_job ON public.fab_events (fab_job_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fab_events_no_mutate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fab_events is append-only (audit log)';
END $$;
DROP TRIGGER IF EXISTS fab_events_lock ON public.fab_events;
CREATE TRIGGER fab_events_lock
  BEFORE UPDATE OR DELETE ON public.fab_events
  FOR EACH ROW EXECUTE FUNCTION public.fab_events_no_mutate();
DROP TRIGGER IF EXISTS fab_events_no_truncate ON public.fab_events;
CREATE TRIGGER fab_events_no_truncate
  BEFORE TRUNCATE ON public.fab_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.fab_events_no_mutate();

ALTER TABLE public.fab_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_events_select_auth ON public.fab_events;
CREATE POLICY fab_events_select_auth ON public.fab_events
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fab_events_all_service ON public.fab_events;
CREATE POLICY fab_events_all_service ON public.fab_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── (2) DB-enforced photo de-dup ─────────────────────────────────────────────
-- Existing rows have image_sha256 NULL (excluded by the partial predicate), and
-- no duplicate hashes exist yet, so the unique index builds cleanly.
DROP INDEX IF EXISTS public.idx_fab_proof_sha;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fab_proof_sha
  ON public.fab_proof_photos (fab_job_id, image_sha256)
  WHERE image_sha256 IS NOT NULL;

NOTIFY pgrst, 'reload schema';
