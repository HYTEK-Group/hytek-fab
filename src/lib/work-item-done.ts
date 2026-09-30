// "Fabrication's part of a variation / rework is done" — told to the Hub.
//
// WHY (30/09/2026 audit). The Hub raises a variation or rework into fab through
// POST /api/fab/ingest as a `fab_tasks` row. Closing that task told the Hub
// nothing, so it could never know fab had finished its share.
//
// HOW. Closing one (PATCH /api/fab/jobs/[id]/tasks/[tid] or
// /api/fab/waiting-tasks/[tid], status 'done') stamps
// `fab_tasks.work_item_done_owed_at` (sql/migrations/017). flushOwedWorkItems
// sends every stamped task through the one door (src/lib/hub-events.ts,
// HUB_TOKEN_FAB, verb `work_item_done`) and clears the stamp only when the Hub
// has taken it. It runs right after the close — which is the send that
// records a failure on the Exceptions screen — and again, quietly, on every
// load of the Jobs list and the waiting list, because fab has no cron. A Hub
// that is down or does not know the verb yet (400) is simply tried again.
// Reopening the task before the send wipes the debt (the PATCH clears it).
//
// A task the HUB closed (rework.resolved / variation.status_changed) is never
// stamped — the Hub already knows.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FabEventBody } from './hub-event-builders'
import { sendFabEvent, sendFabEventLogged, type SendResult } from './hub-events'

export interface WorkItemRow {
  variation_id?: string | null
  rework_id?: string | null
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Which Hub item a task is fab's share of, or null for an ordinary task. */
export function workItemOf(row: WorkItemRow | null | undefined): { kind: 'variation' | 'rework'; itemId: string } | null {
  if (!row) return null
  const rw = clean(row.rework_id)
  if (rw) return { kind: 'rework', itemId: rw }
  const v = clean(row.variation_id)
  if (v) return { kind: 'variation', itemId: v }
  return null
}

export interface WorkItemDoneInput {
  quoteNumber: string | null | undefined
  row: WorkItemRow
  doneAt: string
  /** Hours logged against the task (fab_time_entries.task_id). Omitted when 0/unknown. */
  actualHours?: number | null
}

export type WorkItemDoneBuild =
  | { ok: true; event: FabEventBody }
  | { ok: false; reason: 'not_a_work_item' | 'no_job_number' }

/** PURE. The agreed body: {event, quote_number, idempotency_key, payload:{kind,
 *  item_id, department:'fabrication', done_at, actual_hours?}}. */
export function buildWorkItemDoneEvent(input: WorkItemDoneInput): WorkItemDoneBuild {
  const item = workItemOf(input.row)
  if (!item) return { ok: false, reason: 'not_a_work_item' }
  const quote = clean(input.quoteNumber)
  if (!quote) return { ok: false, reason: 'no_job_number' }
  const payload: FabEventBody['payload'] = {
    kind: item.kind,
    item_id: item.itemId,
    department: 'fabrication',
    done_at: input.doneAt,
  }
  const hours = Number(input.actualHours)
  if (Number.isFinite(hours) && hours > 0) payload.actual_hours = Math.round(hours * 100) / 100
  return {
    ok: true,
    event: {
      event: 'work_item_done',
      quote_number: quote,
      deal_id: null,
      occurred_at: input.doneAt,
      payload,
      idempotency_key: `work-item-done:${item.kind}:${item.itemId}:fabrication`,
    },
  }
}

/** PURE. Hours per task from fab_time_entries rows. */
export function hoursByTask(entries: { task_id: string | null; hours: number | null }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    if (!e.task_id) continue
    const h = Number(e.hours)
    if (!Number.isFinite(h)) continue
    out.set(e.task_id, (out.get(e.task_id) ?? 0) + h)
  }
  return out
}

interface OwedTask {
  id: string
  fab_job_id: string | null
  quote_number: string | null
  variation_id: string | null
  rework_id: string | null
  completed_at: string | null
  work_item_done_owed_at: string
  fab_jobs?: { quote_number: string | null } | null
}

export interface FlushResult {
  sent: number
  failed: number
  dropped: number
}

/**
 * Send every work_item_done fab owes. Never throws.
 * `logFor` — the one task whose failure should land on the Exceptions screen
 * (the task just closed). Retries of older debts fail quietly: one exception
 * row per page load would teach people to ignore the screen.
 */
export async function flushOwedWorkItems(
  admin: SupabaseClient,
  opts: { logFor?: string; actor?: string } = {},
): Promise<FlushResult> {
  const out: FlushResult = { sent: 0, failed: 0, dropped: 0 }
  try {
    const { data, error } = await admin
      .from('fab_tasks')
      .select('id, fab_job_id, quote_number, variation_id, rework_id, completed_at, work_item_done_owed_at, fab_jobs(quote_number)')
      .not('work_item_done_owed_at', 'is', null)
      .order('work_item_done_owed_at', { ascending: true })
      .limit(25)
    if (error) { console.error('[work-item-done] could not read owed tasks:', error.message); return out }
    const rows = (data ?? []) as unknown as OwedTask[]
    if (rows.length === 0) return out

    const { data: entries } = await admin
      .from('fab_time_entries')
      .select('task_id, hours')
      .in('task_id', rows.map(r => r.id))
    const hours = hoursByTask((entries ?? []) as { task_id: string | null; hours: number | null }[])

    for (const row of rows) {
      const built = buildWorkItemDoneEvent({
        quoteNumber: row.fab_jobs?.quote_number ?? row.quote_number,
        row,
        doneAt: row.completed_at || row.work_item_done_owed_at,
        actualHours: hours.get(row.id),
      })
      let clear = false
      if (!built.ok) {
        console.warn(`[work-item-done] fab_task ${row.id}: ${built.reason} — nothing can be sent, stamp cleared`)
        out.dropped++
        clear = true
      } else {
        const res: SendResult = row.id === opts.logFor
          ? await sendFabEventLogged(admin, built.event, row.fab_job_id, opts.actor ?? 'fab')
          : await sendFabEvent(built.event)
        if (res.ok) { out.sent++; clear = true }
        else {
          out.failed++
          console.error(`[work-item-done] Hub did not take ${built.event.idempotency_key} (${res.status}): ${res.error} — retried on the next flush`)
        }
      }
      if (clear) {
        await admin
          .from('fab_tasks')
          .update({ work_item_done_owed_at: null })
          .eq('id', row.id)
          .eq('work_item_done_owed_at', row.work_item_done_owed_at)
      }
    }
  } catch (e) {
    console.error('[work-item-done] flush failed:', e)
  }
  return out
}
