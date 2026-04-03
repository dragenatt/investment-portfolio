/**
 * Redis Caching Module for InvestTracker
 * 
 * This module provides a comprehensive caching layer using Upstash Redis.
 * It includes singleton client management, typed cache helpers, and application-specific
 * caching functions for portfolios, comparisons, leaderboards, and prices.
 */

// Core cache operations
export {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheInvalidatePattern,
  CACHE_KEYS,
} from './redis'

// Portfolio snapshot caching
export {
  cachePortfolioSnapshot,
  getCachedSnapshot,
} from './redis'

// Portfolio comparison caching
export {
  cacheComparison,
  getCachedComparison,
} from './redis'

// Leaderboard caching
export {
  cacheLeaderboard,
  getCachedLeaderboard,
} from './redis'

// Price caching
export {
  cachePrice,
  getCachedPrice,
  cacheBatchPrices,
  getCachedBatchPrices,
} from './redis'

// Utilities
export { warmCache } from './redis'
export { withCache, withCacheStaleWhileRevalidate } from './with-cache'
