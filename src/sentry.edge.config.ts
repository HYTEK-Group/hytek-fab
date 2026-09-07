// Sentry edge-runtime init (middleware, edge routes). Inert until
// NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
})
