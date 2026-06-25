# hytek-fab

Structural steel fabrication management for HYTEK Framing. Jobs from drawings-issued → material receipt → shop-floor → surface treatment → sub packages → dispatch. Mobile-first PWA for the workshop; desktop budget dashboard for Scott + supervisor.

Part of the HYTEK app suite (hub-and-spoke through `hytek-hub`). See `CLAUDE.md` for the full contract, standing rules, and the cross-app data flow.

## Status
- v1 app code: in progress.
- **Database schema: HELD for Scott** — `sql/001-fab-schema.sql` targets the shared `gqtikz` DB and must not be run without his OK (one person on the DB at a time). Until it's applied, the screens show a "schema not applied yet" hint instead of crashing.

## Develop
```bash
npm install
# .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=https://gqtikzguvhukpujyxkez.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<gqtikz anon key>
node scripts/whichdb.mjs   # must confirm ref gqtikzguvhukpujyxkez before any SQL
npm run dev                # http://localhost:3000
npm run build              # production build
```

## Screens (v1)
| Route | Purpose | Status |
|---|---|---|
| `/` | Job register | built |
| `/ready` | Ready-to-fab queue | built |
| `/jobs/[id]` | Job detail (Overview / Budget; Marks / Sub packages / Treatment = wk2) | built (partial) |
| `/jobs/[id]/receive` | Material receipt | wk2 |
| `/tonnes` | Weekly SS tonnes → `flow_fab_entries` | wk2 |

Auth: `admin@hytekframing.com.au` / `Hytek2026`.
