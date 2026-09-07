import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

// Only wrap the build with Sentry when a DSN is configured. Until then the
// build is byte-identical to before — so merging this is safe, and turning
// Sentry ON (adding NEXT_PUBLIC_SENTRY_DSN in Vercel) is the step that engages
// it. Source-map upload also needs SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN.
const sentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
    })
  : nextConfig;
