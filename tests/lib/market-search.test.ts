import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchSymbols } from '@/lib/services/market'
import { ASSET_UNIVERSE } from '@/lib/data/asset-universe'

// Search with every provider down, the way they go down: refusing (a 429 from
// Yahoo's search, a 401 from Finnhub, Twelve Data out of credits), unreachable,
// or hanging. The real twelve-data and finnhub modules run, keyed, so what is
// simulated is only the network under them.

const fetchMock = vi.fn()

type Route = 'twelve-data' | 'finnhub' | 'yahoo'

function routeOf(url: string): Route {
  if (url.startsWith('https://api.twelvedata.com/symbol_search')) return 'twelve-data'
  if (url.startsWith('https://finnhub.io/api/v1/search')) return 'finnhub'
  if (url.startsWith('https://query1.finance.yahoo.com/v1/finance/search')) return 'yahoo'
  throw new Error(`search asked for something else: ${url}`)
}

const REFUSALS: Record<Route, { status: number; body: unknown }> = {
  'twelve-data': { status: 429, body: { code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' } },
  finnhub: { status: 401, body: { error: 'Invalid API key.' } },
  yahoo: { status: 429, body: 'Edge: Too Many Requests' },
}

function everyProviderRefuses() {
  fetchMock.mockImplementation(async (url: string) => {
    const { status, body } = REFUSALS[routeOf(url)]
    return { ok: false, status, json: async () => body }
  })
}

function everyProviderUnreachable() {
  fetchMock.mockImplementation(async (url: string) => {
    routeOf(url)
    throw new TypeError('fetch failed')
  })
}

function everyProviderHangs() {
  fetchMock.mockImplementation((url: string) => {
    routeOf(url)
    return new Promise(() => {})
  })
}

/** Which providers the search asked, in order. */
function asked(): Route[] {
  return fetchMock.mock.calls.map(([url]) => routeOf(String(url)))
}

beforeEach(() => {
  vi.stubEnv('TWELVE_DATA_API_KEY', 'td-test-key')
  vi.stubEnv('FINNHUB_API_KEY', 'fh-test-key')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

// A query as people type it → the asset it has to find first.
const KNOWN: Array<[string, string]> = [
  ['AAPL', 'AAPL'],
  ['apple', 'AAPL'],
  ['  Apple  ', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['nvidia', 'NVDA'],
  ['coca cola', 'KO'],
  ['cocacola', 'KO'],
  ['berkshire', 'BRK.B'],
  ['brk.b', 'BRK.B'],
  ['jp morgan', 'JPM'],
  ['walmex', 'WALMEX.MX'],
  ['Walmart de México', 'WALMEX.MX'],
  ['walmart mexico', 'WALMEX.MX'],
  ['banorte', 'GFNORTEO.MX'],
  ['oxxo', 'FEMSAUBD.MX'],
  ['america movil', 'AMXB.MX'],
  ['telcel', 'AMXB.MX'],
  ['cemex', 'CEMEXCPO.MX'],
  ['fibra uno', 'FUNO11.MX'],
  ['naftrac', 'NAFTRACISHRS.MX'],
  ['sp500', '^GSPC'],
  ['S&P 500', '^GSPC'],
  ['ipc', '^MXX'],
  ['bitcoin', 'BTC-USD'],
]

describe('search with every provider down', () => {
  it('finds each known asset from the local dictionary when all three refuse', async () => {
    everyProviderRefuses()

    for (const [query, symbol] of KNOWN) {
      fetchMock.mockClear()
      const results = await searchSymbols(query)
      expect(results[0]?.symbol, `"${query}"`).toBe(symbol)
      // All three were really asked, in order, before the dictionary answered.
      expect(asked(), `"${query}"`).toEqual(['twelve-data', 'finnhub', 'yahoo'])
    }
  })

  it('finds every asset the sector browser offers, by its symbol and by its name', async () => {
    everyProviderRefuses()

    for (const asset of ASSET_UNIVERSE) {
      expect((await searchSymbols(asset.symbol)).map((r) => r.symbol), asset.symbol).toContain(asset.symbol)
      expect((await searchSymbols(asset.name)).map((r) => r.symbol), asset.name).toContain(asset.symbol)
    }
  })

  it('answers from the dictionary when the network itself fails, instead of throwing', async () => {
    everyProviderUnreachable()

    const results = await searchSymbols('apple')

    expect(results[0]).toEqual({ symbol: 'AAPL', name: 'Apple', type: 'stock', exchange: 'US', exchDisp: 'US' })
    expect(asked()).toEqual(['twelve-data', 'finnhub', 'yahoo'])
  })

  it('answers from the dictionary when every provider hangs, once each has had its time', async () => {
    vi.useFakeTimers()
    everyProviderHangs()

    const pending = searchSymbols('banorte')
    await vi.advanceTimersByTimeAsync(3 * 4_000)
    const results = await pending

    expect(results[0]?.symbol).toBe('GFNORTEO.MX')
    expect(asked()).toEqual(['twelve-data', 'finnhub', 'yahoo'])
  })

  it('matches part of a company name, without accents or punctuation', async () => {
    everyProviderRefuses()

    const morgan = (await searchSymbols('morgan')).map((r) => r.symbol)
    expect(morgan).toEqual(expect.arrayContaining(['JPM', 'MS']))

    // "Quálitas" typed without the accent, "Procter & Gamble" as "p&g".
    expect((await searchSymbols('qualitas'))[0]?.symbol).toBe('Q.MX')
    expect((await searchSymbols('p&g')).map((r) => r.symbol)).toContain('PG')

    // A word of the name, not only its start: the second word of "Grupo México".
    expect((await searchSymbols('mexico')).map((r) => r.symbol)).toEqual(
      expect.arrayContaining(['WALMEX.MX', 'GMEXICOB.MX', 'EWW']),
    )
  })

  it('returns usable rows: one per symbol, at most ten, every field a string', async () => {
    everyProviderRefuses()

    for (const query of ['grupo', 'energy', 'ishares', 'fibra', 'ba']) {
      const results = await searchSymbols(query)
      expect(results.length, `"${query}"`).toBeGreaterThan(0)
      expect(results.length, `"${query}"`).toBeLessThanOrEqual(10)
      expect(new Set(results.map((r) => r.symbol)).size, `"${query}"`).toBe(results.length)
      for (const row of results) {
        for (const field of ['symbol', 'name', 'type', 'exchange', 'exchDisp'] as const) {
          expect(typeof row[field], `${row.symbol}.${field}`).toBe('string')
        }
      }
    }
  })

  it('matches a one-letter query only exactly', async () => {
    everyProviderRefuses()

    expect(await searchSymbols('V')).toEqual([
      { symbol: 'V', name: 'Visa', type: 'stock', exchange: 'US', exchDisp: 'US' },
    ])
  })

  it('returns nothing for a query nothing matches', async () => {
    everyProviderRefuses()

    expect(await searchSymbols('zzqx')).toEqual([])
  })

  it('asks the providers once per query however its spaces were typed, and not at all for spaces alone', async () => {
    everyProviderRefuses()

    await searchSymbols('  coca    cola ')
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('symbol')).toBe('coca cola')

    fetchMock.mockClear()
    expect(await searchSymbols('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('search with a provider answering', () => {
  // Recorded from api.twelvedata.com/symbol_search on 2026-09-30.
  function twelveDataAnswers(data: Array<Record<string, string>>) {
    fetchMock.mockImplementation(async (url: string) => {
      if (routeOf(url) !== 'twelve-data') throw new Error('only Twelve Data should be asked')
      return { ok: true, status: 200, json: async () => ({ data, status: 'ok' }) }
    })
  }

  it('offers a BMV listing under the symbol that prices, once', async () => {
    twelveDataAnswers([
      { symbol: 'WALMEX', instrument_name: 'Walmart de México, S.A.B. de C.V.', exchange: 'BMV', mic_code: 'XMEX', instrument_type: 'Common Stock', country: 'Mexico' },
    ])

    const results = await searchSymbols('walmex')

    // Not WALMEX, which no provider prices, and not twice: the dictionary's
    // own WALMEX.MX is the same asset.
    expect(results.map((r) => r.symbol)).toEqual(['WALMEX.MX'])
    expect(results[0].name).toBe('Walmart de México, S.A.B. de C.V.')
  })

  it('keeps first what the provider has under exactly the symbol typed, then the dictionary', async () => {
    twelveDataAnswers([
      { symbol: 'GOLD', instrument_name: 'Visi Telekomunikasi Infrastruktur', exchange: 'IDX', mic_code: 'XIDX', instrument_type: 'Common Stock', country: 'Indonesia' },
      { symbol: 'GOLD', instrument_name: 'Gold.com Inc.', exchange: 'NYSE', mic_code: 'XNYS', instrument_type: 'Common Stock', country: 'United States' },
    ])

    const results = await searchSymbols('gold')

    // The ticker GOLD, then SPDR Gold Shares (a whole word of its name), then
    // Goldman Sachs (the start of one). Jakarta's GOLD is not an NYSE symbol.
    expect(results.map((r) => [r.symbol, r.name])).toEqual([
      ['GOLD', 'Gold.com Inc.'],
      ['GLD', 'SPDR Gold Shares'],
      ['GS', 'Goldman Sachs'],
    ])
  })

  it("puts the dictionary's exact match above a provider's listing that only shares its letters", async () => {
    twelveDataAnswers([
      { symbol: 'IPC', instrument_name: 'International Paper Co.', exchange: 'LSE', mic_code: 'XLON', instrument_type: 'Common Stock', country: 'United Kingdom' },
      { symbol: 'IPC', instrument_name: 'Imperial Pacific Ltd.', exchange: 'ASX', mic_code: 'XASX', instrument_type: 'Common Stock', country: 'Australia' },
    ])

    const results = await searchSymbols('ipc')

    // "ipc" in Mexico is the index, and the fund that tracks it, before
    // International Paper's London line.
    expect(results.map((r) => r.symbol)).toEqual(['^MXX', 'NAFTRACISHRS.MX', 'IPC.L'])
  })

  it("does not put a weaker dictionary match above the provider's own row for the exact name", async () => {
    // Twelve Data knows no "coca cola"; Yahoo, as it answered on 2026-09-30.
    fetchMock.mockImplementation(async (url: string) => {
      const route = routeOf(url)
      if (route === 'twelve-data') return { ok: true, status: 200, json: async () => ({ data: [], status: 'ok' }) }
      if (route === 'finnhub') return { ok: false, status: 401, json: async () => ({ error: 'Invalid API key.' }) }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          quotes: [
            { symbol: 'KO', shortname: 'Coca-Cola Company (The)', quoteType: 'EQUITY', exchange: 'NYQ', exchDisp: 'NYSE' },
            { symbol: 'SKO00=F', shortname: 'Coca-Cola Co, The Stock Futures', quoteType: 'FUTURE', exchange: 'CME', exchDisp: 'Chicago Mercantile Exchange' },
            { symbol: 'COKE', shortname: 'Coca-Cola Consolidated, Inc.', quoteType: 'EQUITY', exchange: 'NMS', exchDisp: 'NASDAQ' },
          ],
        }),
      }
    })

    const results = await searchSymbols('coca cola')

    // Coca-Cola first, as Yahoo wrote it; Coca-Cola FEMSA, which Yahoo did not
    // offer, next; then the rest of Yahoo's answer.
    expect(results.map((r) => r.symbol)).toEqual(['KO', 'KOFUBL.MX', 'SKO00=F', 'COKE'])
    expect(results[0]).toMatchObject({ name: 'Coca-Cola Company (The)', exchDisp: 'NYSE' })
    expect(asked()).toEqual(['twelve-data', 'finnhub', 'yahoo'])
  })

  it('puts the exact dictionary matches a provider does not know by that word on top', async () => {
    twelveDataAnswers([
      { symbol: 'NDQ3L', instrument_name: 'SG ETN Daily Long +3x Nasdaq', exchange: 'MTA', mic_code: 'XMIL', instrument_type: 'ETF', country: 'Italy' },
      { symbol: 'N1DA34', instrument_name: 'Nasdaq, Inc.', exchange: 'Bovespa', mic_code: 'BVMF', instrument_type: 'Depositary Receipt', country: 'Brazil' },
    ])

    const results = await searchSymbols('nasdaq')

    expect(results.map((r) => r.symbol)).toEqual(['^IXIC', 'QQQ', 'N1DA34.SA'])
  })
})
