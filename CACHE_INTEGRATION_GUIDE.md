# Cache Integration Guide

## Quick Start

The Redis caching layer is ready to use. No additional setup required beyond environment variables.

## Setting Up Environment Variables

1. Add to `.env.local`:
```
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

2. These credentials are already configured if using Upstash.

## Using the Cache in Your Code

### Import Functions
```typescript
import { 
  cacheGet, 
  cacheSet, 
  getCachedPrice,
  cachePrice,
  withCache,
  CACHE_KEYS
} from '@/lib/cache'
```

### Simple Examples

**Cache a single value:**
```typescript
// Set
await cacheSet('my-key', { data: 'value' }, 3600)

// Get
const data = await cacheGet<any>('my-key')
```

**Cache prices:**
```typescript
// Single price
await cachePrice('AAPL', 150.25, 300)
const price = await getCachedPrice('AAPL')

// Multiple prices
await cacheBatchPrices({ 'AAPL': 150.25, 'GOOGL': 140 }, 300)
const prices = await getCachedBatchPrices(['AAPL', 'GOOGL'])
```

**Cache-aside pattern:**
```typescript
const result = await withCache(
  'my-cache-key',
  3600,
  async () => await expensiveQuery()
)
```

### Portfolio/Comparison Example

Already integrated in `/api/compare` route:
```typescript
// Returns cached comparison if available
GET /api/compare?ids=portfolio-1,portfolio-2&period=1Y

// Cache invalidates after 30 minutes
// Subsequent requests within 30min use cache
```

## Cache Key Naming Convention

Always use `CACHE_KEYS` constants:
```typescript
import { CACHE_KEYS } from '@/lib/cache'

const key = `${CACHE_KEYS.PORTFOLIO_SNAPSHOT}${portfolioId}`
const key = `${CACHE_KEYS.LEADERBOARD}${category}`
const key = `${CACHE_KEYS.PRICE}${symbol.toUpperCase()}`
```

## TTL Recommendations

- **Portfolio Snapshots**: 3600s (1 hour) - data updates hourly
- **Comparisons**: 1800s (30 min) - user-triggered, may change
- **Leaderboards**: 900s (15 min) - frequently updated
- **Prices**: 300s (5 min) - market data, needs freshness
- **Batch Operations**: 300s (5 min) - same as prices

## Error Handling

Cache operations never throw. They gracefully degrade:

```typescript
// Always returns value or null
const value = await cacheGet('key') 

// Safely catches any error
if (value === null) {
  // Use fresh data
}

// Write errors are logged but don't break request
await cacheSet('key', data, 3600) // Non-blocking
```

## Testing Without Redis

If `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is missing:
- Caching gracefully disables
- Warning logged to console
- App continues working normally
- All cache functions return `null`/no-op

## Monitoring Cache Performance

Add these logs to track effectiveness:

```typescript
const cached = await cacheGet(key)
if (cached) {
  console.log(`[CACHE HIT] ${key}`)
} else {
  console.log(`[CACHE MISS] ${key}`)
}
```

## Invalidating Cache

**Delete specific key:**
```typescript
import { cacheDelete } from '@/lib/cache'
await cacheDelete('my-key')
```

**Pattern invalidation (coming soon):**
```typescript
import { cacheInvalidatePattern } from '@/lib/cache'
await cacheInvalidatePattern('portfolio:*')
```

## Updating Cached Data

When data changes in the database:

```typescript
// Update database
const updated = await updatePortfolio(id, newData)

// Invalidate cache
await cacheDelete(`${CACHE_KEYS.PORTFOLIO_SNAPSHOT}${id}`)

// Fresh data will be cached on next request
```

## Performance Tips

1. **Batch prices** instead of individual lookups:
```typescript
// Bad - N requests
symbols.forEach(s => getCachedPrice(s))

// Good - 1 request
getCachedBatchPrices(symbols)
```

2. **Use withCache** for complex operations:
```typescript
// Instead of manual get/compute/set
const result = await withCache(key, ttl, async () => {
  return await complexQuery()
})
```

3. **Set appropriate TTLs** based on data volatility:
```typescript
// Stable data - longer TTL
await cacheSet(key, portfolioMetadata, 86400) // 24 hours

// Real-time data - shorter TTL
await cachePrice(symbol, price, 300) // 5 minutes
```

4. **Warm cache** on startup:
```typescript
import { warmCache } from '@/lib/cache'
// In your app initialization
await warmCache()
```

## Troubleshooting

**Cache not working?**
- Check environment variables in `.env.local`
- Verify Upstash credentials
- Check logs for connection errors
- Confirm Redis credentials are valid

**Cache hitting too much?**
- Reduce TTL values
- Implement pattern invalidation for bulk updates
- Use cache warming judiciously

**Cache missing too much?**
- Increase TTL values
- Check if cache keys match exactly
- Verify sorted order for multi-key comparisons

## Next Steps

1. Deploy with Redis credentials
2. Monitor cache hit rates
3. Adjust TTLs based on performance data
4. Implement pattern invalidation when needed
5. Consider cache warming for hot data
