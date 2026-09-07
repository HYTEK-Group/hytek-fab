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
    - SUPABASE_ACCESS_TOKEN   # Management API, scripts/migrate.mjs only — never in a deployed bundle
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
    - fab_ready_queue          # Lane 7 CP3 — what the Hub's outbox has told fab is ready
    - fab_sub_accounts
    - fab_sub_grants
    - fab_sub_login_attempts
    - fab_task_marks
    - fab_tasks
    - fab_time_entries
    - fab_weekly_entries
    - job_bom                 # fab's own table. The old "purchasing reads it" note was WRONG:
                              # grep of hub/purchasing/detailing/install/lws on 07/09/2026
                              # found ZERO references. One writer, no readers. (Lane 7)
  reads:
    - jobs
    - job_aliases             # legacy HG / 7-digit → canonical number, for the ingest bridge
    - profiles
    - job_bom
  rpcs: []
hosts:
  approved:
    - hub.hytekframing.com.au
    - hytek-hub-staging.vercel.app
    - hytek-fab.vercel.app
    - hytek-fab-staging.vercel.app   # scripts/backfill-ready-queue.mjs runs against a deploy of this app
    - api.supabase.com         # scripts/migrate.mjs (Management API) — developer machines only
env:
  privileged:
    - SUPABASE_SERVICE_ROLE_KEY
crons: []
events:
  out:
    - fab_tonnes
    - fab_progress
    - fab_load_dispatched
    - fab_proof
  # Everything below arrives at POST /api/fab/ingest with x-fab-import-secret,
  # pushed by the Hub's outbox worker. fab never polls for any of it.
  in:
    - job.released            # payload.stream = 'SS' only; an LWS release is answered 200/ignored
    - materials.received
    - rework.raised           # → fab_tasks (the write the Hub does inline today)
    - rework.resolved
    - rework.reopened
    - variation.raised
    - variation.status_changed
migrations_dir: sql/migrations
migrate_staging: lvjxqygftugmcadstpff   # SHARED staging clone — every migration lands here first
migrate_prod: gqtikzguvhukpujyxkez      # SHARED production — Lane 13's cutover window only
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
   and nothing else. It used to WRITE two Hub-owned tables — `flow_fab_entries`
   (one weekly tonnes total) and `flow_fab_progress` (recomputed after any mark
   or package change). Both are gone: the Hub writes them from fab's events, and
   because they are no longer in `tables.owns` above, re-adding either write
   fails `npm run test:architecture`. `job_bom` is fab's own table (the
   BOM import writes it) and nothing else in the suite touches it — the earlier
   "side door — purchasing reads it" annotation was wrong; a grep of hytek-hub,
   hytek-purchasing, hytek-detailing, hytek-install and hytek-lws on 07/09/2026
   found zero references.
5. **How it gets a job.** The Hub's outbox pushes `job.released` (stream `SS`)
   and `materials.received` into `POST /api/fab/ingest`, guarded by
   `x-fab-import-secret` (`FAB_IMPORT_SECRET`, constant-time, fail closed), and
   fab keeps the answer in its own `fab_ready_queue`. `GET /api/fab/ready-queue`
   then reads that table and joins `jobs` for names — **zero Hub calls**. It used
   to make up to FIFTY sequential `GET /api/flow/job-state` calls per page load,
   per supervisor. `READY_QUEUE_SOURCE=hub-poll` puts the old path back for one
   environment while the Hub's `fab` subscriber is still on `NOT_WIRED_YET`;
   `readyQueueByPolling()` is deleted the day production flips to `ingest`
   (Lane 13 cutover step 7 — owner Lane 13, by 30/11/2026). `POST /api/fab/jobs`
   **validates every number against SHARED `jobs`** and refuses an unknown one
   with 422; a legacy `HG`/`HM`/7-digit reference is resolved through
   `job_aliases` and the row is created under the CANONICAL number, never the
   typed one (`src/lib/job-lookup.ts`). A test job is refused too — fab never
   fabricates one. Only the Hub mints a number, and fab can no longer act as if
   it does.
