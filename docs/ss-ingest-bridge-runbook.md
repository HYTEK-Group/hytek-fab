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
rem --- optional: gate ingest on the Hub "Release to Factory" signal ---
rem RELEASES_ONLY is ON by default. Set it to 0 only if you deliberately want
rem every job with Tekla IFF reports loaded, released or not.
rem set RELEASES_ONLY=0
```

- **The bridge holds no database key.** `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are gone from this script and must be REMOVED from
  the server's env file — a service-role key in a `.env` on a Windows box is a
  copy of the whole database. `HUB_BASE` and `HUB_INTERNAL_TOKEN` are gone too:
  the release check asks fab, so the bridge talks to exactly one app.
- **It can no longer invent a job number.** A folder it cannot read a number from
  is skipped and logged; `POST /api/fab/jobs` refuses a number the Hub has never
  issued (422). A legacy `HG` folder is resolved to its canonical 8-digit number.
- Set `RELEASES_ONLY=0` to load every job that has Tekla IFF reports present
  (current behaviour). Once the detailing "Release to Factory" pipeline is live,
  the default (`RELEASES_ONLY` on) loads **only released** jobs.

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

`DRY_RUN=1` lists every job it WOULD load (and, with `RELEASES_ONLY` on, which it
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

## Where this is going

Lane 12 turns this script into the `fab-ingest` plugin of the `hytek-bridge`
Windows service. After the 07/09/2026 change it is already a pure HTTP client
holding one secret, so that is a move rather than a rewrite. Until then it runs
unchanged under the `SYSTEM.md` exemption (`until: 2026-10-31`).
