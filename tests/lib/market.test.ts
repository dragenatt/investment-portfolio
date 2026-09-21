import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getQuote, getBatchQuotes, searchSymbols, getHistory, clearQuoteCache, clearHistoryCache } from '@/lib/services/market'

// Mock the twelve-data module
vi.mock('@/lib/services/twelve-data', () => ({
  isAvailable: vi.fn().mockResolvedValue(false),
  searchSymbols: vi.fn().mockResolvedValue([]),
  getQuote: vi.fn().mockResolvedValue(null),
  getHistory: vi.fn().mockResolvedValue([]),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
  clearQuoteCache()
  clearHistoryCache()
})

/** Yahoo's spark endpoint answering that it knows none of the symbols asked for. */
function sparkKnowsNothing() {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ spark: { result: [] } }) })
}

/** A spark answer for the given chart metas. */
function sparkAnswer(metas: Array<Record<string, unknown>>) {
  return {
    ok: true,
    json: async () => ({
      spark: { result: metas.map((meta) => ({ symbol: meta.symbol, response: [{ meta }] })), error: null },
    }),
  }
}

describe('getQuote from Yahoo spark, the live source', () => {
  it('reads the price and the previous session close from one spark request', async () => {
    mockFetch.mockResolvedValueOnce(
      sparkAnswer([{ symbol: 'AAPL', regularMarketPrice: 338.98, chartPreviousClose: 336.13, currency: 'USD', shortName: 'Apple Inc.' }]),
    )

    const quote = await getQuote('AAPL')

    expect(quote).toMatchObject({ symbol: 'AAPL', price: 338.98, previousClose: 336.13, currency: 'USD', name: 'Apple Inc.' })
    expect(quote!.change).toBeCloseTo(2.85, 2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toContain('/v7/finance/spark?symbols=AAPL')
    // Live data never goes through Next's data cache, which serves stale copies.
    expect(mockFetch.mock.calls[0][1]).toEqual({ cache: 'no-store' })
  })
})

describe('getBatchQuotes from Yahoo spark', () => {
  it('prices a whole book in one request per twenty symbols', async () => {
    const symbols = Array.from({ length: 25 }, (_, i) => `S${i}`)
    mockFetch.mockImplementation(async (url: string) => {
      const asked = decodeURIComponent(new URL(url).searchParams.get('symbols') ?? '').split(',')
      return sparkAnswer(asked.map((symbol) => ({ symbol, regularMarketPrice: 10, chartPreviousClose: 9, currency: 'USD' })))
    })

    const quotes = await getBatchQuotes(symbols)

    expect(Object.keys(quotes)).toHaveLength(25)
    expect(quotes.S0).toMatchObject({ price: 10, previousClose: 9, currency: 'USD' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('leaves a symbol spark does not know to the other providers', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v7/finance/spark')
        ? sparkAnswer([{ symbol: 'AAPL', regularMarketPrice: 10, chartPreviousClose: 9, currency: 'USD' }])
        : { ok: false },
    )

    const quotes = await getBatchQuotes(['AAPL', 'NOPE'])

    expect(quotes.AAPL?.price).toBe(10)
    expect(quotes.NOPE).toBeUndefined()
    // The per-symbol chart fallback was still asked about the unknown one.
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/v8/finance/chart/NOPE'))).toBe(true)
  })
})

describe('getQuote', () => {
  it('returns correct format from Yahoo fallback', async () => {
    sparkKnowsNothing()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              symbol: 'AAPL',
              regularMarketPrice: 175.50,
              previousClose: 174.00,
              currency: 'USD',
              exchangeName: 'NASDAQ',
              marketState: 'REGULAR',
            },
          }],
        },
      }),
    })

    const quote = await getQuote('AAPL')
    expect(quote).not.toBeNull()
    expect(quote!.symbol).toBe('AAPL')
    expect(quote!.price).toBe(175.50)
    expect(quote!.previousClose).toBe(174.00)
    expect(quote!.change).toBeCloseTo(1.50)
    expect(quote!.changePct).toBeCloseTo((1.50 / 174.00) * 100, 2)
    expect(quote!.currency).toBe('USD')
  })

  it('takes the daily change from chartPreviousClose, the field Yahoo sends today', async () => {
    sparkKnowsNothing()
    // Recorded 2026-09-15: the chart meta has no previousClose at all.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              symbol: 'AAPL',
              regularMarketPrice: 333.08,
              chartPreviousClose: 332.27,
              regularMarketChangePercent: 0.244,
              currency: 'USD',
              exchangeName: 'NMS',
            },
          }],
        },
      }),
    })

    const quote = await getQuote('AAPL')
    expect(quote!.previousClose).toBe(332.27)
    expect(quote!.change).toBeCloseTo(0.81, 2)
    expect(quote!.changePct).toBeCloseTo(0.244, 2)
  })

  it('returns null when Yahoo returns no result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chart: { result: null } }),
    })

    const quote = await getQuote('INVALID')
    expect(quote).toBeNull()
  })

  it('returns null when Yahoo fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const quote = await getQuote('AAPL')
    expect(quote).toBeNull()
  })

  it('handles missing price fields gracefully', async () => {
    sparkKnowsNothing()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              symbol: 'TEST',
              currency: 'USD',
              exchangeName: 'NYSE',
            },
          }],
        },
      }),
    })

    const quote = await getQuote('TEST')
    expect(quote).not.toBeNull()
    expect(quote!.price).toBeNull()
    expect(quote!.previousClose).toBeNull()
    expect(quote!.change).toBeNull()
  })
})

