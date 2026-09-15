// Sentry edge-runtime init (middleware, edge routes). Inert until
// NEXT_PUBLIC_SENTRY_DSN is set. Crash reports only, scrubbed on the way out
// (decision #6, 15/09/2026).
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
