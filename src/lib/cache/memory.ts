/**
 * A small in-memory cache with a time to live and a size bound, per server
 * instance.
 *
 * Redis (Upstash) is optional and off in production, and every cacheGet and
 * cacheSet in the app is then a no-op: a route that meant to reuse a heavy
 * result for minutes recomputed it on every request. This keeps a result
 * inside the instance that computed it. Instances do not share it, so a key
 * must identify its content — a result keyed only by user and range would go
 * stale after a trade on another instance, one keyed by what the result was
 * computed from cannot.
 */
export type MemoryCache<T> = {
  get(key: string): T | undefined
  set(key: string, value: T, ttlMs: number): void
  clear(): void
  readonly size: number
}

export function createMemoryCache<T>(maxEntries = 500, now: () => number = Date.now): MemoryCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>()

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return undefined
      }
      // Most recently used goes to the back, so the front is what to evict.
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value, ttlMs) {
      entries.delete(key)
      entries.set(key, { value, expiresAt: now() + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}
