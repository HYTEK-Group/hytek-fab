// Sentry browser init. Inert until NEXT_PUBLIC_SENTRY_DSN is set. Kept minimal
// — error capture + light tracing, no session replay (avoids recording staff
// sessions of finance/ops screens).
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
