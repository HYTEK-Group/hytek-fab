@AGENTS.md

# HYTEK Fab App

Structural steel fabrication management for HYTEK Framing.

## 🛑 READ THIS BEFORE TOUCHING SUPABASE 🛑

**This app is on the SHARED gqtikz Supabase project (NOT a dedicated one).**
Project ref: **`gqtikzguvhukpujyxkez`**

**ALWAYS run this before sending a Supabase dashboard URL or modifying schema:**
```bash
node scripts/whichdb.mjs
```

SQL Editor: https://supabase.com/dashboard/project/gqtikzguvhukpujyxkez/sql/new

## Hub-and-Spoke Architecture

This app is a **spoke**. It talks ONLY to the Hub — and since Lane 7 that is
true, not aspirational. `SYSTEM.md` is the passport and `npm run test:architecture`
enforces it; read the passport before you read this section.

**Every credential fab holds is scoped.**

- **Its Hub token is `HUB_TOKEN_FAB`.** Not `HUB_INTERNAL_TOKEN` — an unscoped
  token that can trigger any other spoke's events has no business in a
  department app. When it is unset the Hub is reported UNREACHABLE; there is no
  permissive stub returning a made-up job-state (`src/lib/hub.ts`).
- **Its database credential is `SUPABASE_ROLE_KEY`** for role `app_fab`, scoped
  to the tables in the passport (`src/lib/supabase-admin.ts`). The service key
  is a warned-about fallback until Lane 13 mints the role.

**How fab TELLS the Hub things — four verbs, one door.**
`POST {HUB}/api/flow/event` with `HUB_TOKEN_FAB`: `fab_tonnes`, `fab_progress`,
`fab_load_dispatched`, `fab_proof` (`src/lib/hub-events.ts`, payloads built in
`src/lib/hub-event-builders.ts`). **Do NOT write `flow_fab_entries` or
`flow_fab_progress`** — they are the Hub's tables, the Hub writes them from
these events, and they are no longer in `tables.owns`, so re-adding a write
fails the architecture check. A send never fails a floor action; a genuine
failure lands in `fab_events` as `hub_send_failed`.

**How fab HEARS things — one door in, and fab never polls.**
The Hub's outbox pushes to `POST /api/fab/ingest` (`x-fab-import-secret`):
`job.released` (stream `SS`), `materials.received`, `job.revised`, and the five
`rework.*` / `variation.*` verbs that create and close `fab_tasks`. Releases and
materials land in `fab_ready_queue`; `GET /api/fab/ready-queue` reads that and
makes **zero Hub calls**. The remaining Hub read is `GET /api/flow/job-state` on
the job page, where one job is in view.

**Only the Hub issues job numbers.** `POST /api/fab/jobs` validates every number
against SHARED `jobs` and refuses an unknown one with 422; a legacy `HG`/`HM`/
7-digit reference resolves through `job_aliases` and the row is created under
the CANONICAL number (`src/lib/job-lookup.ts`).

**NEVER READ**: `detailing_handoffs`, `purchasing` tables, or any other spoke's
tables. No app-to-app reads. Hub only.

## Tech Stack
- Next.js (App Router) + Supabase (gqtikz)
- **No dollars shown in fab UI** — no budget fields in any component
- Branding: Yellow #FFCB05, Black #231F20, dark background #141416
- DD/MM/YYYY date format (Australian)
- All useState before conditional returns

## Folder Structure
- `src/app/api/fab/` — all API routes
- `src/lib/` — shared utilities (supabase, auth, hub client, types)
- `sql/` — migration files applied by hand in the Supabase SQL editor

## Key Tables (all in gqtikz)
- `fab_jobs` — one row per job started in fab
- `fab_tasks` — free-form supervisor tasks
- `fab_marks` — individual steel members (from Tekla list)
- `fab_time_entries` — daily time logs per worker
- `fab_weekly_entries` — per-job tonnes breakdown (DO NOT confuse with flow_fab_entries)
- `flow_fab_entries` — Hub contract: weekly totals only, one row per week (Hub reads this)

## SQL Migration Discipline
- Every migration in `sql/` is applied by hand via the Supabase SQL editor
- BEFORE pasting SQL: run `whichdb.mjs`, confirm project ref = `gqtikzguvhukpujyxkez`
- Migrations are idempotent (IF NOT EXISTS, IF EXISTS, DROP POLICY before CREATE POLICY)

## Auth Pattern
- Bearer token auth: client sends `supabase.auth.getSession()` access_token
- Server-side: `getFabUser(req)` in `src/lib/get-fab-user.ts` verifies via service-role
- `profiles` table in gqtikz: role = 'admin' | 'supervisor' | 'fabricator'

## Drawings
- PDFs uploaded to Supabase Storage bucket `fab-drawings/{quote_number}/`
- Sync server (Y: drive) handles uploads — app reads signed URLs only
