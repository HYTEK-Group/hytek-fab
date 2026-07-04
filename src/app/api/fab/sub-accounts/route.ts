// GET  /api/fab/sub-accounts — list sub logins (never the pin_hash)
// POST /api/fab/sub-accounts — create (or reuse) a sub firm's login and return
//   its invite link. One login per firm: if an ACTIVE account already exists
//   with this contractor_name, it is returned instead of duplicated — the same
//   sub keeps one PIN across jobs. Supervisor/admin only.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSupervisorCaller } from '@/lib/fab-auth'

export const dynamic = 'force-dynamic'

/** Unguessable URL token for the invite link (~95 bits). */
function newSlug(): string {
  return randomBytes(12).toString('base64url')
}

function inviteLink(req: NextRequest, slug: string): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'hytek-fab.vercel.app'
  return `${proto}://${host}/sub/${slug}`
}

export async function GET(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, login_slug, is_active, created_at, pin_hash')
    .order('contractor_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    accounts: (data ?? []).map(a => ({
      id: a.id,
      contractor_name: a.contractor_name,
      login_slug: a.login_slug,
      is_active: a.is_active,
      created_at: a.created_at,
      pin_set: a.pin_hash != null, // never expose the hash itself
      invite_link: inviteLink(req, a.login_slug),
    })),
  })
}

export async function POST(req: NextRequest) {
  const caller = await getSupervisorCaller(req)
  if (!caller) return NextResponse.json({ error: 'Supervisor or admin required' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { contractor_name?: string }
  const name = (body.contractor_name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'contractor_name required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  // One login per firm — reuse the active account if it exists (case-insensitive).
  // Escape LIKE metacharacters so a name containing % or _ can't wildcard-match
  // a DIFFERENT contractor's login (ilike treats them as patterns).
  const escaped = name.replace(/([%_\\])/g, '\\$1')
  const { data: existing } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, login_slug, pin_hash')
    .ilike('contractor_name', escaped)
    .eq('is_active', true)
    .limit(1)
  if (existing && existing.length > 0) {
    const a = existing[0]
    return NextResponse.json({
      account: {
        id: a.id, contractor_name: a.contractor_name, login_slug: a.login_slug,
        pin_set: a.pin_hash != null, invite_link: inviteLink(req, a.login_slug),
      },
      reused: true,
    })
  }

  const { data: created, error } = await admin
    .from('fab_sub_accounts')
    .insert({ contractor_name: name, login_slug: newSlug(), created_by: caller.name })
    .select('id, contractor_name, login_slug')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    account: {
      id: created.id, contractor_name: created.contractor_name, login_slug: created.login_slug,
      pin_set: false, invite_link: inviteLink(req, created.login_slug),
    },
    reused: false,
  }, { status: 201 })
}
