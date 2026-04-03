import { cacheGet, cacheSet } from './redis'

/**
 * Wraps an async function with caching using a stale-while-revalidate pattern.
 * 
 * If cached data exists, it returns immediately.
 * If no cache or expired, it computes fresh data and caches it.
 * Errors during computation don't clear the cache.
 * 
 * @param key - Cache key to use
 * @param ttl - Time to live in seconds
 * @param fn - Async function to compute the value
 * @returns The cached or freshly computed value
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>
): Promise<T> {
  try {
    // Try to get from cache first
    const cached = await cacheGet<T>(key)
    if (cached !== null) {
      return cached
    }
  } catch (error) {
    console.error(`Error reading from cache for key ${key}:`, error)
    // Continue to compute fresh data if cache read fails
  }

  // Compute fresh data
  const data = await fn()

  // Cache the fresh data
  try {
    await cacheSet(key, data, ttl)
  } catch (error) {
    console.error(`Error writing to cache for key ${key}:`, error)
    // Don't fail the request if cache write fails
  }

  return data
}

/**
 * Similar to withCache but with stale-while-revalidate pattern:
 * Returns stale data immediately while revalidating in the background.
 * 
 * @param key - Cache key to use
 * @param ttl - Time to live in seconds
 * @param staleAfter - Seconds after which data is considered stale
 * @param fn - Async function to compute the value
 * @returns The cached or freshly computed value
 */
export async function withCacheStaleWhileRevalidate<T>(
  key: string,
  ttl: number,
  staleAfter: number,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const cached = await cacheGet<T & { __timestamp?: number }>(key)
    if (cached !== null) {
      const age = cached.__timestamp ? (Date.now() - cached.__timestamp) / 1000 : 0
      
      if (age < staleAfter) {
        // Fresh data, return immediately
        return cached as T
      }

      // Stale data - return it and revalidate in background
      fn()
        .then(fresh => cacheSet(key, { ...fresh, __timestamp: Date.now() }, ttl))
        .catch(err => console.error(`Background revalidation error for ${key}:`, err))
      
      return cached as T
    }
  } catch (error) {
    console.error(`Error in withCacheStaleWhileRevalidate for key ${key}:`, error)
  }

  // No cache, compute fresh
  const data = await fn()
  try {
    await cacheSet(key, { ...data, __timestamp: Date.now() }, ttl)
  } catch (error) {
    console.error(`Error writing to cache for key ${key}:`, error)
  }

  return data
}
