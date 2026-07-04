// GET /api/fab/subs-overview — the office "Subcontractors" console: every sub
// firm login with its invite link, PIN status, and the jobs it currently has
// access to (active, non-revoked grants → package + job). Supervisor/admin only.
// One place to see who has app access and cut it off — the per-job invite still
// happens from a job's Packages tab (you release specific pieces to a sub there).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

function inviteLink(req: NextRequest, slug: string): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'hytek-fab.vercel.app'
  return `${proto}://${host}/sub/${slug}`
}

interface PkgJoin {
  id: string
  fab_job_id: string
  delivery_mode: string
  status: string
  ready_at: string | null
  drop_ship_released_at: string | null
  fab_jobs: { quote_number: string; name: string } | { quote_number: string; name: string }[] | null
}

export async function GET(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const { data: accounts, error } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, login_slug, pin_hash, is_active, created_at')
    .order('is_active', { ascending: false })
    .order('contractor_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const subs = []
  for (const a of accounts ?? []) {
    const { data: grants } = await admin
      .from('fab_sub_grants')
      .select('package_id, granted_at, fab_contractor_packages(id, fab_job_id, delivery_mode, status, ready_at, drop_ship_released_at, fab_jobs(quote_number, name))')
      .eq('sub_account_id', a.id)
      .is('revoked_at', null)
      .order('granted_at', { ascending: false })

    const jobs = []
    for (const g of grants ?? []) {
      const raw = (g as unknown as { fab_contractor_packages: PkgJoin | PkgJoin[] | null }).fab_contractor_packages
      const p = Array.isArray(raw) ? raw[0] : raw
      if (!p) continue
      const jraw = p.fab_jobs
      const job = Array.isArray(jraw) ? jraw[0] : jraw
      jobs.push({
        package_id: p.id,
        quote_number: job?.quote_number ?? null,
        job_name: job?.name ?? null,
        delivery_mode: p.delivery_mode,
        status: p.status,
        ready_at: p.ready_at,
        dropship_released: p.drop_ship_released_at != null,
      })
    }

    subs.push({
      id: a.id,
      contractor_name: a.contractor_name,
      is_active: a.is_active,
      pin_set: a.pin_hash != null, // never expose the hash
      created_at: a.created_at,
      invite_link: inviteLink(req, a.login_slug),
      jobs,
    })
  }

  return NextResponse.json({ subs })
}
