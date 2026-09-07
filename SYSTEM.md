---
app: hytek-fab
url: https://hytek-fab.vercel.app
role: app_fab
supabase:
  project_refs: []
  env:
    - NEXT_PUBLIC_SUPABASE_URL
    - NEXT_PUBLIC_SUPABASE_ANON_KEY
    - SUPABASE_URL
    - SUPABASE_SERVICE_ROLE_KEY
    - FAB_URL
tables:
  owns:
    - fab_contractor_packages
    - fab_contractor_updates
    - fab_delivery_stages
    - fab_dispatch_loads
    - fab_events
    - fab_import_batches
    - fab_jobs
    - fab_marks
    - fab_package_certs
    - fab_pins
    - fab_pin_attempts
    - fab_proof_photos
    - fab_qc_events
    - fab_sub_accounts
    - fab_sub_grants
    - fab_sub_login_attempts
    - fab_task_marks
    - fab_tasks
    - fab_time_entries
    - fab_weekly_entries
    - flow_fab_entries        # side door — Hub table written direct; Lane 7 closes
    - flow_fab_progress       # side door — Hub table written direct; Lane 7 closes
    - job_bom                 # side door — purchasing reads it; ownership settled by Lane 7
  reads:
    - jobs
    - profiles
    - job_bom
  rpcs: []
hosts:
  approved:
    - hub.hytekframing.com.au
    - hytek-fab.vercel.app
    - "*.ingest.sentry.io"   # Sentry error reporting — Lane 0 CP3 wired it; the app talks to Sentry only when NEXT_PUBLIC_SENTRY_DSN is set
env:
  privileged:
    - SUPABASE_SERVICE_ROLE_KEY
    - SENTRY_AUTH_TOKEN   # source-map upload at BUILD time only (next.config.ts); never read at runtime
crons: []
events:
  out: []
  in: []
exemptions:
  - { path: scripts/ss-ingest-bridge.mjs, reason: "on-site script; Lane 12 moves it to hytek-bridge", until: 2026-10-31 }
  - { path: scripts/run-ss-ingest.cmd, reason: "on-site script; Lane 12 moves it to hytek-bridge", until: 2026-10-31 }
---

# hytek-fab — passport

1. **What it is.** The Fabrication Tracker: structural-steel jobs from
   drawings-issued through material receipt, shop floor, QC, surface treatment,
   sub packages and dispatch. Next.js App Router under `src/`, plus a 4-digit-PIN
   kiosk for the floor and an invite-link portal for subcontractors.
2. **Where its data lives.** SHARED `gqtikzguvhukpujyxkez` only. There is no
   hard-coded project ref in the code; the client is built from
   `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` / `FAB_URL`.
3. **What it owns.** Every `fab_*` table: jobs, marks, tasks, time and weekly
   entries, import batches, dispatch loads, delivery stages, proof photos, QC
   events, the append-only `fab_events` exception log, PINs and their attempt
   counters, and the subcontractor account/grant/attempt tables.
4. **What it borrows.** It reads the shared `jobs` table and `profiles` directly,
   and it writes two Hub-owned tables — `flow_fab_entries` (one weekly tonnes
   total) and `flow_fab_progress` (recomputed after any mark or package change).
   `job_bom` is written here by the BOM import and read by purchasing.
5. **How it gets a job.** `GET /api/fab/ready-queue` reads shared `jobs` with the
   service role, subtracts what is already in `fab_jobs`, then asks the Hub
   `GET /api/flow/job-state/_?quote_number=` per candidate. `POST /api/fab/jobs`
   inserts a `fab_jobs` row from whatever quote number the body carries — it is
   **not** validated against `jobs`. Only the Hub may mint a number.
6. **How it reports back.** It does not. There is no `POST /api/flow/event`
   anywhere in this repo; the two `flow_fab_*` writes are the report, and they go
   straight into the Hub's tables.
7. **Who it calls.** The Hub only (`src/lib/hub.ts`, `HUB_INTERNAL_TOKEN` — the
   unscoped Hub-wide token, not a fab-scoped one). No HubSpot, Xero, Asana, Slack,
   Resend or invoicing calls. Sentry is wired (see below) and is the one
   external service this app talks to directly.
8. **Who calls it.** hytek-detailing's dispatch pages, through
   `GET /api/fab/bridge/dispatch` and `/api/fab/bridge/proof/[quote]` with
   `FAB_BRIDGE_TOKEN`; and the office-server ingest bridge, which mints its own
   kiosk token with `KIOSK_SECRET` and posts assembly lists and BOMs.
9. **Scheduled work.** No `vercel.json`, so zero Vercel crons. One office-server
   Task Scheduler job runs `scripts/ss-ingest-bridge.mjs` against the Y: drive; it
   derives job numbers from folder names with a legacy `HG\d{6,}` pattern while the
   current mint is 8-digit numeric.
10. **The rule.** `npm run test:architecture` fails on anything this file does not
    declare. Do not widen it to make a change pass — close the door instead, or
    raise it with the lane that owns it.

**Sentry (Lane 0 CP3, 07/09/2026).** `@sentry/nextjs` is wired the same way in all
seven apps: `instrumentation.ts` / `instrumentation-client.ts` / `sentry.server.config.ts`
/ `sentry.edge.config.ts`, and `next.config.ts` wraps the build with
`withSentryConfig` **only when `NEXT_PUBLIC_SENTRY_DSN` is set**. No session replay —
these screens carry money and staff data. With no DSN the app is byte-identical to
before and sends nothing.

`GET /api/health/sentry-test` is a **temporary** delivery proof, gated on
`CRON_SECRET` and failing closed without it (503) and without a DSN (503, and it
says so rather than returning a 200 for a message it never sent).
**Lane 13 deletes that route at cutover — owner Lane 13, on or before 31/10/2026.**
