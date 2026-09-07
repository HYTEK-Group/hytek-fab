# `flow_fab_entries` and `flow_fab_progress` are the Hub's tables

**Moved out of fab on 07/09/2026 (Lane 7 CP2).** Nothing to run here — this file
exists so the next person who greps `sql/` for `flow_fab_progress` and finds a
`CREATE TABLE` in this repo does not conclude fab owns it.

## Where the DDL actually belongs

| Table | CREATE lived in | Real owner |
|---|---|---|
| `flow_fab_entries` | `hytek-hub/sql/flow/008-fab-weekly.sql` — never in this repo at all | hytek-hub |
| `flow_fab_progress` | `hytek-fab/sql/002-fab-phase2.sql` and `sql/004-fab-ss-ingest.sql` — **the wrong home** | hytek-hub |

`sql/002-fab-phase2.sql` and `sql/004-fab-ss-ingest.sql` are **frozen** and have
not been edited: they are the historical record of what was applied, and
rewriting applied SQL to match a later decision is how a schema stops matching
the database. Read them as history, not as a claim of ownership.

Lane 2 carries the request to move the `flow_fab_progress` CREATE under
`hytek-hub/sql/` and mark fab's copies `moved` in `sql/RECONCILIATION.md`.

## Why they left

The Hub is the only reader of both:

- `hytek-hub/lib/flow/signals/job-state.ts` reads `flow_fab_progress`
- `hytek-hub/lib/flow/buffer-snapshot.ts` reads `flow_fab_progress`
- `hytek-hub/lib/flow/fab-weeks.ts` reads `flow_fab_entries`

fab wrote them from fourteen places (one tonnes insert, thirteen routes calling
`computeAndUpsertProgress`). One writer per table is the rule; the writer of a
table the Hub reads and fab does not is the Hub.

fab now sends `fab_tonnes` and `fab_progress` through `POST /api/flow/event`
with `HUB_TOKEN_FAB`, and the Hub writes its own tables.

## What stops it coming back

Three things, none of them a comment:

1. `SYSTEM.md` `tables.owns` no longer lists either table, so
   `npm run test:architecture` fails on any re-added write (the scanner counts
   write targets: 21 before this change, 19 after).
2. `src/lib/__tests__/no-hub-table-writes.test.ts` names both tables explicitly,
   so re-adding the write and the passport line together still fails.
3. Lane 13's `app_fab` Postgres role is not granted INSERT/UPDATE on either
   table. **That is the only one of the three that is an impossibility rather
   than a check** — until it lands, fab still runs on the service-role key,
   which bypasses grants entirely. Owner: Lane 13, at cutover.

A `revoke ... from authenticated` in a migration here would have been theatre:
fab has never used the `authenticated` grant on these tables, so revoking it
changes nothing and would have read like a protection that was not there. That
is the exact failure `hytek-brain/findings/2026-09-05-architecture-review/WHY-IT-DRIFTED.md`
is about, so it was not written.
