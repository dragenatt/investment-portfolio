# Redis Caching Layer

This module provides a production-grade Redis caching layer for InvestTracker using Upstash Redis.

## Architecture

### Singleton Pattern
The Redis client is initialized once and reused across the application. Environment variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must be configured.

### Files

- **redis.ts** - Core Redis client, typed cache helpers, and domain-specific caching functions
- **with-cache.ts** - Higher-order helpers for cache-aside patterns
- **index.ts** - Public API exports

## Configuration

Set environment variables:
```
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

If credentials are missing, caching gracefully disables with a warning log.

## Core Functions

### Generic Cache Operations

```typescript
// Get cached value (typed)
const value = await cacheGet<MyType>('my-key')

// Set value with TTL (seconds)
await cacheSet('my-key', myValue, 3600)

// Delete specific key
await cacheDelete('my-key')

// Invalidate pattern (placeholder - needs manual implementation)
await cacheInvalidatePattern('portfolio:*')
```

### Portfolio Snapshot Caching

Portfolio snapshots are cached for 1 hour by default.

```typescript
// Cache a snapshot
await cachePortfolioSnapshot(portfolioId, snapshotData, 3600)

// Retrieve cached snapshot
const cached = await getCachedSnapshot(portfolioId)
```

### Portfolio Comparison Caching

Comparison results are cached for 30 minutes by default.

```typescript
// Cache comparison between multiple portfolios
await cacheComparison(
  ['portfolio-1', 'portfolio-2'],
  '1Y',
  comparisonMetrics,
  1800
)

// Retrieve cached comparison
const cached = await getCachedComparison(
  ['portfolio-1', 'portfolio-2'],
  '1Y'
)
```

### Leaderboard Caching

Leaderboard rankings are cached for 15 minutes by default.

```typescript
// Cache leaderboard
await cacheLeaderboard('top_return_1m', rankings, 900)

// Retrieve cached leaderboard
const cached = await getCachedLeaderboard('top_return_1m')
```

### Price Caching

Individual prices are cached for 5 minutes by default.

```typescript
// Cache single price
await cachePrice('AAPL', 150.25, 300)

// Get single price
const price = await getCachedPrice('AAPL')

// Cache multiple prices at once
await cacheBatchPrices({ 'AAPL': 150.25, 'GOOGL': 140.00 }, 300)

// Get multiple prices
const prices = await getCachedBatchPrices(['AAPL', 'GOOGL'])
// Returns: { 'AAPL': 150.25, 'GOOGL': 140.00 }
```

## Cache Helpers

### `withCache` - Cache-Aside Pattern

Wraps an async function with caching. Returns cached data if available, otherwise computes fresh data and caches it.

```typescript
const result = await withCache(
  'my-cache-key',
  3600, // TTL in seconds
  async () => {
    // Expensive computation or DB query
    return await fetchExpensiveData()
  }
)
```

### `withCacheStaleWhileRevalidate` - Advanced Pattern

Returns stale data immediately while revalidating in the background.

```typescript
const result = await withCacheStaleWhileRevalidate(
  'my-cache-key',
  3600,      // Full TTL
  1800,      // Stale after 30 minutes
  async () => {
    return await fetchData()
  }
)
```

## Cache Keys

Keys are prefixed to prevent collisions:

```typescript
CACHE_KEYS = {
  PORTFOLIO_SNAPSHOT: 'portfolio:snapshot:',
  PORTFOLIO_COMPARISON: 'portfolio:comparison:',
  LEADERBOARD: 'leaderboard:',
  PRICE: 'price:',
  PRICE_BATCH: 'price:batch:',
}
```

Example keys:
- `portfolio:snapshot:portfolio-123`
- `portfolio:comparison:portfolio-1,portfolio-2:1Y`
- `leaderboard:top_return_1m`
- `price:AAPL`

## API Routes Updated

The following routes now use caching:

### `GET /api/compare`
- **Cache Key**: `portfolio:comparison:{sorted-ids}:{period}`
- **TTL**: 30 minutes
- Caches comparison metrics for multiple portfolios

### `GET /api/compare/history`
- **Cache Key**: `portfolio:comparison:history:{sorted-ids}:{period}`
- **TTL**: 30 minutes
- Caches normalized historical comparison data

### `GET /api/discover/leaderboard`
- **Cache Key**: `leaderboard:{category}`
- **TTL**: 15 minutes
- Caches leaderboard rankings by category

### `GET /api/discover/portfolios`
- **Cache Key**: `portfolio:comparison:public:{sort}:{order}:{filter}:{min_positions}:{page}:{limit}`
- **TTL**: 10 minutes
- Caches public portfolio discovery results

## Error Handling

All cache operations are non-blocking. If caching fails:
- Read errors return `null` (allow fallback to fresh data)
- Write errors log but don't break requests
- Network timeouts are handled gracefully

```typescript
// Cache operations never throw - they log errors instead
const value = await cacheGet('key') // Returns null on error
await cacheSet('key', data) // Logs error, doesn't throw
```

## Performance Considerations

### TTL Guidelines

- **Portfolio Snapshots**: 1 hour (data updates hourly)
- **Comparisons**: 30 minutes (user-triggered comparisons)
- **Leaderboards**: 15 minutes (frequent updates)
- **Prices**: 5 minutes (real-time data, can be shorter)
- **Public Portfolios**: 10 minutes (discovery pages)

### Warming Cache

Call `warmCache()` periodically to pre-warm common queries:

```typescript
// In a cron job or background task
import { warmCache } from '@/lib/cache'

export async function warmCacheJob() {
  await warmCache()
}
```

### Batch Operations

Use batch price caching to reduce network round trips:

```typescript
// Instead of:
await Promise.all(symbols.map(s => getCachedPrice(s)))

// Use:
const prices = await getCachedBatchPrices(symbols)
```

## Testing

Cache operations fail gracefully without credentials:

```typescript
// Graceful degradation - caching disabled
const redis = getRedisClient() // returns null if no env vars
// All operations work, just without caching
```

## Future Enhancements

1. **Pattern Invalidation** - Implement key prefix scanning for Upstash
2. **Cache Statistics** - Track hit/miss ratios
3. **Distributed Invalidation** - Notify other instances of cache changes
4. **Compression** - Compress large cached values
5. **Circuit Breaker** - Disable caching if Upstash is unavailable