describe('getQuote with Twelve Data fallback', () => {
  it('falls back to Yahoo when Twelve Data fails', async () => {
    const twelveData = await import('@/lib/services/twelve-data')
    vi.mocked(twelveData.isAvailable).mockResolvedValueOnce(true)
    vi.mocked(twelveData.getQuote).mockRejectedValueOnce(new Error('API error'))
    sparkKnowsNothing()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              symbol: 'AAPL',
              regularMarketPrice: 175.50,
              previousClose: 174.00,
              currency: 'USD',
              exchangeName: 'NASDAQ',
              marketState: 'REGULAR',
            },
          }],
        },
      }),
    })

    const quote = await getQuote('AAPL')
    expect(quote).not.toBeNull()
    expect(quote!.symbol).toBe('AAPL')
    expect(quote!.price).toBe(175.50)
  })
})

describe('searchSymbols', () => {
  it('returns formatted results from Yahoo fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quotes: [
          { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS', exchDisp: 'NASDAQ' },
          { symbol: 'AAPLX', longname: 'Apple Fund', quoteType: 'MUTUALFUND', exchange: 'NAS', exchDisp: 'NASDAQ' },
        ],
      }),
    })

    const results = await searchSymbols('AAPL')
    expect(results).toHaveLength(2)
    expect(results[0].symbol).toBe('AAPL')
    expect(results[0].name).toBe('Apple Inc.')
    expect(results[1].name).toBe('Apple Fund')
  })

  it('returns empty array when Yahoo search fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const results = await searchSymbols('AAPL')
    expect(results).toEqual([])
  })
})

describe('getHistory', () => {
  it('returns chronological data from Yahoo', async () => {
    const now = Math.floor(Date.now() / 1000)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [now - 86400, now],
            indicators: {
              quote: [{
                open: [100, 102],
                high: [105, 106],
                low: [99, 101],
                close: [103, 104],
                volume: [1000000, 1200000],
              }],
            },
          }],
        },
      }),
    })

    const history = await getHistory('AAPL', '1mo')
    expect(history).toHaveLength(2)
    expect(history[0].close).toBe(103)
    expect(history[1].close).toBe(104)
    expect(history[0].volume).toBe(1000000)
  })

  it('filters out null close values', async () => {
    const now = Math.floor(Date.now() / 1000)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [now - 172800, now - 86400, now],
            indicators: {
              quote: [{
                open: [100, null, 102],
                high: [105, null, 106],
                low: [99, null, 101],
                close: [103, null, 104],
                volume: [1000000, null, 1200000],
              }],
            },
          }],
        },
      }),
    })

    const history = await getHistory('AAPL', '1mo')
    expect(history).toHaveLength(2)
  })

  it('returns empty array on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const history = await getHistory('AAPL')
    expect(history).toEqual([])
  })
})
