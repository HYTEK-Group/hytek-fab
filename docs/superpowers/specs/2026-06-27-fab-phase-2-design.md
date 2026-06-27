# HYTEK Fab — Phase 2 design spec
Date: 2026-06-27

## What this adds

Three things that work together:

1. **PIN kiosk** — shared tablet on the factory floor, workers and supervisors identify by PIN, see only their own work, sign out when done.
2. **Contractor packages** — supervisor splits a job's mark list into an in-house pool and one package per external contractor. Marks move between pools. Supervisor logs progress from phone calls.
3. **Hub progress feed** — fab writes a structured snapshot (in-house % + per-contractor status + auto-generated narrative) to a table Hub reads, giving Hub the full picture of where every job is at.

---

## 1. PIN kiosk

### How it works

- The route `/kiosk` is publicly accessible — no Supabase auth required to load the PIN screen.
- Worker taps their four-digit PIN → `POST /api/fab/pin/verify` checks it against `fab_pins` → returns `{ worker_name, role }`.
- The tablet stores `{ worker_name, role, expires_at }` in `sessionStorage` (not `localStorage` — clears on tab close or browser restart).
- Auto-signs-out after 30 minutes of inactivity. A supervisor tap on any button resets the timer.
- After sign-in, the app routes to `/kiosk/work` (fabricator view) or `/kiosk/supervisor` (supervisor shortcut panel on tablet).

### Supervisor on the tablet

Supervisors use their own PIN. After sign-in they see a simplified supervisor panel (not the full PC dashboard): create contractor packages, log a phone call update, mark a package as sent or returned. For full job setup they use the PC at `supervisor/jobs/[id]`.

### Worker view (`/kiosk/work`)

Shows two sections — tasks assigned to this worker across all active jobs, and marks assigned to this worker (in-house pool only, not contractor marks). Each item has a single tap to mark done. Nothing else is visible. No job financials, no contractor details, no other workers' work.

### `fab_pins` table

```sql
CREATE TABLE fab_pins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL,
  pin_hash    text NOT NULL,       -- bcrypt, 10 rounds
  role        text NOT NULL DEFAULT 'fabricator'
                   CHECK (role IN ('admin','supervisor','fabricator')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

PINs are hashed server-side (bcrypt). The verify endpoint never returns the hash. A supervisor can add/change/deactivate a worker's PIN from the admin panel on PC.

---

## 2. Contractor packages

### Mark ownership rule

Every mark belongs to exactly one place at any time:

- **In-house pool**: `contractor_package_id IS NULL` — workers can be assigned to it, can tick it off via the kiosk.
- **Contractor package**: `contractor_package_id = <uuid>` — locked out of the in-house flow. Workers cannot see or tick these marks. Only the supervisor can move them.

When a supervisor assigns marks to a contractor package, the API sets `contractor_package_id` on those marks and their `status` → `not_started` (they'll be updated to `at_contractor` when the supervisor marks the package as sent). When marks are received back and inspected, `contractor_package_id` is cleared and status → `done`, returning them to the in-house pool as complete.

### `fab_contractor_packages` table

Replaces the unused `fab_sub_packages`. `fab_sub_packages` is left in place but no new code writes to it.

```sql
CREATE TABLE fab_contractor_packages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id           uuid NOT NULL REFERENCES fab_jobs(id) ON DELETE CASCADE,
  contractor_name      text NOT NULL,
  contractor_contact   text,
  scope_note           text,                   -- e.g. "CNC base plates"
  sent_at              timestamptz,
  expected_return_date date,
  returned_at          timestamptz,
  status               text NOT NULL DEFAULT 'pending'
                            CHECK (status IN
                              ('pending','sent','in_progress','returned','inspected')),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

### `fab_contractor_updates` table

One row per phone call / status event logged by the supervisor.

```sql
CREATE TABLE fab_contractor_updates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   uuid NOT NULL REFERENCES fab_contractor_packages(id) ON DELETE CASCADE,
  logged_at    date NOT NULL DEFAULT CURRENT_DATE,
  note         text NOT NULL,                  -- what they said
  reported_pct integer CHECK (reported_pct BETWEEN 0 AND 100),
  eta          date,
  entered_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

### `fab_marks` additions

```sql
ALTER TABLE fab_marks
  ADD COLUMN contractor_package_id uuid REFERENCES fab_contractor_packages(id),
  ADD COLUMN assigned_to           text;       -- in-house worker assignment
