import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// In-memory rate limiter for when Upstash is not configured
const inMemoryStore = new Map<string, { count: number; resetAt: number }>()

// Cleanup interval: remove expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of inMemoryStore.entries()) {
    if (value.resetAt < now) {
      inMemoryStore.delete(key)
    }
  }
}, 5 * 60 * 1000)

/**
 * Check rate limit using in-memory store.
 * Limit: 60 requests per 60 seconds per IP.
 */
async function checkRateLimit(ip: string): Promise<boolean> {
  const now = Date.now()
  const entry = inMemoryStore.get(ip)

  if (!entry || entry.resetAt < now) {
    // Create new entry
    inMemoryStore.set(ip, { count: 1, resetAt: now + 60 * 1000 })
    return false // Not limited
  }

  // Within window: check count
  if (entry.count >= 60) {
    return true // Limited
  }

  // Increment and allow
  entry.count++
  return false
}

export async function middleware(request: NextRequest) {
  // Rate limit API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Skip rate limiting for health checks and other special routes
    if (request.nextUrl.pathname === '/api/health') {
      return NextResponse.next()
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip')?.trim() ??
      'anonymous'

    const limited = await checkRateLimit(ip)
    if (limited) {
      return NextResponse.json(
        { data: null, error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'Content-Type': 'application/json',
          },
        }
      )
    }
  }

  // Update session for non-API routes
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