6. **How it reports back.** Through the one door: `POST /api/flow/event` with
   four verbs — `fab_tonnes`, `fab_progress`, `fab_load_dispatched`, `fab_proof`
   (`src/lib/hub-events.ts`, payloads built in `src/lib/hub-event-builders.ts`).
   There are no direct writes into Hub tables left. A send never fails a floor
   action; a genuine failure lands in `fab_events` as `hub_send_failed` and
   shows on the Exceptions screen.
7. **Who it calls.** The Hub only (`src/lib/hub.ts`), with **`HUB_TOKEN_FAB`** —
   a fab-scoped token, not the unscoped `HUB_INTERNAL_TOKEN` it used to hold.
   When that token is unset the Hub is reported UNREACHABLE; there is no
   permissive stub returning a made-up job-state. No HubSpot, Xero, Asana, Slack,
   Resend, Sentry or invoicing calls.
8. **Who calls it.** The Hub's **outbox worker**, at `POST /api/fab/ingest` with
   `x-fab-import-secret` — seven verbs, listed in `events.in` above.
   hytek-detailing's dispatch pages, through `GET /api/fab/bridge/dispatch` and
   `/api/fab/bridge/proof/[quote]` with `FAB_BRIDGE_TOKEN`; and the office-server
   ingest bridge, which mints its own kiosk token with `KIOSK_SECRET` and posts
   jobs, assembly lists, BOMs and drawings. The bridge holds **no database
   credential** — it is a pure HTTP client of this app.
8a. **`fab_tasks` has one writer, and it is fab.** The Hub writes it today, from
   `lib/flow/signals/apply-rework-variation.ts` — an insert on rework/variation
   raised, `status='done'` on resolved, `completed_at=null` on reopened. That is
   the last cross-app write into a `fab_*` table and it breaks root CLAUDE.md
   rule 4. `/api/fab/ingest` now handles all five of those verbs itself
   (`src/lib/fab-ingest.ts`), reproducing the Hub's shapes exactly, so the Hub's
   inline writes come out in **Lane 3 CP5** — the same commit that lands
   `lib/outbox/subscribers/fab.ts` and takes `fab` off `NOT_WIRED_YET`. Until
   that day the Hub is still the writer and fab's handler receives nothing;
   nothing is written twice, because the outbox filters `fab` out of the fan-out
   entirely. Owner: Lane 3. Date: the outbox list must be empty by 30/11/2026
   (`hytek-hub/__tests__/fan-out.test.ts` fails the build after it).
9. **Scheduled work.** No `vercel.json`, so zero Vercel crons. One office-server
   Task Scheduler job runs `scripts/ss-ingest-bridge.mjs` against the Y: drive.
   It reads job numbers with `scripts/lib/job-ref.mjs` — 8-digit mint number
   first, then a legacy `HG`/`HM` reference, and **skips a folder it cannot read
   a number from**. It used to use the whole folder name as the job number.
10. **Its schema.** `sql/001-*.sql` … `sql/014-*.sql` are FROZEN — they are the
    history, and editing one desynchronises git from a database that already ran
    the old text. New DDL is a numbered file in `sql/migrations/` applied with
    `npm run migrate -- up --project staging` (SHARED staging clone
    `lvjxqygftugmcadstpff`); production `gqtikzguvhukpujyxkez` is Lane 13's
    cutover window and needs `MIGRATE_ALLOW_PROD=1`. The runner claims Scott's
    `coordination_lock` before any SHARED SQL and records a schema fingerprint,
    so a dashboard paste cannot stay quiet. `scripts/migrate.mjs` is the
    canonical copy carried by every repo — never edit this one.
11. **The rule.** `npm run test:architecture` fails on anything this file does not
    declare. Do not widen it to make a change pass — close the door instead, or
    raise it with the lane that owns it.
