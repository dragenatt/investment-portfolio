import { Redis } from '@upstash/redis'

// Singleton Redis client instance
let redisClient: Redis | null = null

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('Redis credentials not configured - caching disabled')
    return null
  }

  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })

  return redisClient
}

// Cache key prefixes to prevent collisions
export const CACHE_KEYS = {
  PORTFOLIO_SNAPSHOT: 'portfolio:snapshot:',
  PORTFOLIO_COMPARISON: 'portfolio:comparison:',
  LEADERBOARD: 'leaderboard:',
  PRICE: 'price:',
  PRICE_BATCH: 'price:batch:',
  MARKET_HISTORY: 'market:history:',
  MARKET_FUNDAMENTALS: 'market:fundamentals:',
  ANALYTICS_ALLOCATION: 'analytics:allocation:',
  ANALYTICS_PERFORMANCE: 'analytics:performance:',
  ANALYTICS_RISK: 'analytics:risk:',
  USER_PORTFOLIOS: 'user:portfolios:',
  MARKET_EVENTS: 'market:events:',
} as const

// Generic typed cache operations
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const value = await redis.get(key)
    return value as T | null
  } catch (error) {
    console.error(`Cache get error for key ${key}:`, error)
    return null
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = 3600
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    await redis.setex(key, ttlSeconds, JSON.stringify(value))
  } catch (error) {
    console.error(`Cache set error for key ${key}:`, error)
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    await redis.del(key)
  } catch (error) {
    console.error(`Cache delete error for key ${key}:`, error)
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    // Note: Upstash Redis doesn't support pattern deletion directly
    // This is a placeholder - actual implementation depends on your key structure
    // You may need to track related keys separately or use a different approach
    console.warn(`Pattern invalidation for ${pattern} not yet implemented`)
  } catch (error) {
    console.error(`Cache invalidate error for pattern ${pattern}:`, error)
  }
}

// Portfolio snapshot caching
export async function cachePortfolioSnapshot(
  portfolioId: string,
  data: Record<string, unknown>,
  ttl: number = 3600 // 1 hour default
): Promise<void> {
  const key = `${CACHE_KEYS.PORTFOLIO_SNAPSHOT}${portfolioId}`
  await cacheSet(key, data, ttl)
}

export async function getCachedSnapshot(portfolioId: string): Promise<Record<string, unknown> | null> {
  const key = `${CACHE_KEYS.PORTFOLIO_SNAPSHOT}${portfolioId}`
  return cacheGet<Record<string, unknown>>(key)
}

// Portfolio comparison caching
export async function cacheComparison(
  ids: string[],
  period: string,
  data: Record<string, unknown>,
  ttl: number = 1800 // 30 minutes default
): Promise<void> {
  const key = `${CACHE_KEYS.PORTFOLIO_COMPARISON}${ids.sort().join(',')}:${period}`
  await cacheSet(key, data, ttl)
}

export async function getCachedComparison(ids: string[], period: string): Promise<Record<string, unknown> | null> {
  const key = `${CACHE_KEYS.PORTFOLIO_COMPARISON}${ids.sort().join(',')}:${period}`
  return cacheGet<Record<string, unknown>>(key)
}

// Leaderboard caching (key includes category + period to avoid collisions)
export async function cacheLeaderboard(
  category: string,
  period: string,
  data: Record<string, unknown>,
  ttl: number = 900 // 15 minutes default
): Promise<void> {
  const key = `${CACHE_KEYS.LEADERBOARD}${category}:${period}`
  await cacheSet(key, data, ttl)
}

export async function getCachedLeaderboard(category: string, period: string): Promise<Record<string, unknown> | null> {
  const key = `${CACHE_KEYS.LEADERBOARD}${category}:${period}`
  return cacheGet<Record<string, unknown>>(key)
}

// Price caching
export async function cachePrice(
  symbol: string,
  price: number,
  ttl: number = 300 // 5 minutes default
): Promise<void> {
  const key = `${CACHE_KEYS.PRICE}${symbol.toUpperCase()}`
  await cacheSet(key, { symbol, price, timestamp: Date.now() }, ttl)
}

export async function getCachedPrice(symbol: string): Promise<number | null> {
  const key = `${CACHE_KEYS.PRICE}${symbol.toUpperCase()}`
  const data = await cacheGet<{ symbol: string; price: number; timestamp: number }>(key)
  return data?.price ?? null
}

// Batch price caching
export async function cacheBatchPrices(
  prices: Record<string, number>,
  ttl: number = 300 // 5 minutes default
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    const timestamp = Date.now()
    const pipeline = redis.pipeline()

    for (const [symbol, price] of Object.entries(prices)) {
      const key = `${CACHE_KEYS.PRICE}${symbol.toUpperCase()}`
      pipeline.setex(key, ttl, JSON.stringify({ symbol, price, timestamp }))
    }

    await pipeline.exec()
  } catch (error) {
    console.error('Cache batch prices error:', error)
  }
}

export async function getCachedBatchPrices(symbols: string[]): Promise<Record<string, number | null>> {
  try {
    const redis = getRedisClient()
    if (!redis) return Object.fromEntries(symbols.map(s => [s, null]))

    const keys = symbols.map(s => `${CACHE_KEYS.PRICE}${s.toUpperCase()}`)
    const values = await redis.mget(...keys)

    return Object.fromEntries(
      symbols.map((symbol, index) => {
        try {
          const data = values[index] as { price?: number } | string | null
          if (!data) return [symbol, null]
          const parsed = typeof data === 'string' ? JSON.parse(data) : data
          return [symbol, parsed.price ?? null]
        } catch {
          return [symbol, null]
        }
      })
    )
  } catch (error) {
    console.error('Cache get batch prices error:', error)
    return Object.fromEntries(symbols.map(s => [s, null]))
  }
}

// Cache warming function for common queries
export async function warmCache(): Promise<void> {
  try {
    console.log('Starting cache warming...')
    // This function can be called periodically to pre-warm common queries
    // Implementation depends on your app's specific hot paths
    // Example: fetch and cache top 10 leaderboards, popular prices, etc.
    console.log('Cache warming completed')
  } catch (error) {
    console.error('Cache warming error:', error)
  }
}
