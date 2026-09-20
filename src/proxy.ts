import { NextResponse, type NextRequest } from 'next/server'
import { updateSession, sessionFailureResponse } from '@/lib/supabase/middleware'
import { checkAddress, checkIdentity, clientAddress, FixedWindowCounter } from '@/lib/api/request-limits'
import { buildContentSecurityPolicy, createNonce } from '@/lib/security/csp'

// Request limits (C8): per address before the session is read, then per user
// when signed in or per address when not. See src/lib/api/request-limits.ts.
const counter = new FixedWindowCounter()

// Drop finished windows every 5 minutes so the map does not keep every address.
setInterval(() => counter.prune(Date.now()), 5 * 60 * 1000)

/**
 * The session read, with the proxy's own net under it.
 *
 * updateSession already treats an unusable session as no session; this catches
 * the case where the call itself fails — a missing environment variable, an
 * SDK that throws where it used to return. Whatever the cause, a visitor
 * should meet a login page, not a 500 from the proxy on every route at once.
 */
async function readSession(
  request: NextRequest,
  extraRequestHeaders: Record<string, string> = {},
): Promise<{ response: NextResponse; userId: string | null }> {
  try {
    return await updateSession(request, extraRequestHeaders)
  } catch (err) {
    console.error('[proxy] session handling failed:', err)
    return { response: sessionFailureResponse(request, extraRequestHeaders), userId: null }
  }
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { data: null, error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Content-Type': 'application/json',
      },
    },
  )
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Skip rate limiting for health checks and other special routes
    if (request.nextUrl.pathname === '/api/health') {
      return NextResponse.next()
    }

    const address = clientAddress(request.headers)
    const now = Date.now()

    const ceiling = checkAddress(counter, address, now)
    if (!ceiling.allowed) return tooManyRequests(ceiling.retryAfterSeconds)

    // JSON responses: no document, so no CSP. Security headers for every route
    // are set in next.config.ts.
    const { response, userId } = await readSession(request)

    const decision = checkIdentity(counter, { userId, address }, now)
    if (!decision.allowed) {
      const refused = tooManyRequests(decision.retryAfterSeconds)
      // Keep a refreshed session: Supabase rotates refresh tokens, and dropping
      // the new cookie here would leave the browser holding a used one.
      for (const cookie of response.cookies.getAll()) refused.cookies.set(cookie)
      return refused
    }
    return response
  }

  // Pages: a fresh nonce and the CSP that names it (C6). The policy goes on the
  // request, where Next reads the nonce for its own script tags, and on the
  // response, where the browser enforces it.
  const nonce = createNonce()
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_KEY ? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' : undefined,
  })
  const { response } = await readSession(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
