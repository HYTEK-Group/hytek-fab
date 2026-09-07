// Sentry server-side init. Inert until NEXT_PUBLIC_SENTRY_DSN is set, so this
// ships safe — no DSN means Sentry sends nothing and the app is unchanged.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  // Light performance sampling; bump if you want more tracing detail.
  tracesSampleRate: 0.1,
})
