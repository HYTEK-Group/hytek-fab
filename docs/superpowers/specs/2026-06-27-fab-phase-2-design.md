# HYTEK Fab — Phase 2 design spec
Date: 2026-06-27 (revised: 2026-06-27 — added QC, rework, sequential external, partial dispatch)

## What this adds

Five things that work together:

1. **PIN kiosk** — shared tablet on the factory floor, workers and supervisors identify by PIN, see only their own work, sign out when done.
2. **Contractor packages** — supervisor splits a job's mark list into an in-house pool and one package per external party (fabricator, treatment plant, CNC shop). Marks move between pools. Marks can be sent to ABC Engineering, returned, and then assigned to a galvaniser in sequence. Treatment (HDG, primer) uses the same system via `package_type = 'treatment'`.
3. **QC checkpoints** — supervisor does a QC pass on all `done` and `returned` marks before they are considered dispatch-ready. Pass → `qc_passed`. Fail → back to `not_started`, QC event logged (who, defect, rework type). `rework_count` tracks how many cycles a mark has been through.
4. **Partial dispatch loads** — supervisor groups `qc_passed` marks into numbered loads (Load 1, Load 2…) and records when each goes out. A job can dispatch across multiple days/trucks.
5. **Hub progress feed** — fab writes a structured snapshot (in-house % + per-package status + QC pass rate + dispatch loads) + auto-generated narrative that Hub reads.

---

## 1. PIN kiosk

### How it works

- The route `/kiosk` is publicly accessible — no Supabase auth required to load the PIN screen.
- Worker taps their four-digit PIN → `POST /api/fab/pin/verify` checks it against `fab_pins` → returns `{ worker_name, role }`.
- The tablet stores `{ worker_name, role, expires_at }` in `sessionStorage` (not `localStorage` — clears on tab close or browser restart).
- Auto-signs-out after 30 minutes of inactivity. A supervisor tap on any button resets the timer.
- After sign-in, the app routes to `/kiosk/work` (fabricator view) or `/kiosk/supervisor` (supervisor shortcut panel on tablet).

### Supervisor on the tablet

Supervisors use their own PIN. After sign-in they see a simplified supervisor panel: create contractor packages, log a phone call update, mark a package as sent or returned, run a QC review. For full job setup they use the PC at `/jobs/[id]`.

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

## 2. Contractor packages (including treatment)

### Mark ownership rule

Every mark belongs to exactly one place at any time:

- **In-house pool**: `contractor_package_id IS NULL` — workers can be assigned to it, can tick it off via the kiosk.
- **Contractor/treatment package**: `contractor_package_id = <uuid>` — locked out of the in-house flow. Workers cannot see or tick these marks. Only the supervisor can move them.

### Sequential external work

A mark can go through multiple external parties in sequence. Example: base plates → ABC Engineering (CNC) → returned → QC passed → galvaniser (HDG treatment) → returned → QC passed → dispatch.

The flow:
1. Supervisor creates ABC Engineering package, assigns marks → `contractor_package_id` set, status → `at_contractor`
2. Package returned → status → `returned`
3. Supervisor does QC pass → status → `qc_passed`, `contractor_package_id` cleared
4. Supervisor creates HDG treatment package, assigns same marks → `contractor_package_id` set again, status → `at_contractor`
5. Package returned → QC passed → `qc_passed`, cleared → ready for dispatch

The history of each external leg is preserved in the `fab_contractor_packages` rows and their update logs.

### Treatment as package type

Treatment (HDG, etch primer, powder coat, two-pack) is the same workflow as any contractor package, with two extra fields:

- `package_type` = `'treatment'` (vs `'fabrication'` for CNC/welding shops, `'other'`)
- `treatment_type` = `'hdg' | 'etch_primer' | 'powder_coat' | 'two_pack' | null`

The existing `fab_treatment_batches` / `fab_treatment_batch_marks` scaffolding from Phase 1 is superseded by this — no code will write to those tables going forward.

### `fab_contractor_packages` table

Replaces the unused `fab_sub_packages`. `fab_sub_packages` and `fab_treatment_batches` are left in place but no new code writes to them.

```sql
CREATE TABLE fab_contractor_packages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id           uuid NOT NULL REFERENCES fab_jobs(id) ON DELETE CASCADE,
  package_type         text NOT NULL DEFAULT 'fabrication'
                            CHECK (package_type IN ('fabrication','treatment','other')),
  treatment_type       text CHECK (treatment_type IN
                            ('hdg','etch_primer','powder_coat','two_pack','other')),
  contractor_name      text NOT NULL,
  contractor_contact   text,
  scope_note           text,                   -- e.g. "CNC base plates", "HDG all columns"
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
  note         text NOT NULL,                  -- what they said / what happened
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
  ADD COLUMN assigned_to           text,        -- in-house worker assignment
  ADD COLUMN rework_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN rework_note           text,        -- last defect description (overwritten each fail)
  ADD COLUMN dispatch_load_id      uuid REFERENCES fab_dispatch_loads(id);
```

