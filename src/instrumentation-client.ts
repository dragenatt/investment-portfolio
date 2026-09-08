// Browser instrumentation entry point.
//
// This is where client-side Sentry lives in Next 16: sentry.client.config.ts is
// the older convention, superseded by instrumentation-client.ts, which runs
// before the app becomes interactive. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md
//
// The browser can only read NEXT_PUBLIC_ variables, so the client DSN is a
// separate one from the server's SENTRY_DSN.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
})

// Lets Sentry tie a client-side error to the navigation that caused it.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
