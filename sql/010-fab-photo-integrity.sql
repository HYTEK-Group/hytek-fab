-- =====================================================================
-- HYTEK Fab — 010: photo integrity (anti-fraud de-dup)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez). Apply by hand (Management
-- API ok) under the gqtikz coordination_lock. Idempotent, additive.
--
-- A server-computed SHA-256 of each proof image. The upload routes reject an
-- EXACT image already used on the same job — closing the lazy "photograph one
-- piece, reuse the shot for five marks" re-use. HONEST SCOPE: exact-byte only —
-- it does not resist a 1-byte alteration and is a presence/tamper check, not
-- proof the photo is of the right piece. sql/011 makes it DB-enforced (unique).

ALTER TABLE public.fab_proof_photos
  ADD COLUMN IF NOT EXISTS image_sha256 text;

-- Fast "has this exact image already been used on this job?" lookup.
CREATE INDEX IF NOT EXISTS idx_fab_proof_sha
  ON public.fab_proof_photos (fab_job_id, image_sha256)
  WHERE image_sha256 IS NOT NULL;

NOTIFY pgrst, 'reload schema';
