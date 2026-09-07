// GET /api/fab/ready-queue — what fab may start.
//
// WHAT THIS USED TO COST. The old implementation read the shared `jobs` table
// (latest 200), subtracted `fab_jobs`, and then asked the Hub
// `GET /api/flow/job-state/_?quote_number=` ONCE PER CANDIDATE — sequentially,
// up to fifty times — on every page load, for every supervisor, all day. Fifty
// serial HTTP round trips to answer "what may I start?". It is slow, it makes
// fab's screen fail whole whenever the Hub is slow, and it is the Hub carrying
// fab's homework: the outbox already knows the answer at the instant it becomes
// true. `fab_ready_queue` is fab's own copy of that answer, pushed in through
// POST /api/fab/ingest. This route now makes ZERO Hub calls.
//
// The Hub call that REMAINS is on the job page (`getJobState`), where exactly
// one job is in view and the question is about that job. That is the right
// shape for a cross-app read; fifty of them behind a list is not.
//
// READY_QUEUE_SOURCE=hub-poll puts the old path back for one environment. It
// exists because the Hub's `fab` subscriber is still on NOT_WIRED_YET
// (hytek-hub lib/outbox/subscriptions.ts) — until Lane 3 CP5 lands it, nothing
// pushes into fab_ready_queue on production and an empty queue would read as
// "no work", which is exactly the kind of confident lie CP1 removed from
// src/lib/hub.ts. Default is `ingest`, and `readyQueueByPolling` below is
// DELETED the day production flips (Lane 13 cutover step 7 — owner Lane 13, by
// 30/11/2026, the same date the Hub's NOT_WIRED_YET list must be empty).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
// Kiosk tokens too: the ingest bridge asks this route whether a job has been
// released before it starts fabricating it, so it talks to exactly one app.
import { getUserCaller } from '@/lib/fab-auth'
import { getJobStateByQuoteNumber, hubConfigured, HUB_NOT_CONFIGURED } from '@/lib/hub'
import type { ReadyQueueItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof getSupabaseAdmin>

/** Which job identities fab already has, so the queue never offers one twice. */
async function fabQuotes(admin: Admin): Promise<Set<string>> {
  const { data } = await admin.from('fab_jobs').select('quote_number')
  return new Set((data ?? []).map((j: { quote_number: string }) => j.quote_number))
}

/** THE NEW PATH. One read of the queue, one read of `jobs`, no Hub call. */
async function readyQueueFromIngest(admin: Admin): Promise<
  { ok: true; items: ReadyQueueItem[]; note?: string } | { ok: false; error: string }
> {
  const { data: queued, error } = await admin
    .from('fab_ready_queue')
    .select(
      'quote_number, hubspot_deal_id, ss_release_version, ss_released_at, materials_received, on_site_date, last_event_at',
    )
    .is('consumed_at', null)
    .eq('is_test', false)
    .order('last_event_at', { ascending: false })
    .limit(200)
  if (error) return { ok: false, error: error.message }

  const rows = queued ?? []
  if (rows.length === 0) return { ok: true, items: [] }

  const started = await fabQuotes(admin)

  // SELF-HEALING. A job started through Start Fabrication has consumed_at
  // stamped by POST /api/fab/jobs. A job started before this route existed —
  // or by a path that missed the stamp — would sit in the queue forever. Stamp
  // it here, once, rather than filtering it out every time and never fixing it.
  const nowConsumed = rows.filter(r => started.has(r.quote_number as string)).map(r => r.quote_number as string)
  if (nowConsumed.length > 0) {
    await admin
      .from('fab_ready_queue')
      .update({ consumed_at: new Date().toISOString() })
      .in('quote_number', nowConsumed)
      .is('consumed_at', null)
  }

  const open = rows.filter(r => !started.has(r.quote_number as string))
  if (open.length === 0) return { ok: true, items: [] }

  // Names, clients and locations come from `jobs` at READ time, never copied
  // into the queue. A cached name is a name that can disagree with the Hub, and
  // two apps disagreeing about what a job is called is how a reconciliation
  // report becomes unreadable.
  const { data: jobRows, error: jobErr } = await admin
    .from('jobs')
    .select('quote_number, name, client, hubspot_deal_id')
    .in('quote_number', open.map(r => r.quote_number as string))
  if (jobErr) return { ok: false, error: jobErr.message }
  const byQuote = new Map(
    (jobRows ?? []).map((j: Record<string, unknown>) => [j.quote_number as string, j]),
  )

  const items: ReadyQueueItem[] = []
  const orphans: string[] = []
  for (const r of open) {
    const quote = r.quote_number as string
    const job = byQuote.get(quote)
    if (!job) {
      // The Hub told fab about a job that is not in SHARED `jobs`. Report it;
      // never invent a name for it. Start Fabrication would refuse it anyway
      // (src/lib/job-lookup.ts), so offering it would be a dead button.
      orphans.push(quote)
      continue
    }
    const ssReleased = r.ss_released_at != null
    const materials = r.materials_received === true
    items.push({
      quote_number: quote,
      hubspot_deal_id: (job.hubspot_deal_id as string | null) ?? (r.hubspot_deal_id as string | null),
      name: (job.name as string) ?? quote,
      client: (job.client as string | null) ?? null,
      on_site_date: (r.on_site_date as string | null) ?? null,
      ss_drawings_issued: ssReleased,
      materials_received: materials,
      ss_released: ssReleased,
      release_version: (r.ss_release_version as number | null) ?? null,
      ready: ssReleased && materials,
    })
  }

  items.sort((a, b) => Number(b.ready) - Number(a.ready))
  const note =
    orphans.length > 0
      ? `${orphans.length} job${orphans.length === 1 ? '' : 's'} the Hub sent are not in the shared jobs table (${orphans.slice(0, 3).join(', ')}) — raise at the Monday review`
      : undefined
  return { ok: true, items, ...(note ? { note } : {}) }
}

/**
 * THE OLD PATH, kept only until production flips to `ingest`.
 *
 * DELETE THIS FUNCTION, its flag and the two Hub imports at Lane 13 cutover
 * step 7 (owner: Lane 13, by 30/11/2026). It is here so a production deploy of
 * this checkpoint cannot blank the queue screen while the Hub's fab subscriber
 * is still unwired — not because polling is an acceptable long-term shape.
 */
async function readyQueueByPolling(admin: Admin): Promise<
  { ok: true; items: ReadyQueueItem[]; note?: string } | { ok: false; error: string }
> {
  if (!hubConfigured()) return { ok: true, items: [], note: HUB_NOT_CONFIGURED }

  const started = await fabQuotes(admin)
  const { data: allJobs, error } = await admin
    .from('jobs')
    .select('id, quote_number, name, client, location')
    .not('is_test', 'is', true) // test jobs never offered to Start Fabrication
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return { ok: false, error: error.message }

  const candidates = (allJobs ?? []).filter(
    (j: { quote_number: string }) => !started.has(j.quote_number),
  )

  const results: ReadyQueueItem[] = []
  let hubFailures = 0
  for (const job of candidates.slice(0, 50)) {
    const hubRes = await getJobStateByQuoteNumber(job.quote_number)
    if (!hubRes.ok) hubFailures++
    const hubState = hubRes.ok ? hubRes.state : null

    const ssRelease = hubState?.ss_release ?? null
    const ssReleased = ssRelease != null
    const ssDrawingsIssued = ssReleased || (hubState?.ready_to_ship ?? false)
    const materialsReceived = hubState?.materials_received ?? false
    if (!ssDrawingsIssued && !materialsReceived) continue

    results.push({
      quote_number: job.quote_number,
      hubspot_deal_id: hubState?.deal_id ?? null,
      name: job.name,
      client: job.client ?? null,
      on_site_date: hubState?.on_site_date ?? null,
      ss_drawings_issued: ssDrawingsIssued,
      materials_received: materialsReceived,
      ss_released: ssReleased,
      release_version: ssRelease?.version ?? null,
      ready: ssDrawingsIssued && materialsReceived,
    })
  }

  results.sort((a, b) => Number(b.ready) - Number(a.ready))
  const note =
    hubFailures > 0
      ? `Hub did not answer for ${hubFailures} job${hubFailures === 1 ? '' : 's'} — this list is incomplete`
      : undefined
  return { ok: true, items: results, ...(note ? { note } : {}) }
}

export async function GET(req: NextRequest) {
  const user = await getUserCaller(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const source = (process.env.READY_QUEUE_SOURCE ?? 'ingest').trim().toLowerCase()
  const res = source === 'hub-poll' ? await readyQueueByPolling(admin) : await readyQueueFromIngest(admin)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  // `source` is returned so the screen — and anyone reading a support ticket —
  // can tell an empty queue on the new path from an empty queue on the old one.
  return NextResponse.json({ items: res.items, source, ...(res.note ? { note: res.note } : {}) })
}
