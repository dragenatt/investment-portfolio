import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { sanitizeFinancialPayload } from '@/lib/services/validation'

export type ApiResponse<T = unknown> = {
  data: T | null
  error: string | null
  meta?: { total?: number; cursor?: string }
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

  return NextResponse.json({ data: payload, error: null, meta } satisfies ApiResponse<T>, { status })
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
    return NextResponse.json({ data: null, error: GENERIC_SERVER_ERROR } satisfies ApiResponse, { status })
  }
  return NextResponse.json({ data: null, error: message } satisfies ApiResponse, { status })
}
