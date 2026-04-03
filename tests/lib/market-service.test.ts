import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock global fetch to prevent real HTTP calls to Yahoo Finance
const mockFetch = vi.fn().mockResolvedValue({
  ok: false,
  json: async () => ({}),
})
vi.stubGlobal('fetch', mockFetch)

// Mock external data sources
vi.mock('@/lib/services/twelve-data', () => ({
  isAvailable: vi.fn().mockResolvedValue(true),
  getQuote: vi.fn(),
  getBatchQuotes: vi.fn(),
  getHistory: vi.fn(),
  searchSymbols: vi.fn(),
}))

vi.mock('@/lib/services/finnhub', () => ({
  isAvailable: vi.fn().mockResolvedValue(true),
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}))

// Mock Redis cache
vi.mock('@/lib/cache/redis', () => ({
  getCachedPrice: vi.fn().mockResolvedValue(null),
  cachePrice: vi.fn(),
  getCachedBatchPrices: vi.fn().mockResolvedValue({}),
  cacheBatchPrices: vi.fn(),
}))

// Mock resilience utilities - use function keyword for constructor compatibility
vi.mock('@/lib/services/resilience', () => {
  function CircuitBreakerMock() {
    return {
      execute: vi.fn((fn: () => unknown) => fn()),
      getState: vi.fn().mockReturnValue('closed'),
      reset: vi.fn(),
    }
  }
  return {
    withRetry: vi.fn((fn: () => unknown) => fn()),
    CircuitBreaker: CircuitBreakerMock,
  }
})

import {
  getQuote,
  getBatchQuotes,
  getHistory,
  searchSymbols,
  clearQuoteCache,
  getActiveSource,
} from '@/lib/services/market'
import * as twelveData from '@/lib/services/twelve-data'
import * as finnhub from '@/lib/services/finnhub'
import * as cache from '@/lib/cache/redis'

