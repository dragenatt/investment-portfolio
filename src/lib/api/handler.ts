import { error } from '@/lib/api/response'

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>

/**
 * Wraps an API route handler with try/catch so that any unhandled
 * exception returns a proper JSON response instead of an HTML error page.
 * This prevents the client fetcher from receiving non-JSON and throwing
 * a generic "Error del servidor" message.
 */
export function apiHandler(handler: RouteHandler): RouteHandler {
  return async (req: Request, ctx?: unknown) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      console.error(`[API ${req.method} ${new URL(req.url).pathname}]`, err)
      const message =
        err instanceof Error ? err.message : 'Error interno del servidor'
      return error(message, 500)
    }
  }
}
