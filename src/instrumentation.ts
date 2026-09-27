// Server instrumentation entry point.
//
// Next 16 calls register() once per server instance, before it serves any
// request, and onRequestError for every server-side error it captures. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
//
// Nothing here imports the Sentry SDK at module scope. register() "must
// complete before the server is ready to handle requests", so whatever it loads
// is part of every cold start — 1.65 MB of JavaScript, on a platform that
// reclaims idle instances, for an SDK that reports nothing at all unless
// SENTRY_DSN is set. See lib/observability/sentry.ts for the measurements.

import { type Instrumentation } from 'next'
import { reportingEnabled } from '@/lib/observability/sentry'

export async function register() {
  if (!reportingEnabled()) return
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Catches unhandled errors from route handlers and server components alike, so
// nothing is lost in the routes that apiHandler does not wrap. Awaited, as the
// documentation requires of async work here.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!reportingEnabled()) return
  const sentry = await import('@sentry/nextjs')
  await sentry.captureRequestError(...args)
}
