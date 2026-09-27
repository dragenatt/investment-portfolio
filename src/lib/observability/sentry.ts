// Sentry, loaded when there is somewhere to send something — not at boot.
//
// The SDK is 1.65 MB of server JavaScript — Sentry and the OpenTelemetry
// instrumentation it carries, two chunks of the build. It was imported at the
// top of api/handler.ts and api/response.ts, which every API route goes
// through, and of instrumentation.ts, which Next loads once per server instance
// before the first request. Every cold start of every function paid it.
//
// Measured on the built app: a fresh server, one warm-up page request, then the
// first request to an API route. Three runs each, with the static import and
// without it: 77.6 / 72.1 / 73.1 ms against 33.5 / 36.9 / 33.7 ms. About 40 ms,
// on a laptop with a warm filesystem — a Vercel instance starts on a slower CPU
// with a cold one, and it starts often: functions are reclaimed when idle, so
// with a handful of users most visits are a cold start. This app's own field
// data puts the dashboard's first byte at 4.0 s p75, and production measured
// directly gave 1.94 s on the first request against 0.49 s on the next two.
//
// And with no SENTRY_DSN configured, all of it was paid for an SDK that
// initialises itself into a no-op and reports nothing at all.
//
// Behaviour with a DSN set is unchanged: the first report of an instance pays
// the import, every one after it is free. Without a DSN nothing is imported.

import type * as Sentry from '@sentry/nextjs'

type ExceptionContext = Parameters<typeof Sentry.captureException>[1]
type MessageContext = Parameters<typeof Sentry.captureMessage>[1]

/** Whether anything is configured to receive reports. */
export function reportingEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN)
}

/**
 * Await this where the call site can (an async catch): on a serverless platform
 * the instance can be frozen the moment the response is returned, and a report
 * that has not been handed to the SDK yet is lost. Awaiting the capture is what
 * the eager import did implicitly.
 *
 * It never throws. A failure to report an error must not become the error.
 */
export async function reportException(err: unknown, context?: ExceptionContext): Promise<void> {
  if (!reportingEnabled()) return
  try {
    const sentry = await import('@sentry/nextjs')
    sentry.captureException(err, context)
  } catch (importFailed) {
    console.error('[observability] could not report an exception:', importFailed)
  }
}

/** The same, for a message. */
export async function reportMessage(message: string, context?: MessageContext): Promise<void> {
  if (!reportingEnabled()) return
  try {
    const sentry = await import('@sentry/nextjs')
    sentry.captureMessage(message, context)
  } catch (importFailed) {
    console.error('[observability] could not report a message:', importFailed)
  }
}
