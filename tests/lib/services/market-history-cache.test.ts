import { describe, it, expect, vi, beforeEach } from 'vitest'

// Opening one asset's page asked five times for price history, two of those
// for literally the same symbol and range, and every one of them walked the
// provider chain from zero — getQuote had a cache, getHistory had none.

const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/services/twelve-data', () => ({
  isAvailable: vi.fn().mockResolvedValue(true),
  getQuote: vi.fn(),
  getBatchQuotes: vi.fn(),
  getHistory: vi.fn(),
  searchSymbols: vi.fn(),
}))

vi.mock('@/lib/services/finnhub', () => ({
  isAvailable: vi.fn().mockResolvedValue(false),
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}))

vi.mock('@/lib/cache/redis', () => ({
  cachePrice: vi.fn(),
  getCachedPriceEntries: vi.fn().mockResolvedValue({}),
  cacheBatchPrices: vi.fn(),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  CACHE_KEYS: { MARKET_HISTORY: 'market:history:' },
}))

import { getHistory, clearHistoryCache } from '@/lib/services/market'
import * as twelveData from '@/lib/services/twelve-data'
import * as cache from '@/lib/cache/redis'

const BARS = [
  { date: '2026-09-01', close: 100, open: null, high: null, low: null, volume: null },
  { date: '2026-09-02', close: 101, open: null, high: null, low: null, volume: null },
]

beforeEach(() => {
  clearHistoryCache()
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) })
  vi.mocked(cache.cacheGet).mockResolvedValue(null)
  vi.mocked(twelveData.getHistory).mockResolvedValue(BARS)
})

describe('getHistory cache', () => {
  it('asks the provider once for the same symbol and range', async () => {
    const first = await getHistory('AAPL', '6mo')
    const second = await getHistory('AAPL', '6mo')

    expect(second).toEqual(first)
    expect(twelveData.getHistory).toHaveBeenCalledTimes(1)
  })

  it('is case-insensitive about the symbol, the way the callers are not', async () => {
    // /stats upper-cases the symbol, /signal passes the path through as typed.
    await getHistory('aapl', '6mo')
    await getHistory('AAPL', '6mo')

    expect(twelveData.getHistory).toHaveBeenCalledTimes(1)
  })

  it('keeps the ranges apart — 6mo and 5y are different series', async () => {
    await getHistory('AAPL', '6mo')
    await getHistory('AAPL', '5y')

    expect(twelveData.getHistory).toHaveBeenCalledTimes(2)
  })

  it('shares the series through Redis, so the next invocation starts warm', async () => {
    await getHistory('AAPL', '6mo')

    expect(cache.cacheSet).toHaveBeenCalledWith('market:history:AAPL:6mo', BARS, 3600)
  })

  it('serves a Redis hit without touching a provider', async () => {
    vi.mocked(cache.cacheGet).mockResolvedValue(BARS)

    const result = await getHistory('MSFT', '1y')

    expect(result).toEqual(BARS)
    expect(twelveData.getHistory).not.toHaveBeenCalled()
  })

  it('gives an intraday range the shorter life', async () => {
    await getHistory('AAPL', '1d')

    expect(cache.cacheSet).toHaveBeenCalledWith('market:history:AAPL:1d', BARS, 300)
  })

  it('does not remember an empty series', async () => {
    // Every source failing returns []. Caching that for an hour would turn one
    // bad minute into an hour of empty charts.
    vi.mocked(twelveData.getHistory).mockResolvedValue([])

    const first = await getHistory('NVDA', '6mo')
    vi.mocked(twelveData.getHistory).mockResolvedValue(BARS)
    const second = await getHistory('NVDA', '6mo')

    expect(first).toEqual([])
    expect(second).toEqual(BARS)
    expect(cache.cacheSet).not.toHaveBeenCalledWith(expect.stringContaining('NVDA'), [], expect.anything())
  })

  it('expires: a series older than its TTL is fetched again', async () => {
    vi.useFakeTimers()
    try {
      await getHistory('AAPL', '6mo')
      vi.advanceTimersByTime(3_600_001)
      await getHistory('AAPL', '6mo')

      expect(twelveData.getHistory).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
