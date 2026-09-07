// POST /api/fab/ingest — the Hub outbox's door into fab.
//
// The gate is copied from hytek-lws src/app/api/import/route.ts, deliberately
// verbatim in shape: it fails CLOSED on an unset secret and compares in constant
// time. One door pattern across the suite is worth more than two clever ones.
//
// WHAT COMES BACK, AND WHAT IT MEANS TO THE WORKER. The outbox worker's retry
// rule is "5xx and transport errors retry, 4xx does not, and a 4xx red-cards a
// person". So this route is careful about which it returns:
//
//   200 {ok:true, …}          applied, duplicate, stale, or a verb fab does not
//                             handle. All four are healthy outcomes.
//   401                       bad or missing secret.
//   400                       a MALFORMED envelope — the Hub's own bug, and the
//                             one thing a person should be told about.
//   500                       a database fault. The worker retries; that is the
//                             correct answer to a transient failure.
//
// An unknown verb is 200/ignored, never 400. A 400 there would make the worker
// retry a perfectly healthy delivery three times and then red-card a subscriber
// that is working — which teaches people to ignore red cards.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  decideQueue,
  decideTask,
  isQueueEvent,
  normaliseFabEnvelope,
  type FabEnvelope,
  type ReadyQueueRow,
} from '@/lib/fab-ingest'
import { logFabEvent } from '@/lib/fab-events-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Shared-secret gate. FAIL CLOSED on an unset secret; constant-time compare. */
function isAuthorized(req: Request): boolean {
  const expected = process.env.FAB_IMPORT_SECRET?.trim()
  if (!expected) return false // no secret configured → deny everything
  const provided = req.headers.get('x-fab-import-secret')?.trim()
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false // timingSafeEqual throws on a mismatch
  return timingSafeEqual(a, b)
}

type Admin = ReturnType<typeof getSupabaseAdmin>

/** The queue half: job.released (SS), materials.received, job.revised. */
async function applyToQueue(admin: Admin, env: FabEnvelope) {
  const { data: existing, error: readErr } = await admin
    .from('fab_ready_queue')
    .select(
      'quote_number, hubspot_deal_id, ss_release_version, ss_released_at, ss_released_by, materials_received, materials_received_at, on_site_date, last_event_at, consumed_at, is_test',
    )
    .eq('quote_number', env.quote_number)
    .maybeSingle()
  if (readErr) return { status: 500 as const, body: { ok: false, error: readErr.message } }

  const decision = decideQueue(env, (existing ?? null) as ReadyQueueRow | null)
  if (decision.action === 'ignored') {
    return { status: 200 as const, body: { ok: true, ignored: decision.reason } }
  }
  if (decision.action === 'stale') {
    return { status: 200 as const, body: { ok: true, stale: true } }
  }

  const { error } = await admin
    .from('fab_ready_queue')
    .upsert(decision.patch, { onConflict: 'quote_number' })
  if (error) return { status: 500 as const, body: { ok: false, error: error.message } }
  return { status: 200 as const, body: { ok: true, applied: env.event, quote_number: env.quote_number } }
}

/** The fab_tasks half: the five rework/variation verbs. */
async function applyToTasks(admin: Admin, env: FabEnvelope) {
  // Only a raise needs the job; a close/reopen filters on rework_id and works
  // whether or not fabrication ever started.
  let fabJobId: string | null = null
  if (env.event === 'rework.raised' || env.event === 'variation.raised') {
    const { data, error } = await admin
      .from('fab_jobs')
      .select('id')
      .eq('quote_number', env.quote_number)
      .maybeSingle()
    if (error) return { status: 500 as const, body: { ok: false, error: error.message } }
    fabJobId = (data as { id?: string } | null)?.id ?? null
  }

  const decision = decideTask(env, fabJobId)
  if (decision.action === 'ignored') {
    return { status: 200 as const, body: { ok: true, ignored: decision.reason } }
  }

  if (decision.action === 'insert') {
    // Idempotency for a redelivered raise. The Hub's own guard used
    // install_budget_items as a sentinel and admitted in a comment that it
    // missed the case where install was not affected; here the check is on the
    // very table being written, so it cannot miss.
    const { data: dup, error: dupErr } = await admin
      .from('fab_tasks')
      .select('id')
      .eq(decision.key.column, decision.key.value)
      .limit(1)
      .maybeSingle()
    if (dupErr) return { status: 500 as const, body: { ok: false, error: dupErr.message } }
    if (dup) return { status: 200 as const, body: { ok: true, duplicate: true } }

    const { data, error } = await admin.from('fab_tasks').insert(decision.row).select('id').maybeSingle()
    if (error) return { status: 500 as const, body: { ok: false, error: error.message } }
    return { status: 200 as const, body: { ok: true, applied: env.event, fab_task_id: (data as { id?: string } | null)?.id ?? null } }
  }

  if (decision.action === 'close') {
    // The secondary `.neq('status','done')` is the Hub's, and it matters: a
    // second closure event must find nothing to update rather than rewrite
    // completed_at to "now" over the stamp the office already recorded.
    const { data, error } = await admin
      .from('fab_tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq(decision.column, decision.value)
      .neq('status', 'done')
      .select('id')
    if (error) return { status: 500 as const, body: { ok: false, error: error.message } }
    return { status: 200 as const, body: { ok: true, applied: env.event, closed: data?.length ?? 0 } }
  }

  const { data, error } = await admin
    .from('fab_tasks')
    .update({ status: 'open', completed_at: null })
    .eq(decision.column, decision.value)
    .eq('status', 'done')
    .select('id')
  if (error) return { status: 500 as const, body: { ok: false, error: error.message } }
  return { status: 200 as const, body: { ok: true, applied: env.event, reopened: data?.length ?? 0 } }
}

export async function POST(req: Request) {
  // Gate BEFORE any parsing or database work — an unauthorized caller does none.
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 })
  }

  const parsed = normaliseFabEnvelope(raw)
  if (!parsed.ok) {
    if (parsed.kind === 'ignored') {
      return NextResponse.json({ ok: true, ignored: parsed.event }, { status: 200 })
    }
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }
  const env = parsed.env

  const admin = getSupabaseAdmin()
  const result = isQueueEvent(env.event)
    ? await applyToQueue(admin, env)
    : await applyToTasks(admin, env)

  // A database fault is worth a person's attention, and the Exceptions screen is
  // where fab's people already look. Best-effort: the worker's retry is the real
  // recovery, and failing to log must not turn a 500 into a crash.
  if (result.status === 500) {
    await logFabEvent(admin, {
      fab_job_id: null,
      kind: 'hub_ingest_failed',
      actor: 'hub-outbox',
      detail: { event: env.event, event_id: env.event_id, quote_number: env.quote_number, error: result.body.error },
    }).catch(() => undefined)
  }

  return NextResponse.json(result.body, { status: result.status })
}
