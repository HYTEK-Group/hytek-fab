// Sentry delivery proof — Lane 0 CP3.
//
// TEMPORARY. **Lane 13 deletes this route at cutover** (owner: Lane 13, on or
// before 31/10/2026). It exists for one reason: to prove that an error raised in
// THIS deployment actually arrives in Sentry, because until CP3 nothing in the
// suite had a guaranteed delivery channel — the Hub had Sentry wired and an empty
// DSN, and the other six apps had nothing at all (MASTER-BRIEF fault 7).
//
// It sends a fixed message, never real data, and it is gated on CRON_SECRET.
//
// FAILS CLOSED, twice. With CRON_SECRET unset it refuses everything: an
// unconfigured deployment must not expose an unauthenticated endpoint that makes
// the app talk to a third party. With no DSN it answers 503 and says so, rather
// than returning 200 for a message that was never sent.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/health/sentry-test
import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The app this deployment is, as it appears in Sentry. One per repo.
const APP_NAME = 'hytek-fab'

// Compare without leaking how far a guess matched. The loop always runs over the
// longer of the two, and the length difference is folded into the same accumulator,
// so neither the secret's length nor its prefix is recoverable from timing.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export async function GET(req: Request) {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment — this route is closed' },
      { status: 503 },
    )
  }
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!constantTimeEqual(header.slice('Bearer '.length).trim(), secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) {
    return NextResponse.json(
      { ok: false, app: APP_NAME, sent: false, error: 'NEXT_PUBLIC_SENTRY_DSN is not set — Sentry is inert here' },
      { status: 503 },
    )
  }

  const eventId = Sentry.captureMessage(`sentry wired: ${APP_NAME}`)
  await Sentry.flush(5000)
  return NextResponse.json({ ok: true, app: APP_NAME, sent: true, eventId })
}
