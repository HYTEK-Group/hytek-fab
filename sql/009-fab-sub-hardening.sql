-- =====================================================================
-- HYTEK Fab — 009: subcontractor hardening (review fixes)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first.
-- CLAIM THE DB LOCK (worklog) + tell the team before applying.
-- Idempotent. Additive/tightening only.
--
-- Two fixes from the adversarial review:
--  (2) fab_package_certs was readable by EVERY authenticated user on the shared
--      gqtikz project (incl. dispatchers of other apps) via USING(true). The
--      fab app only ever reads it through service-role API routes, so lock it
--      to service-role only — mirror fab_sub_accounts / fab_sub_grants.
--  (1) Per-account brute-force lockout for the subcontractor PIN login. Per-IP
--      throttling can't protect a targeted account (subs sign in from arbitrary
--      phones/IPs, and XFF is spoofable), so we count failures per sub account.

-- ── (2) fab_package_certs → service-role read only ────────────────────────────
DROP POLICY IF EXISTS fab_package_certs_select_auth ON public.fab_package_certs;
REVOKE SELECT ON public.fab_package_certs FROM authenticated;
REVOKE SELECT ON public.fab_package_certs FROM anon;
-- (the service_role FOR ALL policy from 008 stays; office reads go through it)

-- ── (1) per-account login attempts (brute-force lockout) ──────────────────────
CREATE TABLE IF NOT EXISTS public.fab_sub_login_attempts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account_id uuid        NOT NULL REFERENCES public.fab_sub_accounts(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fab_sub_login_attempts_acct_time
  ON public.fab_sub_login_attempts (sub_account_id, created_at DESC);

-- service-role only (all access via API routes; never a browser read)
ALTER TABLE public.fab_sub_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.fab_sub_login_attempts FROM authenticated;
REVOKE SELECT ON public.fab_sub_login_attempts FROM anon;
DROP POLICY IF EXISTS fab_sub_login_attempts_all_service ON public.fab_sub_login_attempts;
CREATE POLICY fab_sub_login_attempts_all_service ON public.fab_sub_login_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
