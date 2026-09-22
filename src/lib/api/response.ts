import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { sanitizeFinancialPayload } from '@/lib/services/validation'

export type ApiResponse<T = unknown> = {
  data: T | null
  error: string | null
  meta?: { total?: number; cursor?: string }
}

/**
 * No response this API builds belongs in a shared cache.
 *
 * Every one of them is either the caller's own data or an answer that depends
 * on whether they are signed in. With no header of its own, a dynamic route
 * inherits the platform's default — which production serves as
 * `public, max-age=0, must-revalidate`, including on a 401. `public` is an
 * invitation for a proxy or a CDN to keep a copy and hand it to somebody else;
 * `must-revalidate` is not a promise that it will ask.
 *
 * The two market routes build their own NextResponse and used to set
 * `s-maxage` on the grounds that quotes are the same for everyone. A shared
 * copy up to ninety seconds old is not a live price, and the CDN served it
 * without the session check; they now send `private, no-store` too.
 */
const PRIVATE_CACHE = 'private, no-store'

function uncached(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', PRIVATE_CACHE)
  return response
}

/**
 * Successful response.
 *
 * Every payload is scanned for non-finite numbers on the way out. Roadmap rule
 * #8 is that no invalid result may reach the interface, and this is the one
 * place every endpoint has to pass through — a NaN born four modules deep in a
 * risk calculation gets caught here whether or not that module thought to check.
 *
 * Invalid numbers become null, which the interface already renders as "--", so
 * the failure degrades to an honest gap rather than "NaN%". They are also
 * reported: a sanitised response means an engine produced something impossible,
 * and silently cleaning that up would hide the actual bug.
 */
export function success<T>(data: T, meta?: ApiResponse['meta'], status = 200) {
  const { payload, replaced } = sanitizeFinancialPayload(data)

  if (replaced.length > 0) {
    const summary = replaced.slice(0, 10).join(', ')
    console.error(
      `[api] non-finite value(s) blocked before the client: ${summary}` +
        (replaced.length > 10 ? ` (+${replaced.length - 10} more)` : ''),
    )
    Sentry.captureMessage('Non-finite value in API payload', {
      level: 'warning',
      extra: { paths: replaced.slice(0, 50) },
    })
  }

  return uncached(NextResponse.json({ data: payload, error: null, meta } satisfies ApiResponse<T>, { status }))
}

/**
 * Error response.
 *
 * A 500 never carries its message to the client (C6). 47 routes pass a
 * database error's text straight through — "duplicate key value violates
 * unique constraint", "Could not find the function public.get_public_portfolios
 * (filter, limit, ...)" — which tells an attacker table, column and function
 * names. The detail is logged here; the client gets a generic sentence. 4xx and
 * 503 messages are written for users and pass through unchanged.
 */
export const GENERIC_SERVER_ERROR = 'Error interno del servidor. Intenta de nuevo.'

export function error(message: string, status = 400) {
  if (status === 500) {
    console.error(`[api 500] ${message}`)
    return uncached(NextResponse.json({ data: null, error: GENERIC_SERVER_ERROR } satisfies ApiResponse, { status }))
  }
  return uncached(NextResponse.json({ data: null, error: message } satisfies ApiResponse, { status }))
}
