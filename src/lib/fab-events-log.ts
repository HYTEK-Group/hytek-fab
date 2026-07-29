// Server-side writer for the append-only fab_events audit log. Thin on purpose:
// the pure logic lives in fab-gatekeeper.ts. Returns the insert error (if any)
// so callers can decide — most audit writes are best-effort, but a few (the
// dispatch override) must fail CLOSED: if we can't record the exception, we
// don't allow the action it justifies.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface FabEventInput {
  fab_job_id: string | null
  kind: string
  actor: string
  detail?: unknown
}

/** Insert one audit event. Never throws; returns {error} for the caller. */
export async function logFabEvent(
  admin: SupabaseClient,
  e: FabEventInput,
): Promise<{ error: { message: string } | null }> {
  const { error } = await admin.from('fab_events').insert({
    fab_job_id: e.fab_job_id,
    kind: e.kind,
    actor: e.actor,
    detail: (e.detail ?? null) as never,
  })
  return { error: error ? { message: error.message } : null }
}

/** Who raised an exception — a namespaced identity, so the four-eyes clear can
 *  tell people apart across the kiosk/login boundary. */
export interface EventActor {
  name: string
  key: string
  ns: 'kiosk' | 'supabase'
}

/** Log an exception event, stamping the raiser's identity into the detail so the
 *  clear route and the report can reconstruct WHO raised it (across namespaces). */
export async function logException(
  admin: SupabaseClient,
  actor: EventActor,
  e: { fab_job_id: string | null; kind: string; detail?: Record<string, unknown> },
): Promise<{ error: { message: string } | null }> {
  return logFabEvent(admin, {
    fab_job_id: e.fab_job_id,
    kind: e.kind,
    actor: actor.name,
    detail: { ...(e.detail ?? {}), _by_key: actor.key, _by_ns: actor.ns },
  })
}
