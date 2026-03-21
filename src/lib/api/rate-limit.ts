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

export async function rateLimit(userId: string, tier: Tier = 'general') {
  if (!limiters) return true
  const { success } = await limiters[tier].limit(userId)
  return success
}
