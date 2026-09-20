import { createServerClient } from '@supabase/ssr'
import { isAuthApiError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath, loginUrlFor } from '@/lib/utils/safe-redirect'

/**
 * Pages anyone may open without a session. `/offline` is what the service
 * worker shows for a page it never saved; it is fetched at install time,
 * signed in or not.
 */
const PUBLIC_PATHS = ['/', '/login', '/register', '/offline']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname)
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
 * The signed-in user, or null — never a thrown error.
 *
 * `getUser()` rejects when the refresh token in the cookie is expired, revoked
 * or simply no longer known to the project: Supabase answers 400 and the SDK
 * raises AuthApiError. Production recorded ten of those across four users,
 * each one a 500 for someone whose only mistake was leaving a tab open. An
 * unusable session is the same situation as no session at all, so it is
 * reported that way, and `expired` says the cookie itself is spent.
 *
 * A network failure reaching Supabase is a different thing. It also leaves the
 * request without a user, but it proves nothing about the cookie, so the
 * session is left intact to be retried rather than signed out over one bad
 * minute of connectivity.
 */
async function readUser(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ user: { id: string } | null; expired: boolean }> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return { user: user ?? null, expired: false }
  } catch (err) {
    if (isAuthApiError(err)) return { user: null, expired: true }
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
  // query they asked for.
  if (!user && !isPublicPath(request.nextUrl.pathname)) {
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
  if (!pathname.startsWith('/api/') && !isPublicPath(pathname)) {
    return NextResponse.redirect(loginUrlFor(request.nextUrl))
  }
  const headers = new Headers(request.headers)
  for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value)
  return NextResponse.next({ request: { headers } })
}
