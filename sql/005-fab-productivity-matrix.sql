-- =====================================================================
-- HYTEK Fab — 005: productivity matrix (task allotted/actual hours × tonnage)
-- =====================================================================
-- Target: SHARED OPS project (gqtikzguvhukpujyxkey)
-- Apply BY HAND in Supabase SQL editor — run scripts/whichdb.mjs first
-- and confirm the project ref in the editor URL is gqtikzguvhukpujyxkey.
--
-- Idempotent. Additive only. Fab-owned tables.

-- ── fab_tasks: the supervisor's expectation per task ────────────────────────
ALTER TABLE public.fab_tasks
  ADD COLUMN IF NOT EXISTS estimated_hours numeric,  -- allotted hours (locked expectation)
  ADD COLUMN IF NOT EXISTS due_on          date;     -- the timeline shown to the worker

-- ── fab_time_entries: attribute logged hours to a task (in-house only) ──────
ALTER TABLE public.fab_time_entries
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.fab_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fab_time_task ON public.fab_time_entries (task_id);

-- ── fab_task_marks: which marks a task covers (→ tonnage per task) ──────────
CREATE TABLE IF NOT EXISTS public.fab_task_marks (
  task_id uuid NOT NULL REFERENCES public.fab_tasks(id) ON DELETE CASCADE,
  mark_id uuid NOT NULL REFERENCES public.fab_marks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, mark_id)
);
CREATE INDEX IF NOT EXISTS idx_fab_task_marks_task ON public.fab_task_marks (task_id);
CREATE INDEX IF NOT EXISTS idx_fab_task_marks_mark ON public.fab_task_marks (mark_id);

-- ── RLS: authenticated SELECT, service_role ALL (new table) ─────────────────
ALTER TABLE public.fab_task_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fab_task_marks_select_auth ON public.fab_task_marks;
CREATE POLICY fab_task_marks_select_auth ON public.fab_task_marks
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fab_task_marks_all_service ON public.fab_task_marks;
CREATE POLICY fab_task_marks_all_service ON public.fab_task_marks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
