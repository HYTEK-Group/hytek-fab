# SS-ingest bridge — server runbook

`scripts/ss-ingest-bridge.mjs` is the hands-off Y:→fab loader. It runs on the
**always-on office server** (the box that has the Y: drive mapped and stays on
the network — Vercel can't see Y:). It loads, per structural-steel job:

- **marks + tonnage** → `POST /api/fab/jobs/{id}/import-assembly` (re-issue safe)
- **bill of materials** → `POST /api/fab/jobs/{id}/import-bom` → `job_bom` (purchasing reads)
- **shop drawings** → the `fab-drawings` storage bucket

It is idempotent: unchanged marks re-import to no-ops, a re-issue is flagged for
review (never silently overwritten), and each BOM report replaces only its own
rows (no duplication).

## Prerequisites (on the server)

1. **Node 18+** (`node -v`).
2. The repo checked out, deps installed: `npm install` in `hytek-fab`.
3. The **Y: drive mapped** and reachable as the user the task runs as.
4. The env values below (same Supabase project as the fab app — gqtikz).

## Environment

Create `scripts/ss-ingest-bridge.env.cmd` (do NOT commit it):

```bat
set SS_YEAR_ROOT=Y:\(17) 2026 HYTEK PROJECTS
set FAB_URL=https://hytek-fab.vercel.app
set KIOSK_SECRET=<same KIOSK_SECRET as the fab app>
set SUPABASE_URL=https://gqtikzguvhukpujyxkez.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=<gqtikz service role key>
rem --- optional: gate ingest on the Hub "Release to Factory" signal ---
rem set RELEASES_ONLY=1
rem set HUB_BASE=https://hub.hytekframing.com.au
rem set HUB_INTERNAL_TOKEN=<Hub read token, or HUB_TOKEN_LWS>
```

- Leave `RELEASES_ONLY` unset to load every job that has Tekla IFF reports present
  (current behaviour). Once the detailing "Release to Factory" pipeline is live,
  set `RELEASES_ONLY=1` + `HUB_BASE` + a Hub token to load **only released** jobs.

## Wrapper

`scripts/run-ss-ingest.cmd` (commit this; it reads the env file beside it):

```bat
@echo off
cd /d "%~dp0\.."
call "%~dp0ss-ingest-bridge.env.cmd"
node scripts\ss-ingest-bridge.mjs >> "%~dp0ss-ingest-bridge.log" 2>&1
```

## Try it safely first

```bat
call scripts\ss-ingest-bridge.env.cmd
set DRY_RUN=1
node scripts\ss-ingest-bridge.mjs
```

`DRY_RUN=1` lists every job it WOULD load (and, if `RELEASES_ONLY=1`, which it
would skip as not-released) and changes nothing. Use `MAX_JOBS=3` to cap a real
first run.

## Schedule (Windows Task Scheduler)

- Program/script: `C:\path\to\hytek-fab\scripts\run-ss-ingest.cmd`
- Trigger: every 15 minutes (or hourly).
- Run whether the user is logged on or not, as an account that has the Y: mapping.
- "Start in": the `hytek-fab\scripts` folder.

Check `scripts/ss-ingest-bridge.log` after the first scheduled run.

## What it does NOT do
- It never writes HubSpot, never writes another app's tables, and only ever
  *reads* Y:. It writes only `fab_*` rows, `job_bom`, and the `fab-drawings` bucket
  on gqtikz.
