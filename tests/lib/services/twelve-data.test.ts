import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBatchQuotes, quoteItems } from '@/lib/services/twelve-data'

// Shapes recorded from api.twelvedata.com/quote on 2026-09-15.
const AAPL = { symbol: 'AAPL', close: '333.079987', previous_close: '332.26999', change: '0.80999756', percent_change: '0.24377692', currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc.' }
const MSFT = { symbol: 'MSFT', close: '505.41000', previous_close: '495.63000', change: '9.78000', percent_change: '1.97325', currency: 'USD', exchange: 'NASDAQ', name: 'Microsoft Corporation' }

describe('quoteItems', () => {
  it('reads one symbol as the quote itself', () => {
    expect(quoteItems(AAPL)).toEqual([['AAPL', AAPL]])
  })

  it('reads several symbols as an object keyed by symbol', () => {
    expect(quoteItems({ AAPL, MSFT })).toEqual([['AAPL', AAPL], ['MSFT', MSFT]])
  })

  it('keeps a per-symbol error so the caller can skip it, and a top-level error as one item', () => {
    const missing = { code: 404, message: 'symbol not found', status: 'error' }
    expect(quoteItems({ AAPL, XXXX: missing })).toEqual([['AAPL', AAPL], ['XXXX', missing]])
    expect(quoteItems({ code: 429, message: 'out of credits', status: 'error' })).toHaveLength(1)
  })

  it('accepts an array and ignores anything that is not an object', () => {
    expect(quoteItems([AAPL, null, 'x'])).toEqual([['AAPL', AAPL]])
    expect(quoteItems(null)).toEqual([])
    expect(quoteItems('nope')).toEqual([])
  })
})

describe('getBatchQuotes', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('returns every symbol of a multi-symbol response with its daily change', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ AAPL, MSFT }) })

    const quotes = await getBatchQuotes(['AAPL', 'MSFT'])

    expect(Object.keys(quotes)).toEqual(['AAPL', 'MSFT'])
    expect(quotes.AAPL).toMatchObject({ price: 333.079987, previousClose: 332.26999, changePct: 0.24377692 })
    expect(quotes.MSFT).toMatchObject({ price: 505.41, previousClose: 495.63, changePct: 1.97325 })
  })

  it('leaves out a symbol the provider could not quote', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ AAPL, XXXX: { code: 404, message: 'symbol not found', status: 'error' } }),
    })

    expect(Object.keys(await getBatchQuotes(['AAPL', 'XXXX']))).toEqual(['AAPL'])
  })
})
