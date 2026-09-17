-- 016 — let role app_fab write shop drawings into the fab-drawings bucket.
--
-- WHY.
-- The office-server ingest bridge (scripts/ss-ingest-bridge.mjs) used to upload
-- every shop drawing PDF straight into storage bucket `fab-drawings` with a
-- service-role key. Lane 7 CP4 (07/09/2026) took that key off the bridge and
-- sent drawings to POST /api/fab/jobs/[id]/drawings instead, but the POST was
-- never written, so every drawing got 405. The handler now exists (17/09/2026)
-- and uploads `{quote_number}/{file name}` with upsert, as fab's own role —
-- or, for drawings over Vercel's 4.5 MB body limit, mints a signed upload URL
-- (upsert) for that path as fab's own role, which needs the same two rights.
--
-- hytek-brain/sql/migrations/004-storage-roles-shared.sql (D27) gave app_fab
-- fab-drawings READ only, because at the time "the drawings arrive from the
-- drive sync". An upsert needs INSERT and UPDATE as well (SELECT is already
-- there, from 004's app_fab_storage_select). Without this, the moment fab runs
-- on its role key every upload is refused by row-level security.
--
-- WHAT. Two new policies, scoped to the one bucket, named apart from 004's so
-- this file never rewrites a policy another repo's migration owns. Permissive
-- policies add together, so app_fab_storage_insert (fab-proof) is untouched.
-- No delete: fab never removes a drawing. Nothing is dropped or deleted.
--
-- The grants repeat 004's for app_fab only, so this file stands on its own on
-- a database where 004 has not yet run. They are idempotent.

grant usage on schema storage to app_fab;
grant select on storage.buckets to app_fab;
grant select, insert, update on storage.objects to app_fab;

drop policy if exists app_fab_drawings_insert on storage.objects;
create policy app_fab_drawings_insert on storage.objects for insert to app_fab
  with check (bucket_id = 'fab-drawings');

drop policy if exists app_fab_drawings_update on storage.objects;
create policy app_fab_drawings_update on storage.objects for update to app_fab
  using (bucket_id = 'fab-drawings')
  with check (bucket_id = 'fab-drawings');

-- rollback (removes only what this file added; the grants belong to 004 too):
--   drop policy if exists app_fab_drawings_insert on storage.objects;
--   drop policy if exists app_fab_drawings_update on storage.objects;