`assigned_to` is the worker name (matches `fab_pins.worker_name`). When `contractor_package_id` is set, `assigned_to` is irrelevant — the kiosk API ignores marks with a package set.

### Mark status transitions

| State | Meaning | Who sets it |
|---|---|---|
| `not_started` | In-house, not started (also: rework cycle reset) | Default / QC fail |
| `in_progress` | Worker tapped Start on kiosk | Worker via kiosk |
| `done` | Worker tapped Done on kiosk | Worker via kiosk |
| `at_contractor` | Package marked as sent | Supervisor |
| `returned` | Package marked as returned | Supervisor |
| `qc_passed` | Supervisor QC approved | Supervisor — also clears `contractor_package_id` |

**After QC fail**: status → `not_started`, `rework_count++`, `rework_note` set. Mark re-enters the in-house pool (or supervisor assigns to a new/updated contractor package if the rework is external).

**After `qc_passed`**: `contractor_package_id` cleared. If more external work is needed, supervisor assigns mark to the next package immediately — status → `at_contractor` again.

**Dispatch**: once `qc_passed`, supervisor assigns mark to a dispatch load. Status does not change — the `dispatch_load_id` being set (and the load having a `dispatched_at`) is the dispatch signal.

---

## 3. QC checkpoints

### How it works

The supervisor opens a **QC Review** panel (tab on the job detail page, and accessible from the tablet supervisor panel). It shows all marks with status `done` or `returned` that have no QC event yet, grouped by package (or "in-house" for direct fabrication).

For each mark (or bulk-selected group), supervisor can:
- **Approve** → status → `qc_passed`, `contractor_package_id` cleared if set, QC event logged
- **Reject** → opens a defect form: defect description (required), rework type (`inhouse` or `contractor`). Status → `not_started`, `rework_count++`, `rework_note` set, QC event logged.

QC review is optional per mark — the app doesn't block dispatch for jobs without CC enforcement. For jobs with `cc_level = 'CC2'` or above, the `compliance_mode = 'enforced'` flag (already on `fab_jobs`) will be used in a future phase to gate dispatch until all marks have a `qc_passed` status.

### `fab_qc_events` table

```sql
CREATE TABLE fab_qc_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id   uuid NOT NULL REFERENCES fab_jobs(id) ON DELETE CASCADE,
  mark_id      uuid NOT NULL REFERENCES fab_marks(id) ON DELETE CASCADE,
  inspected_by text NOT NULL,
  result       text NOT NULL CHECK (result IN ('pass','fail')),
  defect_note  text,              -- required when result = 'fail'
  rework_type  text CHECK (rework_type IN ('inhouse','contractor')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Each QC cycle produces one event. If a mark is rejected twice, there are two `fab_qc_events` rows with `result = 'fail'` for that mark.

---

## 4. Dispatch loads (partial dispatch)

### How it works

Supervisor opens the **Dispatch** tab on a job. It shows all `qc_passed` marks not yet in a load. Supervisor:
1. Creates a new load (Load 1, with description and planned date).
2. Selects marks and assigns them to Load 1.
3. When the truck leaves, taps "Mark dispatched" → `dispatched_at` is set on the load.

A job can have multiple loads dispatched on different days. A job is fully dispatched when all marks have a `dispatched_at` dispatch load. The shop board shows partial dispatch progress: "Load 1 dispatched (24 marks), Load 2 pending (8 marks)."

### `fab_dispatch_loads` table

```sql
CREATE TABLE fab_dispatch_loads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fab_job_id    uuid NOT NULL REFERENCES fab_jobs(id) ON DELETE CASCADE,
  load_number   integer NOT NULL,
  description   text,              -- "columns and beams", "base plates load 2"
  planned_date  date,
  dispatched_at timestamptz,       -- set when the load physically leaves
  driver        text,
  note          text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fab_job_id, load_number)
);
```

`fab_marks.dispatch_load_id` links each mark to its load.

---

## 5. Hub progress feed

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
  marks_qc_passed      integer NOT NULL DEFAULT 0,   -- fully approved
  marks_dispatched     integer NOT NULL DEFAULT 0,   -- in a dispatched load
  pct_complete         integer NOT NULL DEFAULT 0,   -- qc_passed / total * 100
  inhouse_total        integer NOT NULL DEFAULT 0,
  inhouse_complete     integer NOT NULL DEFAULT 0,   -- done or qc_passed
  rework_total         integer NOT NULL DEFAULT 0,   -- rework_count > 0
  contractor_packages  jsonb NOT NULL DEFAULT '[]',
  dispatch_loads       jsonb NOT NULL DEFAULT '[]',
  narrative            text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress','complete','dispatch_ready','dispatched')),
  UNIQUE (fab_job_id)
);
```

`contractor_packages` JSONB shape (one element per package):

```json
{
  "package_id": "uuid",
  "package_type": "treatment",
  "treatment_type": "hdg",
  "contractor_name": "Queensland Galvanising",
  "scope_note": "HDG all columns",
  "total_marks": 8,
  "marks_done": 8,
  "pct": 100,
  "status": "inspected",
  "last_update_date": "2026-06-25",
  "last_update_note": "All 8 back and QC passed",
  "expected_return_date": "2026-06-27",
  "returned_at": "2026-06-27"
}
```