describe('Market Service', () => {
  beforeEach(() => {
    clearQuoteCache()
    vi.clearAllMocks()
    // Restore fetch mock after clearAllMocks
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) })
  })

  describe('getQuote', () => {
    it('returns quote from primary source (Twelve Data)', async () => {
      const mockQuote = {
        symbol: 'AAPL',
        price: 150.25,
        previousClose: 149.5,
        change: 0.75,
        changePct: 0.5,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      const result = await getQuote('AAPL')

      expect(result).toEqual(mockQuote)
      expect(twelveData.getQuote).toHaveBeenCalledWith('AAPL')
      expect(cache.cachePrice).toHaveBeenCalledWith('AAPL', 150.25, expect.any(Number))
    })

    it('falls back to Finnhub when Twelve Data fails', async () => {
      const finnhubRaw = {
        symbol: 'AAPL',
        price: 150.25,
        previousClose: 149.5,
        change: 0.75,
        changePct: 0.5,
        currency: 'USD',
        exchange: 'NASDAQ',
      }

      vi.mocked(twelveData.getQuote).mockRejectedValueOnce(new Error('Twelve Data unavailable'))
      vi.mocked(finnhub.getQuote).mockResolvedValueOnce(finnhubRaw)

      const result = await getQuote('AAPL')

      // Finnhub path wraps result as QuoteResult (no name field)
      expect(result).toEqual(finnhubRaw)
      expect(twelveData.getQuote).toHaveBeenCalledWith('AAPL')
      expect(finnhub.getQuote).toHaveBeenCalledWith('AAPL')
    })

    it('returns null when all sources fail', async () => {
      vi.mocked(twelveData.getQuote).mockRejectedValueOnce(new Error('Twelve Data failed'))
      vi.mocked(finnhub.getQuote).mockRejectedValueOnce(new Error('Finnhub failed'))

      const result = await getQuote('INVALID')

      // Yahoo fallback also returns null because fetch is mocked to fail
      expect(result).toBeNull()
      expect(twelveData.getQuote).toHaveBeenCalled()
      expect(finnhub.getQuote).toHaveBeenCalled()
    })

    it('serves from in-memory cache on second call', async () => {
      const mockQuote = {
        symbol: 'GOOGL',
        price: 140.5,
        previousClose: 139.0,
        change: 1.5,
        changePct: 1.08,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Alphabet Inc',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      // First call
      const result1 = await getQuote('GOOGL')
      expect(result1).toEqual(mockQuote)

      // Second call should use in-memory cache
      const result2 = await getQuote('GOOGL')
      expect(result2).toEqual(mockQuote)

      // Should only call external service once
      expect(twelveData.getQuote).toHaveBeenCalledTimes(1)
    })

    it('uses Redis cache when available', async () => {
      const cachedPrice = 145.75
      vi.mocked(cache.getCachedPrice).mockResolvedValueOnce(cachedPrice)

      const result = await getQuote('MSFT')

      expect(result?.price).toBe(cachedPrice)
      expect(cache.getCachedPrice).toHaveBeenCalledWith('MSFT')
      // Should not call external services
      expect(twelveData.getQuote).not.toHaveBeenCalled()
    })

    it('handles timeout gracefully', async () => {
      const timeoutError = new Error('Timeout')
      vi.mocked(twelveData.getQuote).mockRejectedValueOnce(timeoutError)
      vi.mocked(finnhub.getQuote).mockRejectedValueOnce(timeoutError)

      const result = await getQuote('TIMEOUT')

      expect(result).toBeNull()
    })

    it('caches result in in-memory cache for reuse', async () => {
      const mockQuote = {
        symbol: 'AAPL',
        price: 150,
        previousClose: 149,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      // First call stores in cache
      const result1 = await getQuote('aapl')
      expect(result1).toBeDefined()
      expect(result1?.price).toBe(150)

      // Second call with uppercase should hit cache (cache normalizes to uppercase)
      const result2 = await getQuote('AAPL')
      expect(result2?.price).toBe(150)
      // Only one external call
      expect(twelveData.getQuote).toHaveBeenCalledTimes(1)
    })

    it('skips source when price is null and tries next', async () => {
      const nullPriceQuote = {
        symbol: 'AAPL',
        price: null,
        previousClose: 149,
        change: null,
        changePct: null,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      }

      const finnhubQuote = {
        symbol: 'AAPL',
        price: 150,
        previousClose: 149,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
        exchange: 'NASDAQ',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(nullPriceQuote)
      vi.mocked(finnhub.getQuote).mockResolvedValueOnce(finnhubQuote)

      const result = await getQuote('AAPL')

      // Should skip Twelve Data (null price) and use Finnhub
      expect(result?.price).toBe(150)
      expect(finnhub.getQuote).toHaveBeenCalled()
    })
  })

  describe('getBatchQuotes', () => {
    it('fetches multiple symbols in one batch call', async () => {
      const mockBatchQuotes = {
        AAPL: {
          symbol: 'AAPL',
          price: 150,
          previousClose: 149,
          change: 1,
          changePct: 0.67,
          currency: 'USD',
          exchange: 'NASDAQ',
          name: 'Apple Inc',
        },
        GOOGL: {
          symbol: 'GOOGL',
          price: 140,
          previousClose: 139,
          change: 1,
          changePct: 0.72,
          currency: 'USD',
          exchange: 'NASDAQ',
          name: 'Alphabet Inc',
        },
      }

      vi.mocked(twelveData.getBatchQuotes).mockResolvedValueOnce(mockBatchQuotes)
      vi.mocked(cache.getCachedBatchPrices).mockResolvedValueOnce({})

      const result = await getBatchQuotes(['AAPL', 'GOOGL'])

      // getBatchQuotes returns simplified objects { price, change, changePct, currency }
      expect(result.AAPL.price).toBe(150)
      expect(result.AAPL.change).toBe(1)
      expect(result.GOOGL.price).toBe(140)
      expect(twelveData.getBatchQuotes).toHaveBeenCalledWith(['AAPL', 'GOOGL'])
      expect(cache.cacheBatchPrices).toHaveBeenCalled()
    })

    it('serves cached symbols and fetches only uncached', async () => {
      const cachedPrices = {
        AAPL: 150,
        MSFT: 380,
      }

      const uncachedQuote = {
        GOOGL: {
          symbol: 'GOOGL',
          price: 140,
          previousClose: 139,
          change: 1,
          changePct: 0.72,
          currency: 'USD',
          exchange: 'NASDAQ',
          name: 'Alphabet Inc',
        },
      }

      vi.mocked(cache.getCachedBatchPrices).mockResolvedValueOnce(cachedPrices)
      vi.mocked(twelveData.getBatchQuotes).mockResolvedValueOnce(uncachedQuote)

      const result = await getBatchQuotes(['AAPL', 'GOOGL', 'MSFT'])

      expect(result.AAPL.price).toBe(150)
      expect(result.MSFT.price).toBe(380)
      expect(result.GOOGL.price).toBe(140)

      // Should only fetch uncached symbol
      expect(twelveData.getBatchQuotes).toHaveBeenCalledWith(['GOOGL'])
    })

    it('falls back to Finnhub when batch fails', async () => {
      const finnhubQuote = {
        symbol: 'AAPL',
        price: 150,
        previousClose: 149,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
        exchange: 'NASDAQ',
      }

      vi.mocked(cache.getCachedBatchPrices).mockResolvedValueOnce({})
      vi.mocked(twelveData.getBatchQuotes).mockRejectedValueOnce(new Error('Batch failed'))

      // When batch fails, code falls through to Finnhub individual calls
      vi.mocked(finnhub.getQuote).mockResolvedValueOnce(finnhubQuote)

      const result = await getBatchQuotes(['AAPL'])

      expect(result.AAPL.price).toBe(150)
      expect(twelveData.getBatchQuotes).toHaveBeenCalled()
      expect(finnhub.getQuote).toHaveBeenCalled()
    })

    it('returns empty object for empty symbol list', async () => {
      const result = await getBatchQuotes([])

      expect(result).toEqual({})
      expect(twelveData.getBatchQuotes).not.toHaveBeenCalled()
    })

    it('includes change and currency in batch results', async () => {
      const mockBatchQuotes = {
        AAPL: {
          symbol: 'AAPL',
          price: 150,
          previousClose: 149,
          change: 1,
          changePct: 0.67,
          currency: 'USD',
          exchange: 'NASDAQ',
          name: 'Apple Inc',
        },
      }

      vi.mocked(cache.getCachedBatchPrices).mockResolvedValueOnce({})
      vi.mocked(twelveData.getBatchQuotes).mockResolvedValueOnce(mockBatchQuotes)

      const result = await getBatchQuotes(['AAPL'])

      expect(result.AAPL).toMatchObject({
        price: 150,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
      })
    })
  })

  describe('getHistory', () => {
    it('returns historical data from primary source', async () => {
      const mockHistory = [
        { date: '2024-01-01', close: 150, open: null, high: null, low: null, volume: null },
        { date: '2024-01-02', close: 151, open: null, high: null, low: null, volume: null },
        { date: '2024-01-03', close: 149, open: null, high: null, low: null, volume: null },
      ]

      vi.mocked(twelveData.getHistory).mockResolvedValueOnce(mockHistory)

      const result = await getHistory('AAPL', '1mo')

      expect(result).toEqual(mockHistory)
      expect(twelveData.getHistory).toHaveBeenCalledWith('AAPL', '1mo')
    })

    it('falls back to Finnhub when Twelve Data fails', async () => {
      const mockHistory = [
        { date: '2024-01-01', close: 150, open: null, high: null, low: null, volume: null },
        { date: '2024-01-02', close: 151, open: null, high: null, low: null, volume: null },
      ]

      vi.mocked(twelveData.getHistory).mockRejectedValueOnce(new Error('Twelve Data failed'))
      vi.mocked(finnhub.getHistory).mockResolvedValueOnce(mockHistory)

      const result = await getHistory('AAPL', '1mo')

      expect(result).toEqual(mockHistory)
      expect(twelveData.getHistory).toHaveBeenCalled()
      expect(finnhub.getHistory).toHaveBeenCalled()
    })

    it('returns empty array when all sources fail', async () => {
      vi.mocked(twelveData.getHistory).mockRejectedValueOnce(new Error('Failed'))
      vi.mocked(finnhub.getHistory).mockRejectedValueOnce(new Error('Failed'))

      const result = await getHistory('INVALID', '1mo')

      // Yahoo fallback returns [] because fetch mock returns !ok
      expect(result).toEqual([])
    })
  })

  describe('searchSymbols', () => {
    it('returns search results from Twelve Data', async () => {
      const mockResults = [
        { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', type: 'Common Stock', exchDisp: 'NASDAQ' },
        { symbol: 'AAPL.F', name: 'Apple Inc - ADR', exchange: 'FRANKFURT', type: 'Common Stock', exchDisp: 'FRANKFURT' },
      ]

      vi.mocked(twelveData.searchSymbols).mockResolvedValueOnce(mockResults)

      const result = await searchSymbols('Apple')

      expect(result).toEqual(mockResults)
      expect(twelveData.searchSymbols).toHaveBeenCalledWith('Apple')
    })

    it('falls back to Yahoo when primary fails', async () => {
      vi.mocked(twelveData.searchSymbols).mockRejectedValueOnce(new Error('Failed'))

      const result = await searchSymbols('Apple')

      expect(twelveData.searchSymbols).toHaveBeenCalled()
      // Yahoo fallback returns [] because fetch mock returns !ok
      expect(result).toEqual([])
    })

    it('returns empty array when all sources fail', async () => {
      vi.mocked(twelveData.searchSymbols).mockRejectedValueOnce(new Error('Search failed'))

      const result = await searchSymbols('XYZ')

      expect(result).toEqual([])
    })
  })

  describe('getActiveSource', () => {
    it('returns twelve-data when available', async () => {
      vi.mocked(twelveData.isAvailable).mockResolvedValueOnce(true)

      const source = await getActiveSource()

      expect(source).toBe('twelve-data')
    })

    it('returns finnhub when twelve-data unavailable', async () => {
      vi.mocked(twelveData.isAvailable).mockResolvedValueOnce(false)
      vi.mocked(finnhub.isAvailable).mockResolvedValueOnce(true)

      const source = await getActiveSource()

      expect(source).toBe('finnhub')
    })

    it('returns yahoo when all others unavailable', async () => {
      vi.mocked(twelveData.isAvailable).mockResolvedValueOnce(false)
      vi.mocked(finnhub.isAvailable).mockResolvedValueOnce(false)

      const source = await getActiveSource()

      expect(source).toBe('yahoo')
    })
  })

  describe('clearQuoteCache', () => {
    it('clears in-memory quote cache', async () => {
      const mockQuote = {
        symbol: 'AAPL',
        price: 150,
        previousClose: 149,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      // First call caches in-memory
      await getQuote('AAPL')

      // Clear cache
      clearQuoteCache()

      // Reset mock for second call
      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      // Second call should hit external service again
      await getQuote('AAPL')

      expect(twelveData.getQuote).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling and resilience', () => {
    it('handles malformed API responses gracefully', async () => {
      vi.mocked(twelveData.getQuote).mockResolvedValueOnce({
        symbol: 'AAPL',
        price: undefined as unknown as number,
        previousClose: null,
        change: null,
        changePct: null,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // price is undefined → skips, goes to Finnhub
      vi.mocked(finnhub.getQuote).mockResolvedValueOnce({
        symbol: 'AAPL',
        price: 150,
        previousClose: null,
        change: null,
        changePct: null,
        currency: 'USD',
        exchange: '',
      })

      const result = await getQuote('AAPL')

      expect(result).toBeDefined()
      expect(result?.price).toBe(150)
    })

    it('handles network timeouts from all sources', async () => {
      const timeoutError = new Error('Network timeout')
      vi.mocked(twelveData.getQuote).mockRejectedValueOnce(timeoutError)
      vi.mocked(finnhub.getQuote).mockRejectedValueOnce(timeoutError)

      const result = await getQuote('AAPL')

      // Yahoo also fails (fetch mock returns !ok) → null
      expect(result).toBeNull()
    })

    it('caches successful quotes to Redis', async () => {
      const mockQuote = {
        symbol: 'AAPL',
        price: 150,
        previousClose: 149,
        change: 1,
        changePct: 0.67,
        currency: 'USD',
        exchange: 'NASDAQ',
        name: 'Apple Inc',
      }

      vi.mocked(twelveData.getQuote).mockResolvedValueOnce(mockQuote)

      const result = await getQuote('AAPL')

      expect(result).toEqual(mockQuote)
      expect(cache.cachePrice).toHaveBeenCalledWith('AAPL', 150, 300)
    })
  })
})
