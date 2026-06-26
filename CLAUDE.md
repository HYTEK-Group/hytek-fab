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

This app is a **spoke**. It talks ONLY to the Hub.

- **Read job state**: `GET https://hub.hytekframing.com.au/api/flow/job-state/{deal_id}`
  - Auth: `Authorization: Bearer $HUB_INTERNAL_TOKEN` (server-side only)
  - `ready_to_ship` from Hub = drawings cleared in detailing → mapped to `ss_drawings_issued`
  - `materials_received` = when Purchasing is built Hub will relay it; defaults false
- **Write tonnes to Hub feed**: `flow_fab_entries` table in gqtikz — append-only, one total per week
  - DO NOT add per-job rows to this table — Hub's `latestPerWeek()` reads the last row only
  - Per-job breakdown goes in `fab_weekly_entries`; API writes summed total to `flow_fab_entries` last

**NEVER READ**: `detailing_handoffs`, `purchasing` tables, or any other spoke's tables.
No app-to-app reads. Hub only.

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
