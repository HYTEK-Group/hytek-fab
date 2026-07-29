// GET /api/fab/exceptions — the gatekeeper report. Every open exception (a
// sensitive action awaiting a second admin's clearance) + recently cleared ones,
// across all jobs (or one job via ?job=<fab_job_id>). READ = any signed-in floor
// user; only an admin (and never the person who raised it) can CLEAR one.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { EXCEPTION_KINDS, CLEAR_KIND, foldExceptions, sameHuman, type RawEvent, type Identity } from '@/lib/fab-gatekeeper'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const jobFilter = req.nextUrl.searchParams.get('job')

  const admin = getSupabaseAdmin()
  let q = admin.from('fab_events')
    .select('id, fab_job_id, kind, actor, detail, created_at')
    .in('kind', [...EXCEPTION_KINDS, CLEAR_KIND])
    .order('created_at', { ascending: false })
    .limit(2000)
  if (jobFilter) q = q.eq('fab_job_id', jobFilter)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { open, cleared } = foldExceptions((data ?? []) as RawEvent[])

  // Attach a friendly job label (quote_number — name).
  const jobIds = [...new Set([...open, ...cleared].map(e => e.fab_job_id).filter((x): x is string => !!x))]
  const jobLabel = new Map<string, string>()
  if (jobIds.length > 0) {
    const { data: jobs } = await admin.from('fab_jobs').select('id, quote_number, name').in('id', jobIds)
    for (const j of jobs ?? []) jobLabel.set(j.id, [j.quote_number, j.name].filter(Boolean).join(' — '))
  }
  // Clearing is a Supabase-login admin action (the clear route rejects kiosk
  // tokens), so the button only shows for a logged-in admin who isn't the raiser.
  const viewer: Identity = { key: caller.key, ns: caller.ns, name: caller.name }
  const canClear = caller.ns === 'supabase' && caller.role === 'admin'
  const raiserOf = (e: (typeof open)[number]): Identity => {
    const d = (e.detail ?? {}) as { _by_key?: string; _by_ns?: string }
    return { key: typeof d._by_key === 'string' ? d._by_key : '', ns: d._by_ns === 'kiosk' ? 'kiosk' : 'supabase', name: e.actor }
  }
  const decorate = (e: (typeof open)[number]) => ({
    ...e,
    job_label: e.fab_job_id ? (jobLabel.get(e.fab_job_id) ?? null) : null,
    // A row is clearable only by a login admin who did NOT raise it (four-eyes).
    clearable: canClear && !sameHuman(viewer, raiserOf(e)),
  })

  return NextResponse.json({
    open: open.map(decorate),
    cleared: cleared.map(decorate),
    viewer: { role: caller.role, name: caller.name, is_admin: canClear },
  })
}
