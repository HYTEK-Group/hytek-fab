-- =====================================================================
-- HYTEK Fab — 008: subcontractor app (scoped guest access + certs + drop-ship)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkez.
-- CLAIM THE DB LOCK (worklog) + tell the team before applying.
--
-- Idempotent. Additive only. Two new tables + one evidence-locked certs table
-- + four columns on fab_contractor_packages + one new fab_marks status.
--
-- The subcontractor app is a scoped "guest pass" over the existing fab backend:
-- a sub firm gets ONE login (fab_sub_accounts), explicit per-package grants
-- (fab_sub_grants), and its photos land in the SAME fab_proof_photos evidence
-- chain as Brisbane-made steel. QA/mill certs get their own append-only,
-- evidence-locked table so drop-ship steel carries tamper-proof paperwork.

-- ── fab_sub_accounts: one row per subcontractor firm login ────────────────────
-- login_slug is the unguessable URL token in the invite link (fab.../sub/<slug>);
-- pin_hash (bcrypt) is set ONCE by the sub on first open, null until then.
CREATE TABLE IF NOT EXISTS public.fab_sub_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_name text        NOT NULL,
  login_slug      text        NOT NULL UNIQUE,
  pin_hash        text,       -- null until the sub sets a PIN (one-shot)
  is_active       boolean     NOT NULL DEFAULT true,
  created_by      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_sub_accounts_slug
  ON public.fab_sub_accounts (login_slug) WHERE is_active;

-- ── fab_sub_grants: explicit allow-list — which packages a sub may touch ──────
-- Revocation = stamp revoked_at (history preserved, access dies instantly
-- because the API re-expands live grants on every request).
CREATE TABLE IF NOT EXISTS public.fab_sub_grants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account_id uuid        NOT NULL REFERENCES public.fab_sub_accounts(id)        ON DELETE CASCADE,
  package_id     uuid        NOT NULL REFERENCES public.fab_contractor_packages(id) ON DELETE CASCADE,
  granted_by     text        NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  UNIQUE (sub_account_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_fab_sub_grants_account ON public.fab_sub_grants (sub_account_id);
CREATE INDEX IF NOT EXISTS idx_fab_sub_grants_package ON public.fab_sub_grants (package_id);

-- ── fab_package_certs: QA / ITP / mill / weld / coating certificates ──────────
-- Same evidence philosophy as fab_proof_photos: append-only, tamper-locked.
-- Required before drop-ship steel (which never sees in-house QC) can dispatch.
CREATE TABLE IF NOT EXISTS public.fab_package_certs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_package_id uuid        NOT NULL REFERENCES public.fab_contractor_packages(id) ON DELETE CASCADE,
  fab_job_id     uuid        NOT NULL REFERENCES public.fab_jobs(id)                ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN
                             ('qa','weld','mill','coating','itp','other')),
  storage_path   text        NOT NULL,   -- path inside the fab-proof bucket (certs/ prefix)
  file_name      text,
  note           text        CHECK (note IS NULL OR char_length(note) <= 500),
  uploaded_by    text        NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_certs_package ON public.fab_package_certs (fab_package_id);
CREATE INDEX IF NOT EXISTS idx_fab_certs_job     ON public.fab_package_certs (fab_job_id);

-- Evidence lock: append-only. No UPDATE / DELETE (correct by adding).
CREATE OR REPLACE FUNCTION public.fab_package_certs_no_mutate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fab_package_certs is append-only (evidence lock) — add a correcting certificate instead of editing/deleting';
END $$;

DROP TRIGGER IF EXISTS fab_package_certs_lock ON public.fab_package_certs;
CREATE TRIGGER fab_package_certs_lock
  BEFORE UPDATE OR DELETE ON public.fab_package_certs
  FOR EACH ROW EXECUTE FUNCTION public.fab_package_certs_no_mutate();

-- TRUNCATE does not fire row-level triggers, so guard it too (statement-level).
DROP TRIGGER IF EXISTS fab_package_certs_no_truncate ON public.fab_package_certs;
CREATE TRIGGER fab_package_certs_no_truncate
  BEFORE TRUNCATE ON public.fab_package_certs
  FOR EACH STATEMENT EXECUTE FUNCTION public.fab_package_certs_no_mutate();

-- ── fab_contractor_packages: delivery mode + sub readiness + drop-ship release ─
ALTER TABLE public.fab_contractor_packages
  ADD COLUMN IF NOT EXISTS delivery_mode          text NOT NULL DEFAULT 'return_to_brisbane',
  ADD COLUMN IF NOT EXISTS ready_at               timestamptz,  -- sub tapped "ready to collect"
  ADD COLUMN IF NOT EXISTS drop_ship_released_at  timestamptz,  -- supervisor accepted drop-ship
  ADD COLUMN IF NOT EXISTS drop_ship_released_by  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fab_pkg_delivery_mode_check'
      AND conrelid = 'public.fab_contractor_packages'::regclass
  ) THEN
    ALTER TABLE public.fab_contractor_packages
      ADD CONSTRAINT fab_pkg_delivery_mode_check
      CHECK (delivery_mode IN ('return_to_brisbane','drop_ship'));
  END IF;
END $$;

-- ── fab_marks: new status 'sub_certified' ─────────────────────────────────────
-- Drop-ship steel never sees in-house QC, so it must NOT be stamped 'qc_passed'
-- (that would lie). 'sub_certified' = sub certs attached + supervisor accepted;
-- the dispatch feed treats it as dispatch-ready alongside 'qc_passed'.
DO $$
DECLARE
  con text;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'public.fab_marks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%not_started%';
  IF con IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fab_marks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%sub_certified%'
  ) THEN
    EXECUTE format('ALTER TABLE public.fab_marks DROP CONSTRAINT %I', con);
    ALTER TABLE public.fab_marks
      ADD CONSTRAINT fab_marks_status_check
      CHECK (status IN ('not_started','in_progress','done','at_contractor',
                        'returned','qc_passed','sub_certified'));
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- fab_sub_accounts holds pin_hash → service-role ONLY (mirror fab_pins: no
-- authenticated read; the browser never queries this table directly).
ALTER TABLE public.fab_sub_accounts ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.fab_sub_accounts FROM authenticated;
REVOKE SELECT ON public.fab_sub_accounts FROM anon;
DROP POLICY IF EXISTS fab_sub_accounts_all_service ON public.fab_sub_accounts;
CREATE POLICY fab_sub_accounts_all_service ON public.fab_sub_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- fab_sub_grants: service-role only too (all access is via API routes).
ALTER TABLE public.fab_sub_grants ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.fab_sub_grants FROM authenticated;
REVOKE SELECT ON public.fab_sub_grants FROM anon;
DROP POLICY IF EXISTS fab_sub_grants_all_service ON public.fab_sub_grants;
CREATE POLICY fab_sub_grants_all_service ON public.fab_sub_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- fab_package_certs: authenticated read (office UI), service_role writes.
ALTER TABLE public.fab_package_certs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_package_certs_select_auth ON public.fab_package_certs;
CREATE POLICY fab_package_certs_select_auth ON public.fab_package_certs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fab_package_certs_all_service ON public.fab_package_certs;
CREATE POLICY fab_package_certs_all_service ON public.fab_package_certs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
