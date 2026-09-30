-- 017 — a variation or rework reaches fab even before fabrication has started,
-- and closing one tells the Hub.
--
-- WHY (30/09/2026 audit).
-- 1. The Hub fans a raised variation / rework out to POST /api/fab/ingest. fab
--    only wrote the `fab_tasks` row when a `fab_jobs` row already existed for
--    the job — otherwise it answered "ignored" and the work vanished. A
--    variation raised before the supervisor has pressed Start fabrication is
--    exactly when fab most needs to hear about it.
--    `fab_tasks.fab_job_id` was NOT NULL, so there was nowhere to put it. From
--    today a task may carry the job NUMBER (`quote_number`) instead, and sits in
--    a visible "waiting for a fab job" list until the job is started, when
--    POST /api/fab/jobs attaches it (sets fab_job_id).
--    Every task has one or the other — the CHECK below says so.
-- 2. Closing a variation/rework task told the Hub nothing. The close now STAMPS
--    `work_item_done_owed_at`; src/lib/work-item-done.ts sends the Hub
--    `work_item_done` and clears the stamp only once the Hub has taken it, so a
--    Hub that is down (or does not know the verb yet) is retried on the next
--    load of the Jobs list. A task the HUB closed (rework.resolved /
--    variation.status_changed) is never stamped: the Hub already knows.
--
-- Additive: nothing existing changes value. Every current row has a fab_job_id,
-- so the CHECK holds on the day it is added.

alter table public.fab_tasks alter column fab_job_id drop not null;

alter table public.fab_tasks add column if not exists quote_number text;
alter table public.fab_tasks add column if not exists work_item_done_owed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fab_tasks'::regclass and conname = 'fab_tasks_job_or_number'
  ) then
    alter table public.fab_tasks
      add constraint fab_tasks_job_or_number check (fab_job_id is not null or quote_number is not null);
  end if;
end $$;

comment on column public.fab_tasks.quote_number is
  'The job number, set on Hub variation/rework tasks. A task with quote_number and no fab_job_id is waiting for fabrication to start; POST /api/fab/jobs attaches it.';
comment on column public.fab_tasks.work_item_done_owed_at is
  'Set when a variation/rework task is closed in fab; cleared once the Hub has accepted work_item_done. NULL = nothing owed.';

create index if not exists idx_fab_tasks_waiting
  on public.fab_tasks (quote_number) where fab_job_id is null;
create index if not exists idx_fab_tasks_work_item_done_owed
  on public.fab_tasks (work_item_done_owed_at) where work_item_done_owed_at is not null;

-- rollback (only once no row has a null fab_job_id):
--   drop index if exists public.idx_fab_tasks_work_item_done_owed;
--   drop index if exists public.idx_fab_tasks_waiting;
--   alter table public.fab_tasks drop constraint if exists fab_tasks_job_or_number;
--   alter table public.fab_tasks drop column if exists work_item_done_owed_at;
--   alter table public.fab_tasks drop column if exists quote_number;
--   alter table public.fab_tasks alter column fab_job_id set not null;
