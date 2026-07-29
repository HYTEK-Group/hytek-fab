-- 013 — delivery-stage build order is unique per job.
--
-- fab_delivery_stages.sequence_no is the install build order the Hub mirrors onto
-- Troy's board. It was allocated read-then-insert (max+1) with no DB guarantee, so
-- two concurrent creates on the same job could land on the same number and the
-- board's build order for those two stages would flip between reloads.
--
-- Back the API's per-job numbering with a real unique index. The create/edit routes
-- catch the resulting 23505 (retry to the next free number on auto-create; clean 409
-- on an explicit collision). Idempotent; the table is new and empty so there are no
-- pre-existing duplicates to clean up first.

CREATE UNIQUE INDEX IF NOT EXISTS uq_fab_stages_job_seq
  ON public.fab_delivery_stages (fab_job_id, sequence_no);

-- The non-unique index 012 created on the same columns is now redundant — the
-- unique index above serves the identical (fab_job_id, sequence_no) and
-- (fab_job_id) prefix lookups. Drop it so we don't pay to maintain both.
DROP INDEX IF EXISTS public.idx_fab_stages_job;
