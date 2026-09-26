import { createServerClient } from '@supabase/ssr'
import { isAuthApiError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath, loginUrlFor } from '@/lib/utils/safe-redirect'

/**
 * Pages anyone may open without a session. `/offline` is what the service
 * worker shows for a page it never saved; it is fetched at install time,
 * signed in or not. The password-recovery pages and the route email links come
 * back to are for exactly the person who cannot sign in.
 */
const PUBLIC_PATHS = ['/', '/login', '/register', '/offline', '/forgot-password', '/reset-password', '/auth/callback']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname)
}

/**
 * The first segment of every section this app actually serves — the folders
 * under src/app/(app), which tests/lint/app-sections.test.ts keeps in step
 * with this list.
 *
 * It exists to tell two different situations apart. /portfolio/<id> is a real
 * page that happens to need a session, and a visitor asking for it should sign
 * in and land there. /lo-que-sea is not a page at all, and sending that
 * visitor to /login?next=%2Flo-que-sea asks them to sign in for something that
 * will not be there afterwards. not-found.tsx has existed all along; for
 * anyone without a session it was unreachable, because this file answered
 * first for every path in the app.
 */
export const APP_SECTIONS = [
  'admin',
  'advisor',
  'alerts',
  'compare',
  'dashboard',
  'discover',
  'goals',
  'lab',
  'market',
  'portfolio',
  'profile',
  'settings',
  'watchlist',
] as const

function isKnownSection(pathname: string): boolean {
  const section = pathname.split('/')[1] ?? ''
  return (APP_SECTIONS as readonly string[]).includes(section)
}

/**
 * Supabase keeps the session in `sb-<project-ref>-auth-token`, split across
 * `.0`, `.1`… when it outgrows one cookie. Matching the shape rather than a
 * fixed name clears every chunk without hardcoding the project reference.
 */
function isAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('-auth-token')
}

function clearAuthCookies(response: NextResponse, request: NextRequest) {
  for (const cookie of request.cookies.getAll()) {
    if (isAuthCookie(cookie.name)) response.cookies.delete(cookie.name)
  }
}

/**
 * The auth errors that prove the cookie will never work again: the project has
 * no such refresh token, session or user. Only these are worth clearing the
 * cookie over.
 *
 * Every other auth error is something the session can come back from, and two
 * of them are ordinary. Refresh tokens rotate, so when a dashboard fires
 * several requests at once and the token has just expired, one of them
 * refreshes it and the others arrive with the copy it replaced: Supabase
 * answers 'conflict' (too many concurrent refreshes) or
 * 'refresh_token_already_used'. Production recorded 44 of those. Treating them
 * as a spent session signed the reader out in the middle of their own page —
 * and worse, it deleted the cookie the request that won the race had just set,
 * so a session that was alive was destroyed by the one request that lost.
 */
const UNRECOVERABLE_AUTH_CODES = new Set([
  'refresh_token_not_found',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'bad_jwt',
])

/**
 * The signed-in user, or null — never a thrown error.
 *
 * `getUser()` rejects when the refresh token in the cookie is expired, revoked
 * or simply no longer known to the project: Supabase answers 400 and the SDK
 * raises AuthApiError. Production recorded ten of those across four users,
 * each one a 500 for someone whose only mistake was leaving a tab open. An
 * unusable session is the same situation as no session at all, so it is
 * reported that way, and `expired` says the cookie itself is spent — which is
 * true of an unrecoverable code, and not of a race between two refreshes.
 *
 * A network failure reaching Supabase is a different thing again. It also
 * leaves the request without a user, but it proves nothing about the cookie, so
 * the session is left intact to be retried rather than signed out over one bad
 * minute of connectivity.
 */
async function readUser(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ user: { id: string } | null; expired: boolean }> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return { user: user ?? null, expired: false }
  } catch (err) {
    if (isAuthApiError(err)) {
      const spent = UNRECOVERABLE_AUTH_CODES.has(err.code ?? '')
      // Not an error when the session can recover: this request goes on without
      // a user, and the next one carries whichever cookie won.
      if (!spent) console.warn(`[proxy] session not refreshed this time (${err.code ?? err.status})`)
      return { user: null, expired: spent }
    }
    console.error('[proxy] could not refresh the session:', err)
    return { user: null, expired: false }
  }
}

/**
 * Refreshes the Supabase session and applies the page redirects.
 *
 * `extraRequestHeaders` are forwarded to the page render. The proxy uses it for
 * the CSP nonce (C6): Next reads the nonce from the request's
 * Content-Security-Policy header and stamps it on its own script tags.
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders: Record<string, string> = {},
): Promise<{ response: NextResponse; userId: string | null }> {
  const next = () => {
    const headers = new Headers(request.headers)
    for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value)
    return NextResponse.next({ request: { headers } })
  }
  let supabaseResponse = next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = next()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // An email link whose redirect Supabase did not accept lands on the Site URL
  // — this page — with its one-time code, which nothing here would exchange.
  // Hand it to the route that does; it tells a recovery link from the rest.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const callback = new URL('/auth/callback', request.url)
    callback.searchParams.set('code', request.nextUrl.searchParams.get('code')!)
    return { response: NextResponse.redirect(callback), userId: null }
  }

  // Always refresh the session — this keeps the JWT token alive
  // for both page routes AND API routes
  const { user, expired } = await readUser(supabase)

  // A spent refresh token is dropped here, whatever the route: otherwise the
  // browser keeps presenting it on every request and earns the same 400 back.
  const finish = (response: NextResponse) => {
    if (expired) clearAuthCookies(response, request)
    return response
  }

  // API routes handle their own auth checks after token refresh. The user id
  // goes back to the proxy, which limits signed-in requests per user (C8).
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return { response: finish(supabaseResponse), userId: user?.id ?? null }
  }

  // Redirect authenticated users away from login/register — to where they were
  // headed if that is a safe same-origin path, otherwise the dashboard. This
  // used to clone the URL and change only the pathname, which dropped the user
  // on /dashboard?next=... with the destination sitting unused in the query.
  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    const destination = safeNextPath(request.nextUrl.searchParams.get('next'))
    return { response: NextResponse.redirect(new URL(destination, request.url)), userId: user.id }
  }

  // Redirect unauthenticated users to login, remembering the full path and
  // query they asked for — but only for a path that is a page. One that
  // belongs to no section of this app is a 404, and continues to Next, which
  // renders not-found.tsx.
  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    if (!isKnownSection(request.nextUrl.pathname)) {
      return { response: finish(supabaseResponse), userId: null }
    }
    return { response: finish(NextResponse.redirect(loginUrlFor(request.nextUrl))), userId: null }
  }

  return { response: finish(supabaseResponse), userId: user?.id ?? null }
}

/**
 * What to answer when `updateSession` itself could not run — the Supabase
 * client failed to construct, or something below it threw where no try/catch
 * reaches. The request still has to be answered, and the honest answer is the
 * one for a visitor with no session: public pages continue, everything else
 * goes to login, API routes carry on to their own auth check. The alternative
 * is a 500 on every page, including the landing page a visitor may be seeing
 * for the first time.
 */
export function sessionFailureResponse(
  request: NextRequest,
  extraRequestHeaders: Record<string, string> = {},
): NextResponse {
  const pathname = request.nextUrl.pathname
  if (!pathname.startsWith('/api/') && !isPublicPath(pathname) && isKnownSection(pathname)) {
    return NextResponse.redirect(loginUrlFor(request.nextUrl))
  }
  const headers = new Headers(request.headers)
  for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value)
  return NextResponse.next({ request: { headers } })
}
