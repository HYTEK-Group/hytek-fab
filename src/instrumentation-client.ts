// Sentry browser init. Inert until NEXT_PUBLIC_SENTRY_DSN is set. Crash reports
// only (decision #6, 15/09/2026): no performance tracing, no session replay
// (it would record staff sessions of finance screens), scrubbed on the way out.
import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from './lib/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubEvent(event),
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
