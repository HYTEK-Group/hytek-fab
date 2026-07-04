// POST /api/fab/sub/login — subcontractor sign-in: { slug, pin } → sub token.
// The slug is the unguessable token from the invite link (the "username"); the
// PIN is the secret the sub set on first open. Rate-limited per IP with the
// same throttle as the kiosk (fab_pin_attempts): a correct PIN always works
// instantly; wrong guesses get slower.
// Returns 409 { needs_setup: true } when the account exists but has no PIN yet
// (first open) — the page then offers "set your PIN" → POST /api/fab/sub/setup.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createSubToken } from '@/lib/fab-sub-token'
import { verifyPin, isValidPinFormat } from '@/lib/fab-pin'
import {
  countSubFailures, recordSubFailure, clearSubFailures, subFailureDelayMs, isLocked,
} from '@/lib/fab-sub-rate-limit'

export const dynamic = 'force-dynamic'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { slug?: string; pin?: string }
  const slug = (body.slug ?? '').trim()
  const pin = body.pin ?? ''
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { data: account } = await admin
    .from('fab_sub_accounts')
    .select('id, contractor_name, pin_hash, is_active')
    .eq('login_slug', slug)
    .single()

  // Same response for "no such slug" and "deactivated" — don't confirm slugs.
  if (!account || !account.is_active) {
    return NextResponse.json({ error: 'Link not recognised — ask HYTEK for a new invite' }, { status: 401 })
  }

  if (!account.pin_hash) {
    return NextResponse.json({ needs_setup: true, contractor_name: account.contractor_name }, { status: 409 })
  }

  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  // Per-ACCOUNT lockout (the load-bearing defence — IP-independent, so rotating
  // IPs / spoofed XFF can't beat it). Check BEFORE spending a bcrypt compare.
  let failures = 0
  try { failures = await countSubFailures(admin, account.id) } catch { /* fail open on DB hiccup */ }
  if (isLocked(failures)) {
    return NextResponse.json(
      { error: 'Too many wrong PINs — locked for a bit. Ask HYTEK if you are stuck.' },
      { status: 429 },
    )
  }

  const ok = await verifyPin(pin, account.pin_hash)
  if (ok) {
    try { await clearSubFailures(admin, account.id) } catch { /* best-effort */ }
    return NextResponse.json({
      ok: true,
      token: createSubToken(account.id, account.contractor_name),
      contractor_name: account.contractor_name,
    })
  }

  // Wrong PIN: record against the account + throttle (no free first attempt).
  let count = failures + 1
  try { count = await recordSubFailure(admin, account.id) } catch { /* best-effort */ }
  await sleep(subFailureDelayMs(count))
  if (isLocked(count)) {
    return NextResponse.json(
      { error: 'Too many wrong PINs — locked for a bit. Ask HYTEK if you are stuck.' },
      { status: 429 },
    )
  }
  return NextResponse.json({ error: 'PIN not recognised' }, { status: 401 })
}
