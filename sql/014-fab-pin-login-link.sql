-- 014 — link a kiosk PIN to a Supabase login (closes the gatekeeper four-eyes gap).
--
-- The four-eyes control (W4) compares WHO raised an exception with WHO clears it.
-- People act in two identity namespaces — a Supabase login (office PC) and a
-- shared-tablet kiosk PIN — with no link between them, so the same human could
-- raise under their PIN and "clear" under their login. Give a PIN an optional
-- link to its owner's profile: when set, the kiosk token carries that profile id
-- and the person's kiosk actions get the SAME identity key as their login, so the
-- four-eyes check catches a self-clear by key (not just by name).
--
-- Additive + nullable — floor crew whose PIN has no login stay pin:<worker_name>
-- (unchanged). Idempotent.

ALTER TABLE public.fab_pins
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
