-- Lane 7 CP3 — fab_ready_queue, and the two fab_tasks columns that were never in git.
--
-- WHY A QUEUE TABLE AT ALL.
-- GET /api/fab/ready-queue read the shared `jobs` table (latest 200), subtracted
-- what fab already had, and then asked the Hub `GET /api/flow/job-state/_` ONCE
-- PER CANDIDATE, sequentially, up to fifty times — on every page load, for every
-- supervisor, all day. Fifty round trips to answer "what may I start?" is not a
-- performance note; it is the Hub carrying fab's homework, and it fails whole
-- when the Hub is slow. The outbox already knows the answer the moment it
-- happens, so fab keeps its own small table and the Hub pushes into it.
--
-- WHY THE `fab_tasks` ALTERs ARE IN THE SAME FILE.
-- fab owns `fab_tasks` (SYSTEM.md). Its CREATE lives in sql/001-fab-schema.sql
-- and lists nine columns. The live database — measured on the SHARED staging
-- clone lvjxqygftugmcadstpff on 07/09/2026 — has THIRTEEN: `estimated_hours`,
-- `due_on`, `rework_id` and `variation_id` were added by hand and exist in no
-- repo's sql/. The Hub has been inserting `rework_id` / `variation_id` from
-- lib/flow/signals/apply-rework-variation.ts, whose own comment hedges "a
-- missing column (sql/16 not yet applied) … is logged and the next dept's
-- update still runs" — i.e. the Hub was written not knowing whether the columns
-- it writes exist. They do. Root CLAUDE.md rule 6 says the CREATE for a table
-- you own lives in your sql/, so they are recorded here, idempotently, before
-- fab's own ingest door starts writing them in Lane 3 CP5.
--
-- rollback: at the bottom.

-- ── the queue ───────────────────────────────────────────────────────────────
-- One row per job the Hub has told fab about. NOT a copy of `jobs`: it holds
-- only the two facts that decide whether fab may start (an SS release, and
-- materials in), plus the identity needed to join back. Names, clients and
-- locations still come from `jobs` at read time, so this table can never
-- disagree with the Hub about what a job is called.
create table if not exists public.fab_ready_queue (
  quote_number          text primary key,
  hubspot_deal_id       text,
  -- job.released, payload.stream = 'SS'. LWS releases are answered 200/ignored.
  ss_release_version    integer,
  ss_released_at        timestamptz,
  ss_released_by        text,
  -- materials.received (hub_outbox verb, migration 051 on SHARED).
  materials_received    boolean not null default false,
  materials_received_at timestamptz,
  on_site_date          date,
  -- The occurred_at of the newest event applied to this row. An event older
  -- than this is a no-op: the outbox retries, and a retry that arrives after a
  -- newer fact must not undo it.
  last_event_at         timestamptz not null default now(),
  -- Stamped when a fab_jobs row exists for this quote. The row stays for the
  -- audit trail; it just leaves the queue.
  consumed_at           timestamptz,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now()
);

comment on table public.fab_ready_queue is
  'Lane 7 CP3. What the Hub has told fab is ready to fabricate, pushed through POST /api/fab/ingest. Written by fab only.';

-- The read the queue screen does: unconsumed, real jobs, newest first.
create index if not exists idx_fab_ready_queue_open
  on public.fab_ready_queue (last_event_at desc)
  where consumed_at is null and is_test = false;

alter table public.fab_ready_queue enable row level security;
-- No policies: the browser never reads this. Every read is server-side through
-- src/app/api/fab/** with fab's own client, like every other fab table.
revoke all on public.fab_ready_queue from anon, authenticated;

-- ── fab_tasks: record what is already there ─────────────────────────────────
-- `if not exists` throughout — these columns exist on production and on the
-- staging clone. This file makes git agree with the database; it does not
-- change the database.
alter table public.fab_tasks add column if not exists estimated_hours numeric;
alter table public.fab_tasks add column if not exists due_on date;
alter table public.fab_tasks add column if not exists rework_id uuid;
alter table public.fab_tasks add column if not exists variation_id uuid;

-- The Hub's closure loop filters on these two columns
-- (apply-rework-variation.ts closeDeptWorkItems / reopenDeptWorkItems), and
-- fab's own ingest door will do the same from Lane 3 CP5. Partial indexes: the
-- overwhelming majority of fab_tasks are ordinary shop-floor tasks with both
-- columns null.
create index if not exists idx_fab_tasks_rework on public.fab_tasks (rework_id) where rework_id is not null;
create index if not exists idx_fab_tasks_variation on public.fab_tasks (variation_id) where variation_id is not null;

-- rollback:
--   drop index if exists public.idx_fab_tasks_variation;
--   drop index if exists public.idx_fab_tasks_rework;
--   -- the four fab_tasks columns are NOT dropped on rollback: they predate this
--   -- file and hold live Hub-written data.
--   drop table if exists public.fab_ready_queue;