`dispatch_loads` JSONB shape:

```json
{
  "load_number": 1,
  "description": "columns and beams",
  "total_marks": 24,
  "dispatched_at": "2026-06-27",
  "planned_date": "2026-06-27"
}
```

### Narrative auto-generation

A server-side function (`lib/fab-narrative.ts`) builds a plain-English paragraph from the snapshot:

- In-house: "In-house fabrication X% complete (Y/Z marks)."
- Each contractor package: `"{name} — {scope}: {status_phrase}."` where:
  - sent, no updates: "sent {date}, awaiting update"
  - in_progress with pct: "X% per call {date}, ETA {eta}"
  - returned: "received back {date}, pending QC inspection"
  - inspected: "complete and QC approved"
- Rework: if `rework_total > 0`: "Note: {N} mark(s) required rework."
- Dispatch: "Load 1 dispatched {date} ({N} marks). Load 2 planned {date} ({M} marks)."
- Close: "On track for on-site date" if `on_site_date` > today+7, otherwise "on-site date approaching."

### When the snapshot is written

After any of these events:
- Worker ticks a mark done or in-progress via kiosk
- Supervisor assigns/removes marks from a contractor package
- Supervisor marks a package as sent, returned, or inspected
- Supervisor logs a contractor update (phone call)
- Supervisor passes or fails a QC inspection
- Supervisor assigns marks to a dispatch load
- Supervisor marks a load as dispatched

Hub reads `flow_fab_progress` — it never reads `fab_jobs`, `fab_marks`, `fab_contractor_packages`, or `fab_qc_events` directly.

---

## API routes (new and changed)

| Route | Method | Description |
|---|---|---|
| `/api/fab/pin/verify` | POST | Verify PIN, return worker info |
| `/api/fab/pin/workers` | GET/POST | Admin: list/add workers to PIN roster |
| `/api/fab/pin/workers/[id]` | PATCH/DELETE | Admin: update/deactivate a PIN |
| `/api/fab/kiosk/my-work` | GET | Worker's tasks + in-house marks (PIN session) |
| `/api/fab/jobs/[id]/contractor-packages` | GET/POST | List or create contractor packages |
| `/api/fab/contractor-packages/[id]` | PATCH | Update package status/details |
| `/api/fab/contractor-packages/[id]/marks` | POST | Assign/remove marks from package |
| `/api/fab/contractor-packages/[id]/updates` | POST | Log a phone call / event update |
| `/api/fab/jobs/[id]/qc` | POST | Bulk QC pass or fail on mark list |
| `/api/fab/jobs/[id]/dispatch-loads` | GET/POST | List or create dispatch loads |
| `/api/fab/dispatch-loads/[id]` | PATCH | Update load (assign marks, mark dispatched) |
| `/api/fab/jobs/[id]/marks` | PATCH | Existing — also triggers progress snapshot |

All existing routes remain unchanged. The progress snapshot write is a side-effect call inside each API handler.

---

## Pages (new and changed)

| Page | Description |
|---|---|
| `/kiosk` | PIN entry screen — public, no auth |
| `/kiosk/work` | Worker's tasks and marks — PIN session only |
| `/kiosk/supervisor` | Simplified supervisor panel (packages, QC, updates) |
| `/admin/workers` | PIN roster management (add/edit/deactivate) |
| `/jobs/[id]` | Existing — Subs tab → Packages tab; new QC tab; new Dispatch tab |

### New tabs on `/jobs/[id]`

**Packages tab** (replaces Subs): list of contractor packages with status, mark counts, last update. Create package, assign marks, log phone call update.

**QC tab**: shows all `done` and `returned` marks awaiting inspection. Bulk approve or single reject with defect form. Rework history visible per mark (rework count + last note).

**Dispatch tab**: shows `qc_passed` marks not yet in a load. Create load, assign marks, mark dispatched. Dispatched loads listed below with date and mark count.

---

## SQL migration

`002-fab-phase2.sql` — idempotent, applied by hand to gqtikz (`gqtikzguvhukpujyxkez`).

Creates:
- `fab_pins`
- `fab_contractor_packages`
- `fab_contractor_updates`
- `fab_qc_events`
- `fab_dispatch_loads`

Alters:
- `fab_marks` — add `contractor_package_id`, `assigned_to`, `rework_count`, `rework_note`, `dispatch_load_id`
- `fab_marks` — update status CHECK to include `qc_passed` (drop+recreate constraint)

Creates:
- `flow_fab_progress`

RLS on all new tables: authenticated can SELECT, service_role has full access.

---

## What is NOT in this spec

- Contractor self-reporting portal (supervisor phone-call log only)
- Worker timesheets via kiosk (existing time-log tab on PC covers this)
- Dollar visibility on the kiosk (no financials anywhere in fab UI)
- CC compliance enforcement gate (schema ready via `compliance_mode`; enforcement is Phase 3)
- Automated Hub event push (Hub reads `flow_fab_progress` table directly; no webhook)
