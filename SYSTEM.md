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
   and nothing else. It used to WRITE two Hub-owned tables — `flow_fab_entries`
   (one weekly tonnes total) and `flow_fab_progress` (recomputed after any mark
   or package change). Both are gone: the Hub writes them from fab's events, and
   because they are no longer in `tables.owns` above, re-adding either write
   fails `npm run test:architecture`. `job_bom` is fab's own table (the
   BOM import writes it) and nothing else in the suite touches it — the earlier
   "side door — purchasing reads it" annotation was wrong; a grep of hytek-hub,
   hytek-purchasing, hytek-detailing, hytek-install and hytek-lws on 07/09/2026
   found zero references.
5. **How it gets a job.** `GET /api/fab/ready-queue` reads shared `jobs` with the
   service role, subtracts what is already in `fab_jobs`, then asks the Hub
   `GET /api/flow/job-state/_?quote_number=` per candidate. `POST /api/fab/jobs`
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
8. **Who calls it.** hytek-detailing's dispatch pages, through
   `GET /api/fab/bridge/dispatch` and `/api/fab/bridge/proof/[quote]` with
   `FAB_BRIDGE_TOKEN`; and the office-server ingest bridge, which mints its own
   kiosk token with `KIOSK_SECRET` and posts jobs, assembly lists, BOMs and
   drawings. The bridge holds **no database credential** — it is a pure HTTP
   client of this app.
9. **Scheduled work.** No `vercel.json`, so zero Vercel crons. One office-server
   Task Scheduler job runs `scripts/ss-ingest-bridge.mjs` against the Y: drive.
   It reads job numbers with `scripts/lib/job-ref.mjs` — 8-digit mint number
   first, then a legacy `HG`/`HM` reference, and **skips a folder it cannot read
   a number from**. It used to use the whole folder name as the job number.
10. **The rule.** `npm run test:architecture` fails on anything this file does not
    declare. Do not widen it to make a change pass — close the door instead, or
    raise it with the lane that owns it.
</content>
</invoke>
