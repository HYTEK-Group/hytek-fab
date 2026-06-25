@AGENTS.md

# HYTEK Fab

Structural steel fabrication management for HYTEK Framing (Brisbane, QLD). Covers each SS job from drawings issued → material receipt → shop-floor production → surface treatment → sub packages → dispatch. Workshop staff use it on phones; Scott + the supervisor use the budget dashboard on desktop.

## Status
- **Repo + app code: v1 in progress** (this build). Created 26/06/2026.
- **gqtikz schema: NOT applied yet — HELD for Scott.** See `sql/001-fab-schema.sql`. Applying it is a shared-DB change (stop-and-coordinate, one person on the DB at a time).
- Phase 0 design approved by Scott 25/06/2026.

## Database — gqtikz (SHARED)
- Project ref: `gqtikzguvhukpujyxkez` (`https://gqtikzguvhukpujyxkez.supabase.co`)
- **Shared with Hub / Detailing / Dispatch / Install / Purchasing.** Any SQL/schema change hits all of them. STOP-AND-COORDINATE with Scott before running anything.
- **Before any SQL:** run `node scripts/whichdb.mjs` here and confirm the ref is `gqtikzguvhukpujyxkez`. (Note: the onboarding brief said to run this in hytek-detailing — that repo has no such script; use this repo's, which prints its configured ref.)
- Fab tables: `fab_jobs`, `fab_marks`, `fab_material_receipts`, `fab_time_entries`, `fab_sub_packages`, `fab_treatment_batches`, `fab_treatment_batch_marks`.

## Cardinal rule — hub-and-spoke
All cross-app communication goes through **hytek-hub**. No app reads another app's tables directly; Hub owns all HubSpot writes.
- **IN from Hub:** job shell (quote_number, hubspot_deal_id, name, client, on_site_date, award price, budget by cost code). Start signal = `GET {HUB_BASE}/api/flow/job-state/{deal_id}` → `{ ss_drawings_issued, materials_received }`.
- **OUT to Hub:** weekly SS tonnes → `flow_fab_entries` (Hub reads); job complete → `fab_jobs.fab_complete_at`.
- ⚠️ **Known v1 deviations (flagged for Scott):**
  1. The Hub `GET /api/flow/job-state/{deal_id}` endpoint **does not exist yet**. v1 uses a temporary stub `getJobState()` in `src/lib/fab.ts` that reads Hub-owned `flow_jobs` directly. This is a deliberate cross-app read — replace with the Hub endpoint when built.
  2. The `ALTER flow_jobs ADD ss_drawings_issued, materials_received` in the migration touches a **Hub-owned table** — that piece belongs in a Hub change, not the fab migration. Confirm ownership/sequencing with Scott.

## Tech stack (same across the suite)
- Next.js 16.2.3 (App Router — **post-training-cutoff; read `node_modules/next/dist/docs/` before writing Next.js code**)
- React 19.2.4 · Supabase JS ^2.103.0 · Tailwind v4 (`@tailwindcss/postcss`) · TypeScript strict
- `idb-keyval` offline queue (`src/lib/queue.ts`) · Jost font · Mobile-first PWA
- Auth: `admin@hytekframing.com.au` / `Hytek2026`

## Conventions (non-negotiable)
- Brand: yellow `#FFCB05`, black `#231F20`, `hytek-group-logo.png` in every header.
- DD/MM/YYYY dates, AUD, metric (`src/lib/format.ts`).
- All `useState` BEFORE any conditional return.
- RLS `FOR ALL` policies need BOTH `USING` and `WITH CHECK`.
- Inputs ≥16px font (iOS no-zoom — handled globally in `globals.css`).
- Offline queue append-only (new rows, never UPDATEs).
- **Permissive compliance mode:** HYTEK is not yet AS/NZS 5131 compliant. Every compliance field (heat numbers, mill certs, ACRS, ITPs, welder quals) is optional. Missing fields get an acknowledge-and-proceed checkbox (audit trail, no hard gate). `fab_jobs.compliance_mode` = `permissive` (default) | `enforced`.

## Screens (v1)
- `/` — Job register (all SS jobs, status, margin). **built**
- `/ready` — Ready-to-fab queue (drawings issued + materials received). **built**
- `/jobs/[id]` — Job detail (Overview / Marks / Sub packages / Surface treatment / Budget). *building*
- `/jobs/[id]/receive` — Material receipt (heat number, ACRS soft-warn, mill cert upload, acknowledge checkboxes). *building*
- `/tonnes` — Weekly SS tonnes → `flow_fab_entries`. *building*
- Surface-treatment batch + sub-package detail screens = week 2 (schema is ready).

## Tekla BOM import
Detailers issue a Tekla Assembly List xlsx on drawings-issued. Upload at `/jobs/[id]/import`. Parser maps: Assembly Mark, Qty, Profile, Name, Length mm, Assembly Weight kg, Assembly Coating. `Assembly Coating` auto-classifies treatment via `classifyCoating()`: HDG → galv batch, ETCH PRIMER → paint batch, DURAGAL/similar → none.

## Deploy
- Vercel (CLI authed on the laptop). Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` → gqtikz.

## Accounts
- Admin: `admin@hytekframing.com.au` / `Hytek2026`
