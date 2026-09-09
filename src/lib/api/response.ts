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

export function error(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message } satisfies ApiResponse, { status })
}
