import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Redis at the module level ───────────────────────────────────────
const mockGet = vi.fn()
const mockSetex = vi.fn()
const mockDel = vi.fn()
const mockMget = vi.fn()
const mockPipelineSetex = vi.fn().mockReturnThis()
const mockPipelineExec = vi.fn().mockResolvedValue([])
const mockPipeline = vi.fn().mockReturnValue({
  setex: mockPipelineSetex,
  exec: mockPipelineExec,
})

vi.mock('@upstash/redis', () => {
  const RedisMock = function () {
    return {
      get: mockGet,
      setex: mockSetex,
      del: mockDel,
      mget: mockMget,
      pipeline: mockPipeline,
    }
  }
  return { Redis: RedisMock }
})

// Env vars must be set before the cache module initializes
vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io')
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')

// Import cache functions AFTER mocking
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cachePrice,
  getCachedPrice,
  cacheBatchPrices,
  getCachedBatchPrices,
  cachePortfolioSnapshot,
  getCachedSnapshot,
} from '@/lib/cache/redis'

describe('Redis Cache Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-set return values for pipeline mock
    mockPipelineSetex.mockReturnThis()
    mockPipelineExec.mockResolvedValue([])
  })

  describe('cacheGet/cacheSet', () => {
    it('retrieves typed data', async () => {
      const testData = { id: '123', name: 'Test' }
      mockGet.mockResolvedValueOnce(testData)

      const result = await cacheGet<typeof testData>('test:key')
      expect(result).toEqual(testData)
      expect(mockGet).toHaveBeenCalledWith('test:key')
    })

    it('stores data with TTL', async () => {
      const testData = { id: '123', name: 'Test' }
      mockSetex.mockResolvedValueOnce('OK')

      await cacheSet('test:key', testData, 3600)

      expect(mockSetex).toHaveBeenCalledWith(
        'test:key',
        3600,
        JSON.stringify(testData)
      )
    })

    it('returns null when key not found', async () => {
      mockGet.mockResolvedValueOnce(null)
      const result = await cacheGet('nonexistent:key')
      expect(result).toBeNull()
    })

    it('handles Redis errors gracefully on get', async () => {
      mockGet.mockRejectedValueOnce(new Error('Redis connection error'))
      const result = await cacheGet('test:key')
      expect(result).toBeNull()
    })

    it('handles Redis errors gracefully on set', async () => {
      mockSetex.mockRejectedValueOnce(new Error('Redis write error'))
      await expect(cacheSet('test:key', { data: 'test' }, 3600)).resolves.toBeUndefined()
    })

    it('handles Redis errors gracefully on delete', async () => {
      mockDel.mockRejectedValueOnce(new Error('Redis delete error'))
      await expect(cacheDelete('test:key')).resolves.toBeUndefined()
    })

    it('deletes a key', async () => {
      mockDel.mockResolvedValueOnce(1)
      await cacheDelete('test:key')
      expect(mockDel).toHaveBeenCalledWith('test:key')
    })
  })

  describe('Price caching', () => {
    it('caches price for symbol with correct key', async () => {
      mockSetex.mockResolvedValueOnce('OK')
      await cachePrice('AAPL', 150.25, 300)
      expect(mockSetex).toHaveBeenCalledWith(
        'price:AAPL',
        300,
        expect.stringContaining('"price":150.25')
      )
    })

    it('retrieves cached price', async () => {
      mockGet.mockResolvedValueOnce({ symbol: 'AAPL', price: 150.25, timestamp: Date.now() })
      const price = await getCachedPrice('AAPL')
      expect(price).toBe(150.25)
    })

    it('returns null for uncached price', async () => {
      mockGet.mockResolvedValueOnce(null)
      const price = await getCachedPrice('NONEXISTENT')
      expect(price).toBeNull()
    })

    it('normalizes symbol to uppercase', async () => {
      mockSetex.mockResolvedValueOnce('OK')
      await cachePrice('aapl', 150.25, 300)
      expect(mockSetex).toHaveBeenCalledWith('price:AAPL', 300, expect.any(String))
    })
  })

  describe('Batch price caching', () => {
    it('caches multiple prices via pipeline', async () => {
      const prices = { AAPL: 150, GOOGL: 140, MSFT: 380 }
      await cacheBatchPrices(prices, 300)
      expect(mockPipeline).toHaveBeenCalled()
      expect(mockPipelineSetex).toHaveBeenCalledTimes(3)
      expect(mockPipelineExec).toHaveBeenCalled()
    })

    it('retrieves cached batch prices', async () => {
      mockMget.mockResolvedValueOnce([
        { symbol: 'AAPL', price: 150, timestamp: Date.now() },
        { symbol: 'GOOGL', price: 140, timestamp: Date.now() },
        null,
      ])
      const result = await getCachedBatchPrices(['AAPL', 'GOOGL', 'MSFT'])
      expect(result.AAPL).toBe(150)
      expect(result.GOOGL).toBe(140)
      expect(result.MSFT).toBeNull()
    })

    it('returns null for all symbols on error', async () => {
      mockMget.mockRejectedValueOnce(new Error('Batch error'))
      const result = await getCachedBatchPrices(['AAPL', 'GOOGL'])
      expect(result.AAPL).toBeNull()
      expect(result.GOOGL).toBeNull()
    })
  })

  describe('Portfolio snapshot caching', () => {
    it('caches snapshot with correct key and TTL', async () => {
      mockSetex.mockResolvedValueOnce('OK')
      const snapshot = { portfolioId: 'p123', value: 10000 }
      await cachePortfolioSnapshot('p123', snapshot, 1800)
      expect(mockSetex).toHaveBeenCalledWith(
        'portfolio:snapshot:p123',
        1800,
        JSON.stringify(snapshot)
      )
    })

    it('retrieves cached snapshot', async () => {
      const snapshot = { portfolioId: 'p123', value: 10000, positions: [] }
      mockGet.mockResolvedValueOnce(snapshot)
      const cached = await getCachedSnapshot('p123')
      expect(cached).toEqual(snapshot)
    })

    it('returns null for uncached snapshot', async () => {
      mockGet.mockResolvedValueOnce(null)
      const cached = await getCachedSnapshot('nonexistent')
      expect(cached).toBeNull()
    })
  })
})

