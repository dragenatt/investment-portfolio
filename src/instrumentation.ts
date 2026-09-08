// Server instrumentation entry point.
//
// Next 16 calls register() once per server instance, before it serves any
// request, and onRequestError for every server-side error it captures. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Catches unhandled errors from route handlers and server components alike, so
// nothing is lost in the routes that apiHandler does not wrap.
export const onRequestError = Sentry.captureRequestError
