import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type Tier = 'search' | 'transaction' | 'general'

let limiters: Record<Tier, Ratelimit> | null = null

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
  limiters = {
    search: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), prefix: 'rl:search' }),
    transaction: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'rl:transaction' }),
    general: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 m'), prefix: 'rl:general' }),
  }
}

/**
 * Whether the user is under their limit for this tier.
 *
 * Fails open. Upstash answers an exhausted free quota, or a pay-as-you-go
 * database at its budget cap, by rate limiting the database, and the SDK
 * throws; uncaught, that was a 500 on every route that asks — the dashboard's
 * history, trading, importing, deleting an account. The proxy's in-memory
 * ceiling still stands in front of all of them.
 */
export async function rateLimit(userId: string, tier: Tier = 'general') {
  if (!limiters) return true
  try {
    const { success } = await limiters[tier].limit(userId)
    return success
  } catch (err) {
    console.warn(`[rate-limit] Upstash did not answer (${tier}); letting the request through:`, err instanceof Error ? err.message : err)
    return true
  }
}
