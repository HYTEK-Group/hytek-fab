// POST /api/fab/exceptions/[id]/clear — a SECOND admin acknowledges an exception.
//   [id] = the fab_events id of the raised exception. { note?: string }.
// Four-eyes: the clearer must be an ADMIN, authenticated via a Supabase LOGIN (not
// a shared kiosk PIN — oversight is an office action), and not the person who
// raised it. The clear is written as its own append-only fab_events row, so it
// can't be undone.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getFabUser } from '@/lib/get-fab-user'
import { logException } from '@/lib/fab-events-log'
import { isExceptionKind, canClearException, CLEAR_KIND, type Identity } from '@/lib/fab-gatekeeper'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Login-only (no kiosk token): clearing is an office oversight action, and it
  // keeps the clearer's identity in the one namespace we can compare reliably.
  const user = await getFabUser(req)
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Only an admin can clear an exception.' }, { status: 403 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { note?: string }

  const admin = getSupabaseAdmin()

  // Load the raised exception event.
  const { data: raised, error: rErr } = await admin
    .from('fab_events').select('id, fab_job_id, kind, actor, detail, created_at').eq('id', id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!raised) return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
  if (!isExceptionKind(raised.kind)) return NextResponse.json({ error: 'That event is not an exception' }, { status: 400 })

  // Already cleared? (a prior exception_cleared pointing at this id)
  const { data: existingClear, error: cErr } = await admin
    .from('fab_events').select('id').eq('kind', CLEAR_KIND).eq('detail->>cleared_event_id', id).limit(1)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Reconstruct WHO raised it — a namespaced identity stamped into the detail.
  const rd = (raised.detail ?? {}) as { _by_key?: string; _by_ns?: string }
  const raisedBy: Identity = {
    key: typeof rd._by_key === 'string' ? rd._by_key : '',
    ns: rd._by_ns === 'kiosk' ? 'kiosk' : 'supabase',
    name: raised.actor,
  }
  const clearer: Identity = { key: `sb:${user.id}`, ns: 'supabase', name: user.fullName ?? user.email ?? user.id }

  const gate = canClearException({
    clearer, raisedBy, clearerRole: user.role,
    alreadyCleared: (existingClear ?? []).length > 0,
  })
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 })

  const note = (body.note ?? '').trim()
  const { error: logErr } = await logException(admin, clearer, {
    fab_job_id: raised.fab_job_id, kind: CLEAR_KIND,
    detail: { cleared_event_id: id, of_kind: raised.kind, note: note || null },
  })
  if (logErr) return NextResponse.json({ error: 'Could not record the clearance.' }, { status: 500 })

  return NextResponse.json({ ok: true, cleared_by: clearer.name })
}