```

`assigned_to` is the worker name (matches `fab_pins.worker_name`). When `contractor_package_id` is set, `assigned_to` is irrelevant — the kiosk API ignores marks with a package set.

### Mark status transitions

| State | Meaning | Who sets it |
|---|---|---|
| `not_started` | In-house, not started | Default |
| `in_progress` | Worker ticked "start" on kiosk | Worker via kiosk |
| `done` | Worker ticked "done" on kiosk | Worker via kiosk |
| `at_contractor` | Package marked as sent | Supervisor |
| `returned` | Package marked as returned | Supervisor |
| `inspected` | Supervisor confirmed OK | Supervisor — also clears `contractor_package_id` |

---

## 3. Hub progress feed

### `flow_fab_progress` table

Fab writes one row per job, upserted on every meaningful state change.

```sql
CREATE TABLE flow_fab_progress (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id           uuid NOT NULL REFERENCES fab_jobs(id),
  quote_number         text NOT NULL,
  hubspot_deal_id      text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  total_marks          integer NOT NULL DEFAULT 0,
  marks_complete       integer NOT NULL DEFAULT 0,
  pct_complete         integer NOT NULL DEFAULT 0,    -- 0-100
  inhouse_total        integer NOT NULL DEFAULT 0,
  inhouse_complete     integer NOT NULL DEFAULT 0,
  contractor_packages  jsonb NOT NULL DEFAULT '[]',  -- see shape below
  narrative            text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress','complete','dispatch_ready')),
  UNIQUE (fab_job_id)
);
```

`contractor_packages` JSONB shape (one element per package):

```json
{
  "package_id": "uuid",
  "contractor_name": "ABC Engineering",
  "scope_note": "CNC base plates",
  "total_marks": 8,
  "marks_done": 8,
  "pct": 100,
  "status": "inspected",
  "last_update_date": "2026-06-25",
  "last_update_note": "All 8 done and inspected, ready to collect",
  "expected_return_date": "2026-06-27",
  "returned_at": "2026-06-27"
}
```

### Narrative auto-generation

A server-side function (`lib/fab-narrative.ts`) builds a plain-English sentence from the snapshot. Rules:

- In-house: "In-house fabrication X% complete (Y/Z marks)."
- Each contractor: `"{name} {scope}: {status_phrase}."` where status phrase is:
  - sent, no updates: "sent {date}, awaiting update"
  - in_progress with pct: "X% per call {date}, ETA {eta}"
  - returned: "received back {date}, inspecting"
  - inspected: "complete and received"
- Appended: "On track for on-site date" if `on_site_date` > today+7, otherwise "on-site date approaching."

### When the snapshot is written

The progress snapshot is recomputed and upserted to `flow_fab_progress` (and the narrative regenerated) after any of these events:

- Worker ticks a mark done or in-progress via kiosk
- Supervisor assigns/removes marks from a contractor package
- Supervisor marks a package as sent, returned, or inspected
- Supervisor logs a contractor update (phone call)
- Supervisor marks the job dispatch-ready

Hub reads `flow_fab_progress` — it never reads `fab_jobs`, `fab_marks`, or `fab_contractor_packages` directly.

---

## API routes (new and changed)

| Route | Method | Description |
|---|---|---|
| `/api/fab/pin/verify` | POST | Verify PIN, return worker info |
| `/api/fab/pin/workers` | GET/POST | Admin: list/add workers to PIN roster |
| `/api/fab/pin/workers/[id]` | PATCH/DELETE | Admin: update/deactivate a PIN |
| `/api/fab/kiosk/my-work` | GET | Worker's tasks + in-house marks (PIN session) |
| `/api/fab/jobs/[id]/contractor-packages` | GET/POST | List or create contractor packages |
| `/api/fab/contractor-packages/[id]` | PATCH | Update package status |
| `/api/fab/contractor-packages/[id]/marks` | POST | Assign/remove marks from package |
| `/api/fab/contractor-packages/[id]/updates` | POST | Log a phone call update |
| `/api/fab/jobs/[id]/marks` | PATCH | Existing — also triggers progress snapshot |

All existing routes remain unchanged. The progress snapshot write is a side-effect call inside the API handlers, not a separate cron.

---

## Pages (new and changed)

| Page | Description |
|---|---|
| `/kiosk` | PIN entry screen — public, no auth |
| `/kiosk/work` | Worker's tasks and marks — PIN session only |
| `/kiosk/supervisor` | Simplified supervisor panel for tablet use |
| `/admin/workers` | PIN roster management (add/edit/deactivate) |
| `/jobs/[id]` | Existing — "Subs" tab replaced with "Packages" tab showing contractor packages |

---

## Data migration

- `fab_sub_packages` is left as-is, unused going forward.
- No existing data needs migration (it was scaffolding with no rows in production yet).
- SQL migration `002-fab-phase2.sql` is idempotent, applied by hand to gqtikz.

---

## What is NOT in this spec

- Contractor self-reporting portal (decided: supervisor phone-call log only)
- Treatment batch tracking (deferred to Phase 3)
- Worker timesheets via kiosk (existing time-log tab on PC covers this)
- Dollar visibility on the kiosk (no financials anywhere in fab UI)
