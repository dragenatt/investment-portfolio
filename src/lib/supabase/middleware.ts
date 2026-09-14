import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath, loginUrlFor } from '@/lib/utils/safe-redirect'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Always refresh the session — this keeps the JWT token alive
  // for both page routes AND API routes
  const { data: { user } } = await supabase.auth.getUser()

  // API routes handle their own auth checks after token refresh
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  // /offline is what the service worker shows for a page it never saved; it
  // is fetched at install time, signed in or not.
  const publicPaths = ['/', '/login', '/register', '/offline']
  const isPublicPath = publicPaths.some(p => request.nextUrl.pathname === p)

  // Redirect authenticated users away from login/register — to where they were
  // headed if that is a safe same-origin path, otherwise the dashboard. This
  // used to clone the URL and change only the pathname, which dropped the user
  // on /dashboard?next=... with the destination sitting unused in the query.
  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    const destination = safeNextPath(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(destination, request.url))
  }

  // Redirect unauthenticated users to login, remembering the full path and
  // query they asked for.
  if (!user && !isPublicPath) {
    return NextResponse.redirect(loginUrlFor(request.nextUrl))
  }

  return supabaseResponse
}
