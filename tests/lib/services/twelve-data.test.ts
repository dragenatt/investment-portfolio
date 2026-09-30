import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBatchQuotes, quoteItems, searchSymbols } from '@/lib/services/twelve-data'

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

describe('searchSymbols', () => {
  const fetchMock = vi.fn()

  // Listings as api.twelvedata.com/symbol_search sent them on 2026-09-30.
  const listing = (symbol: string, name: string, exchange: string, mic: string, country: string, type = 'Common Stock') => ({
    symbol, instrument_name: name, exchange, mic_code: mic, exchange_timezone: '', instrument_type: type, country, currency: '',
  })

  function answers(data: unknown[]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data, status: 'ok' }) })
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('sends the key when there is one, like every other call here', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key')
    answers([])

    await searchSymbols('apple')

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/symbol_search')
    expect(url.searchParams.get('symbol')).toBe('apple')
    expect(url.searchParams.get('apikey')).toBe('test-key')
  })

  it('still searches without a key, which the endpoint answers today', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', '')
    answers([listing('AAPL', 'Apple Inc', 'NASDAQ', 'XNGS', 'United States')])

    const results = await searchSymbols('AAPL')

    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has('apikey')).toBe(false)
    expect(results.map((r) => r.symbol)).toEqual(['AAPL'])
  })

  it('writes a BMV listing with .MX, the spelling that prices, and a series with a dash', async () => {
    answers([
      listing('WALMEX', 'Walmart de México, S.A.B. de C.V.', 'BMV', 'XMEX', 'Mexico'),
      listing('AAPL', 'Apple Inc.', 'BMV', 'XMEX', 'Mexico'),
      listing('LIVEPOLC.1', 'El Puerto de Liverpool, S.A.B. de C.V.', 'BMV', 'XMEX', 'Mexico'),
      listing('PETR4', 'Petrobras', 'Bovespa', 'BVMF', 'Brazil', 'Preferred Stock'),
    ])

    const results = await searchSymbols('x')

    expect(results.map((r) => r.symbol)).toEqual(['WALMEX.MX', 'AAPL.MX', 'LIVEPOLC-1.MX', 'PETR4.SA'])
    expect(results[0]).toEqual({
      symbol: 'WALMEX.MX',
      name: 'Walmart de México, S.A.B. de C.V.',
      type: 'Common Stock',
      exchange: 'BMV',
      exchDisp: 'BMV',
    })
  })

  it('leaves out a listing whose bare ticker would be another instrument, and each symbol after its first', async () => {
    answers([
      listing('GLD', 'NewGold Issuer Ltd.', 'JSE', 'XJSE', 'South Africa', 'ETF'),
      listing('GLD', 'SPDR Gold Shares', 'NYSE', 'ARCX', 'United States', 'ETF'),
      listing('GLD', 'SPDR Gold Shares', 'BCBA', 'XBUE', 'Argentina', 'ETF'),
      listing('GLD', 'SPDR Gold Shares', 'IEX', 'IEXG', 'United States', 'ETF'),
      listing('GLD', 'SPDR Gold Shares', 'BMV', 'XMEX', 'Mexico', 'ETF'),
    ])

    const results = await searchSymbols('GLD')

    expect(results.map((r) => [r.symbol, r.name])).toEqual([
      ['GLD', 'SPDR Gold Shares'],
      ['GLD.MX', 'SPDR Gold Shares'],
    ])
  })

  it('answers nothing when Twelve Data refuses, so the next provider is asked', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ code: 429, status: 'error' }) })

    expect(await searchSymbols('apple')).toEqual([])
  })
})
