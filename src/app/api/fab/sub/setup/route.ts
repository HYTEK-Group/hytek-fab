// POST /api/fab/sub/setup — ONE-SHOT PIN creation: { slug, pin } → sub token.
// Only works while the account has NO pin_hash (first open of the invite link).
// The conditional update (.is('pin_hash', null)) makes it race-safe: two
// simultaneous setups can't both win, and once a PIN exists the link alone can
// never reset it — only HYTEK can (new invite / office reset).
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSubToken } from '@/lib/fab-sub-token'
import { hashPin, isValidPinFormat } from '@/lib/fab-pin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { slug?: string; pin?: string }
  const slug = (body.slug ?? '').trim()
  const pin = body.pin ?? ''
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: account } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, pin_hash, is_active')
    .eq('login_slug', slug)
    .single()
  if (!account || !account.is_active) {
    return NextResponse.json({ error: 'Link not recognised — ask HYTEK for a new invite' }, { status: 401 })
  }
  if (account.pin_hash) {
    return NextResponse.json({ error: 'PIN already set — sign in with your PIN' }, { status: 409 })
  }

  const pin_hash = await hashPin(pin)
  const { data: updated, error } = await admin
    .from('fab_sub_accounts')
    .update({ pin_hash, updated_at: new Date().toISOString() })
    .eq('id', account.id)
    .is('pin_hash', null) // one-shot: loses the race gracefully
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'PIN already set — sign in with your PIN' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    token: createSubToken(account.id, account.contractor_name),
    contractor_name: account.contractor_name,
  })
}