// ─── withCache / withCacheStaleWhileRevalidate ──────────────────────────────
// These are thin wrappers over cacheGet/cacheSet, so we test them by
// controlling the underlying mock returns.

describe('withCache (via Redis mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached data when Redis has it', async () => {
    const cachedData = { id: '1', value: 'cached' }
    mockGet.mockResolvedValueOnce(cachedData)
    const fn = vi.fn()

    const { withCache } = await import('@/lib/cache/with-cache')
    const result = await withCache('test:wc:1', 3600, fn)

    expect(result).toEqual(cachedData)
    expect(fn).not.toHaveBeenCalled()
  })

  it('computes fresh data when cache is empty', async () => {
    const freshData = { id: '2', value: 'fresh' }
    mockGet.mockResolvedValueOnce(null)
    mockSetex.mockResolvedValueOnce('OK')
    const fn = vi.fn().mockResolvedValueOnce(freshData)

    const { withCache } = await import('@/lib/cache/with-cache')
    const result = await withCache('test:wc:2', 3600, fn)

    expect(result).toEqual(freshData)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still computes when cache read fails', async () => {
    const freshData = { id: '3', value: 'fresh' }
    mockGet.mockRejectedValueOnce(new Error('Redis down'))
    mockSetex.mockResolvedValueOnce('OK')
    const fn = vi.fn().mockResolvedValueOnce(freshData)

    const { withCache } = await import('@/lib/cache/with-cache')
    const result = await withCache('test:wc:3', 3600, fn)

    expect(result).toEqual(freshData)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('propagates computation errors', async () => {
    mockGet.mockResolvedValueOnce(null)
    const fn = vi.fn().mockRejectedValueOnce(new Error('Computation failed'))

    const { withCache } = await import('@/lib/cache/with-cache')
    await expect(withCache('test:wc:4', 3600, fn)).rejects.toThrow('Computation failed')
  })
})
