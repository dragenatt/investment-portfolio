// API request limits (C8). Pure: the proxy supplies addresses, users and time.
//
// The previous limit was 60 requests a minute per address, applied before the
// session was known. The load test (docs/LOAD_TEST_RESULTS.md §3) showed what
// that does to real people: the analytics page makes 14 API calls on load,
// dashboard → portfolio → analytics is 27, and everyone behind one office NAT or
// mobile carrier shares a single budget. A signed-in user browsing normally got
// 429s.
//
// Now three budgets, checked in order:
//   1. per address, 600/min — a ceiling against floods, generous enough for a
//      NAT full of people. Checked before the session is read, so junk cookies
//      cannot make the proxy call Supabase Auth without limit.
//   2. per signed-in user, 300/min — follows the person, not the network.
//   3. per address without a session, 60/min — the old limit, where it belongs.
//
// Counters live in the instance's memory, like before: each serverless instance
// counts on its own. Upstash is still the way to make them global (security
// audit, finding 15).

export const REQUEST_LIMITS = {
  windowMs: 60_000,
  perAddress: 600,
  perUser: 300,
  perAnonymousAddress: 60,
} as const

type Window = { count: number; resetAt: number }

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; scope: 'address' | 'user' | 'anonymous' }

export class FixedWindowCounter {
  private readonly windows = new Map<string, Window>()

  constructor(private readonly windowMs: number = REQUEST_LIMITS.windowMs) {}

  /** Count one request against `key`; false when that would exceed `limit` in the current window. */
  hit(key: string, limit: number, now: number): { allowed: boolean; resetAt: number } {
    const current = this.windows.get(key)
    if (!current || current.resetAt <= now) {
      const resetAt = now + this.windowMs
      this.windows.set(key, { count: 1, resetAt })
      return { allowed: true, resetAt }
    }
    if (current.count >= limit) return { allowed: false, resetAt: current.resetAt }
    current.count++
    return { allowed: true, resetAt: current.resetAt }
  }

  /** Drop finished windows so the map does not grow with every address ever seen. */
  prune(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key)
  }

  get size(): number {
    return this.windows.size
  }
}

function retryAfter(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000))
}

/** Step 1, before the session is read. */
export function checkAddress(counter: FixedWindowCounter, address: string, now: number): LimitDecision {
  const result = counter.hit(`address:${address}`, REQUEST_LIMITS.perAddress, now)
  return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: retryAfter(result.resetAt, now), scope: 'address' }
}

/** Step 2 or 3, once the session is known. */
export function checkIdentity(
  counter: FixedWindowCounter,
  identity: { userId: string | null; address: string },
  now: number,
): LimitDecision {
  if (identity.userId) {
    const result = counter.hit(`user:${identity.userId}`, REQUEST_LIMITS.perUser, now)
    return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: retryAfter(result.resetAt, now), scope: 'user' }
  }
  const result = counter.hit(`anonymous:${identity.address}`, REQUEST_LIMITS.perAnonymousAddress, now)
  return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: retryAfter(result.resetAt, now), scope: 'anonymous' }
}

/** The client address as the platform reports it. On Vercel the edge sets x-forwarded-for itself. */
export function clientAddress(headers: { get(name: string): string | null }): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}
