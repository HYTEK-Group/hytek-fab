-- =====================================================================
-- HYTEK Fab — 003: PIN brute-force lockout
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkez.
--
-- Idempotent. Records each PIN-verify attempt per client IP so the public
-- /api/fab/pin/verify endpoint can lock out brute-force enumeration.

CREATE TABLE IF NOT EXISTS public.fab_pin_attempts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip         text        NOT NULL,
  success    boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fab_pin_attempts_ip_time
  ON public.fab_pin_attempts (ip, created_at DESC);

-- Service-role only: the table holds client IPs and is never read by the browser.
ALTER TABLE public.fab_pin_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_pin_attempts_all_service ON public.fab_pin_attempts;
CREATE POLICY fab_pin_attempts_all_service ON public.fab_pin_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
