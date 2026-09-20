import * as Sentry from '@sentry/nextjs'

/**
 * Where the browser posts a Content-Security-Policy violation.
 *
 * The policy was enforced in silence: a directive too strict for something
 * legitimate looks, from the outside, like a feature that mysteriously stopped
 * working for some people on some browser, and an attempted injection looks
 * like nothing at all. This is the other half of `report-to`.
 *
 * It has to be public — the browser posts these without credentials, from a
 * page that may itself be public — so it is written to be boring: it reads a
 * bounded amount of JSON, keeps five fields, reports them at a low level and
 * answers 204 whatever happened. Nothing it receives is echoed back, stored,
 * or used to decide anything. The proxy's per-address limit applies to it like
 * any other route.
 */

export const runtime = 'nodejs'

/** Bigger than any real report; small enough that a flood costs nothing. */
const MAX_BYTES = 8_192

/**
 * Extensions inject their own scripts and styles into every page and trip the
 * policy constantly. Those reports say nothing about this app.
 */
const NOISE = /^(chrome|moz|safari|webkit|chrome-extension|moz-extension|safari-extension|safari-web-extension)-?extension:|^about:|^data:text\/html/i

type Violation = {
  documentUri?: string
  violatedDirective?: string
  effectiveDirective?: string
  blockedUri?: string
  disposition?: string
}

/** The two shapes browsers send: the old report-uri body and the new one. */
function readViolation(payload: unknown): Violation | null {
  if (!payload || typeof payload !== 'object') return null

  // report-uri: { "csp-report": { "document-uri": ..., ... } }
  const legacy = (payload as Record<string, unknown>)['csp-report']
  if (legacy && typeof legacy === 'object') {
    const body = legacy as Record<string, unknown>
    return {
      documentUri: str(body['document-uri']),
      violatedDirective: str(body['violated-directive']),
      effectiveDirective: str(body['effective-directive']),
      blockedUri: str(body['blocked-uri']),
      disposition: str(body['disposition']),
    }
  }

  // Reporting API: [{ type: 'csp-violation', body: { documentURL, ... } }]
  const report = Array.isArray(payload) ? payload[0] : payload
  const body = (report as Record<string, unknown>)?.body
  if (body && typeof body === 'object') {
    const fields = body as Record<string, unknown>
    return {
      documentUri: str(fields.documentURL),
      violatedDirective: str(fields.effectiveDirective),
      effectiveDirective: str(fields.effectiveDirective),
      blockedUri: str(fields.blockedURL),
      disposition: str(fields.disposition),
    }
  }

  return null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 500) : undefined
}

export async function POST(req: Request) {
  try {
    const raw = await req.text()
    if (raw.length > MAX_BYTES) return new Response(null, { status: 204 })

    const violation = readViolation(JSON.parse(raw))
    if (!violation?.effectiveDirective) return new Response(null, { status: 204 })
    if (violation.blockedUri && NOISE.test(violation.blockedUri)) return new Response(null, { status: 204 })

    console.warn(
      `[csp] ${violation.effectiveDirective} blocked ${violation.blockedUri ?? 'something'} on ${violation.documentUri ?? 'a page'}`,
    )
    Sentry.captureMessage('CSP violation', {
      level: 'warning',
      tags: { area: 'security', directive: violation.effectiveDirective },
      extra: { ...violation },
    })
  } catch {
    // A malformed body is not worth an error response: the browser has nothing
    // to do with the answer either way.
  }

  return new Response(null, { status: 204 })
}
