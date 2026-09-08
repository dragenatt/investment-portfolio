// Sentry — edge runtime (middleware and any edge route).
//
// Loaded from src/instrumentation.ts when NEXT_RUNTIME is "edge". Same no-op
// behaviour as the server config while SENTRY_DSN is unset.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
})
