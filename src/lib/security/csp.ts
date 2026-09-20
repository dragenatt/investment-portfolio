// Content Security Policy (C6). No I/O.
//
// Before this, pages were sent with no CSP at all: nothing limited where
// scripts came from if an injection ever slipped past React's escaping, and
// any site could frame the app (clickjacking a "vender" button, say).
//
// Scripts: a per-request nonce with 'strict-dynamic', the approach in Next's
// own guide (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
// Next adds the nonce to its own script tags when it finds it in the request's
// CSP header; chunks those scripts load are trusted through 'strict-dynamic'.
// No inline script runs without the nonce.
//
// Styles keep 'unsafe-inline'. Recharts, next-themes and many components set
// style="" attributes, which a nonce cannot cover. Injected CSS can restyle a
// page but cannot run code, so this is the accepted trade-off, written down.

/**
 * The reporting group named in `report-to` and in the Reporting-Endpoints
 * header the proxy sets. The two have to agree, so the name lives here.
 */
export const CSP_REPORT_GROUP = 'csp'

/** Where a browser posts a violation. Public by necessity — see the route. */
export const CSP_REPORT_PATH = '/api/csp-report'

export type CspOptions = {
  nonce: string
  isDev: boolean
  /** NEXT_PUBLIC_SUPABASE_URL: REST, auth and the Realtime websocket. */
  supabaseUrl?: string
  /** NEXT_PUBLIC_POSTHOG_HOST, when product analytics is configured. */
  posthogHost?: string
}

function origin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function buildContentSecurityPolicy({ nonce, isDev, supabaseUrl, posthogHost }: CspOptions): string {
  const supabase = origin(supabaseUrl)
  const posthog = origin(posthogHost)

  const connect = ["'self'"]
  if (supabase) connect.push(supabase, supabase.replace(/^http/, 'ws'))
  if (posthog) connect.push(posthog, 'https://*.posthog.com')
  // Sentry's browser SDK sends to its ingest hosts when a DSN is configured.
  connect.push('https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io')
  // Turbopack's hot reload talks over a local websocket in development.
  if (isDev) connect.push('ws:', 'wss:')

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // React needs eval in development only, to rebuild server error stacks.
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    // Avatars can be any https URL a user or an OAuth provider supplies.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    // Same-origin framing stays possible (the accessibility audit loads pages
    // in same-origin iframes); every other site is refused.
    'frame-ancestors': ["'self'"],
    // Where a violation goes. Without this the policy is enforced in silence:
    // a directive too strict for something legitimate looks, from here, like
    // a feature that mysteriously stopped working for some people. `report-to`
    // is the current mechanism and pairs with the Reporting-Endpoints header;
    // `report-uri` is deprecated and kept for browsers that only know it.
    'report-to': [CSP_REPORT_GROUP],
    'report-uri': [CSP_REPORT_PATH],
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** The Reporting-Endpoints header value that names the group above. */
export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`
}

/** A fresh, unguessable nonce per request. */
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64')
}
