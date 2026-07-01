-- =====================================================================
-- HYTEK Fab — 006: per-assembly assignment, time, and drawing link
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkez)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkez.
-- CLAIM THE DB LOCK (worklog) + tell the team before applying.
--
-- Idempotent. Additive only. Scoped to fab_marks.
--
-- The assembly (mark) becomes the unit of work: the supervisor assigns a
-- worker + an allotted time to each assembly (assigned_to already exists),
-- the floor captures the actual time via Start/Done, and a tap opens the
-- assembly's own drawing page. Actual time feeds the learning suggestion.

ALTER TABLE public.fab_marks
  ADD COLUMN IF NOT EXISTS allotted_minutes integer,      -- supervisor's allotted time (his edit of the suggestion)
  ADD COLUMN IF NOT EXISTS suggested_minutes integer,     -- what the app suggested (to measure the learning)
  ADD COLUMN IF NOT EXISTS assigned_at      timestamptz,  -- when the supervisor assigned it
  ADD COLUMN IF NOT EXISTS started_at       timestamptz,  -- worker tapped Start
  ADD COLUMN IF NOT EXISTS finished_at      timestamptz,  -- worker tapped Done
  ADD COLUMN IF NOT EXISTS actual_minutes   integer,      -- floor actual (ground truth for learning)
  ADD COLUMN IF NOT EXISTS drawing_file     text,         -- the block PDF this assembly is drawn in
  ADD COLUMN IF NOT EXISTS drawing_page     integer,      -- exact page (null = open the file at the top)
  ADD COLUMN IF NOT EXISTS part_count       integer;      -- plates/bolts on this assembly (complexity, future)

-- Fast lookups for the worker's "my work" list and the learning history.
CREATE INDEX IF NOT EXISTS idx_fab_marks_assigned ON public.fab_marks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fab_marks_actual   ON public.fab_marks (actual_minutes) WHERE actual_minutes IS NOT NULL;

NOTIFY pgrst, 'reload schema';
