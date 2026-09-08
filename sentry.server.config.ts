// Sentry — Node server runtime.
//
// Loaded from src/instrumentation.ts when NEXT_RUNTIME is "nodejs".
// The SDK is a no-op while SENTRY_DSN is unset, so local dev and any deploy
// without the secret behave exactly as they did before this was added.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),

  // Free plan budget is 5k errors / 10k spans a month. Sampling traces at 10%
  // keeps the quota available for the errors, which is the point of this setup.
  tracesSampleRate: 0.1,

  // Never ship emails, IPs, cookies or request bodies. The only identifier
  // attached anywhere is the internal Supabase user id.
  sendDefaultPii: false,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
})
