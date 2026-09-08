import * as Sentry from '@sentry/nextjs'
import { error } from '@/lib/api/response'
import { recordApiError } from '@/lib/analytics/errors'

/**
 * Wraps an API route handler with try/catch so that any unhandled
 * exception returns a proper JSON response instead of an HTML error page.
 * This prevents the client fetcher from receiving non-JSON and throwing
 * a generic "Error del servidor" message.
 *
 * The exception is reported to Sentry and to our own error_events table on the
 * way through. Neither changes the response: the frontend keeps receiving the
 * same { data: null, error } shape from lib/api/response.
 *
 * Generic over the handler's own arguments so a dynamic route keeps its typed
 * context (e.g. { params: Promise<{ id: string }> }) instead of widening it.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args) => {
    try {
      return await handler(req, ...args)
    } catch (err) {
      const { pathname } = new URL(req.url)
      console.error(`[API ${req.method} ${pathname}]`, err)

      const message =
        err instanceof Error ? err.message : 'Error interno del servidor'

      // Pathname only, never the query string or body: those carry portfolio
      // ids and user input, and this project sends no PII to Sentry.
      Sentry.captureException(err, {
        tags: { area: 'api', method: req.method },
        extra: { route: pathname },
      })
      recordApiError(pathname, req.method, message)

      return error(message, 500)
    }
  }
}
