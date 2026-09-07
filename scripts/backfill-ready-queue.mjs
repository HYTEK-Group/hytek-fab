#!/usr/bin/env node
// ONE-OFF. Seed fab_ready_queue from what the Hub already knows, so the queue
// screen is not empty on the first deploy of Lane 7 CP3 in an environment.
//
// WHY IT IS NEEDED AT ALL. The outbox only pushes facts that happen AFTER the
// subscriber is wired. Every job released before that day is invisible to fab's
// new queue — not lost, just never announced. This asks the Hub once per
// candidate for the state it would have sent, and writes the rows.
//
// RUN IT ONCE PER ENVIRONMENT, then never again:
//   staging  — after CP3 deploys to hytek-fab-staging
//   prod     — Lane 13 cutover step 7, after the outbox subscriber is on
// DELETE THIS FILE after the production run (owner: Lane 13, by 30/11/2026).
//
// It is slow on purpose: sequential, one Hub call per job, exactly the shape the
// old ready-queue route did on EVERY PAGE LOAD. Run once at 3am, not per user —
// that difference is the whole point of the checkpoint.
//
// ENV (a .env.local next to the repo, or exported):
//   FAB_URL           https://hytek-fab-staging.vercel.app
//   FAB_IMPORT_SECRET the same value the Hub's outbox holds
//   HUB_BASE          https://hytek-hub-staging.vercel.app
//   HUB_TOKEN_FAB     fab's scoped Hub token
// Flags: --limit N (default 200), --dry-run
//
// It writes through POST /api/fab/ingest — the same door the outbox uses — so
// this script holds NO database credential and cannot write a row the live door
// would refuse. That is deliberate: a backfill that bypasses the door is a
// second writer, and a second writer is what this whole lane exists to remove.

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? '') : null }
const has = (n) => args.includes(`--${n}`)

const FAB_URL = (process.env.FAB_URL ?? '').replace(/\/+$/, '')
const FAB_IMPORT_SECRET = (process.env.FAB_IMPORT_SECRET ?? '').trim()
const HUB_BASE = (process.env.HUB_BASE ?? 'https://hub.hytekframing.com.au').replace(/\/+$/, '')
const HUB_TOKEN_FAB = (process.env.HUB_TOKEN_FAB ?? '').trim()
const LIMIT = Number(flag('limit') ?? 200)
const DRY = has('dry-run')

const die = (m) => { console.error(`\n  ${m}\n`); process.exit(2) }
if (!FAB_URL) die('FAB_URL is not set — which fab is this backfilling?')
if (!HUB_TOKEN_FAB) die('HUB_TOKEN_FAB is not set — the Hub will refuse every read')
if (!DRY && !FAB_IMPORT_SECRET) die('FAB_IMPORT_SECRET is not set — the ingest door will answer 401')

/**
 * The candidate list comes from the Hub, not from a direct read of `jobs`:
 * this script must not need a database key. GET /api/flow/job-state/_ answers
 * per job, so the list of jobs to ask about comes from fab's own ready-queue
 * route running in `hub-poll` mode, which is exactly the old behaviour.
 */
async function candidates() {
  const res = await fetch(`${FAB_URL}/api/fab/ready-queue`, {
    headers: { Authorization: `Bearer ${HUB_TOKEN_FAB}` },
  })
  if (!res.ok) die(`fab ready-queue answered ${res.status} — run this with READY_QUEUE_SOURCE=hub-poll on that deploy first`)
  const body = await res.json()
  return (body.items ?? []).slice(0, LIMIT)
}

async function send(item) {
  const body = {
    event_id: `backfill:${item.quote_number}:${item.ss_released ? 'release' : 'materials'}`,
    event_type: item.ss_released ? 'job.released' : 'materials.received',
    quote_number: item.quote_number,
    // Backdated deliberately: a real event that arrives later must WIN over the
    // backfill, and decideQueue compares occurred_at. 2000-01-01 loses to
    // everything.
    occurred_at: '2000-01-01T00:00:00.000Z',
    payload: {
      quote_number: item.quote_number,
      stream: 'SS',
      release_version: item.release_version,
      hubspot_deal_id: item.hubspot_deal_id,
      on_site_date: item.on_site_date,
      is_test: false,
      received_at: '2000-01-01T00:00:00.000Z',
    },
  }
  if (DRY) { console.log(`  would send ${body.event_type} for ${item.quote_number}`); return true }
  const res = await fetch(`${FAB_URL}/api/fab/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fab-import-secret': FAB_IMPORT_SECRET },
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) { console.error(`  ✗ ${item.quote_number}: ${res.status} ${text.slice(0, 200)}`); return false }
  console.log(`  ✓ ${item.quote_number} ${body.event_type}`)
  return true
}

const items = await candidates()
console.log(`\n  ${items.length} job(s) to seed into fab_ready_queue${DRY ? ' (dry run)' : ''}\n`)
let ok = 0
for (const item of items) {
  if (await send(item)) ok++
  // A second event for a job that is BOTH released and materials-in.
  if (item.ss_released && item.materials_received) {
    if (await send({ ...item, ss_released: false })) ok++
  }
}
console.log(`\n  done — ${ok} event(s) accepted\n`)
