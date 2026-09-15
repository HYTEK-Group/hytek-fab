// Sentry server-side init. Inert until NEXT_PUBLIC_SENTRY_DSN is set, so this
// ships safe — no DSN means Sentry sends nothing and the app is unchanged.
//
// Crash reports only, and nothing private in them (decision #6, 15/09/2026):
// no performance tracing, request bodies never read (the SDK's own default
// keeps 10 KB of every body, whatever sendDefaultPii says), and every event
// goes through scrubEvent on the way out.
import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from './lib/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  integrations: [
    // @sentry/nextjs's own default (Next.js instruments incoming requests
    // itself), plus: never buffer a request body.
    Sentry.httpIntegration({ disableIncomingRequestSpans: true, maxIncomingRequestBodySize: 'none' }),
  ],
  beforeSend: (event) => scrubEvent(event),
})
