/**
 * Twelve Data API client
 * https://twelvedata.com/docs
 *
 * Free tier: 800 credits/day, 8 credits/min
 * - /quote = 1 credit
 * - /time_series = 1 credit
 * - /symbol_search = 1 credit per the documentation, which also asks for the
 *   key. Checked on 2026-09-30, the endpoint still answers without a key — and
 *   with a wrong one — which /quote and /time_series refuse with a 401. See
 *   searchSymbols.
 */

const BASE = 'https://api.twelvedata.com'

function getApiKey(): string | null {
  return process.env.TWELVE_DATA_API_KEY || null
}

export type TwelveDataQuote = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  currency: string
  exchange: string
  name: string
}

export type TwelveDataBar = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  /** ISO 4217 code the closes are quoted in, when the provider says. */
  currency?: string | null
}

export async function isAvailable(): Promise<boolean> {
  return !!getApiKey()
}

export type SymbolSearchResult = {
  symbol: string
  name: string
  type: string
  exchange: string
  exchDisp: string
}

/**
 * The suffix a market's listings carry in the spelling the app stores, which is
 * Yahoo's — its first quote source. Twelve Data names the market in a separate
 * field and gives every listing a bare ticker: WALMEX on the BMV, AAPL on the
 * BMV's SIC, PETR4 on B3. Stored bare, WALMEX is a symbol no provider prices
 * (symbol-check.ts), and AAPL is the Nasdaq listing in dollars, not the one in
 * pesos the reader picked. Keyed by MIC, the ISO 10383 code Twelve Data sends
 * with each listing; the markets are the ones company-profiles.ts places.
 */
const SUFFIX_BY_MIC: Record<string, string> = {
  XMEX: '.MX', // Bolsa Mexicana de Valores, the SIC included
  BVMF: '.SA', // B3, São Paulo
  XTSE: '.TO', // Toronto
  XLON: '.L', // London
  AIMX: '.L', // London, AIM
  XETR: '.DE', // Xetra
}

/** Listings of a search per request; filtered down to MAX_SEARCH_RESULTS. Same credit either way. */
const SEARCH_OUTPUT_SIZE = 30
const MAX_SEARCH_RESULTS = 10

/**
 * One listing in the app's spelling, or null for a market it cannot address.
 *
 * A United States listing keeps its bare ticker. A listing anywhere else that
 * SUFFIX_BY_MIC does not name is left out: under its bare ticker it would be a
 * different instrument — GLD on Johannesburg is NewGold, not SPDR Gold Shares —
 * or no instrument at all. Before a suffix, a dot in the ticker is a dash, as
 * Yahoo writes a series: LIVEPOLC.1 on the BMV is LIVEPOLC-1.MX.
 */
function toSearchResult(item: Record<string, string>): SymbolSearchResult | null {
  if (!item.symbol) return null
  const suffix = item.country === 'United States' ? '' : SUFFIX_BY_MIC[item.mic_code]
  if (suffix === undefined) return null
  return {
    symbol: suffix ? `${item.symbol.replace(/\./g, '-')}${suffix}` : item.symbol,
    name: item.instrument_name || item.symbol,
    type: item.instrument_type,
    exchange: item.exchange,
    exchDisp: item.exchange,
  }
}

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  // The key goes with the call when there is one, as for every other endpoint
  // here: the documentation requires it, and an unkeyed call rides on an
  // allowance nobody promised to keep. Without one — a local checkout — the
  // endpoint still answers today, so search keeps working there.
  const apiKey = getApiKey()
  const res = await fetch(
    `${BASE}/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=${SEARCH_OUTPUT_SIZE}${apiKey ? `&apikey=${apiKey}` : ''}`,
    // A keyed search costs one of the credits the history charts live on, and
    // the listings that match a query do not change from one minute to the
    // next, so an answer is kept for an hour. Only a 200 is kept, and Twelve
    // Data answers a refusal with its own status (a /quote with a bad key is a
    // 401), so a minute out of credits is not served from here for an hour.
    { next: { revalidate: 3600 } } as RequestInit
  )
  if (!res.ok) return []
  const data = await res.json()
  if (!Array.isArray(data.data)) return []

  // One row per symbol: the same ticker comes back once per market that lists
  // it — AAPL on Nasdaq and again on IEX — and the most relevant comes first.
  const seen = new Set<string>()
  const results: SymbolSearchResult[] = []
  for (const item of data.data as Array<Record<string, string>>) {
    const result = toSearchResult(item)
    if (!result || seen.has(result.symbol)) continue
    seen.add(result.symbol)
    results.push(result)
  }
  return results.slice(0, MAX_SEARCH_RESULTS)
}

export async function getQuote(symbol: string): Promise<TwelveDataQuote | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null

  const res = await fetch(
    `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
    // A quote is live data; freshness is market.ts's quote cache (LIVE_QUOTE_TTL_MS).
    { cache: 'no-store' }
  )
  if (!res.ok) return null

  const data = await res.json()
  if (data.status === 'error' || data.code) return null

  const price = data.close ? parseFloat(data.close) : null
  const previousClose = data.previous_close ? parseFloat(data.previous_close) : null
  const change = data.change ? parseFloat(data.change) : null
  const changePct = data.percent_change ? parseFloat(data.percent_change) : null

  return {
    symbol: data.symbol || symbol,
    price,
    previousClose,
    change,
    changePct,
    currency: data.currency || 'USD',
    exchange: data.exchange || '',
    name: data.name || symbol,
  }
}

export async function getHistory(
  symbol: string,
  range: string = '1mo'
): Promise<TwelveDataBar[]> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  // Map our range format to Twelve Data parameters
  const rangeConfig: Record<string, { interval: string; outputsize: number }> = {
    '1d': { interval: '5min', outputsize: 78 },    // ~6.5 hours of trading
    '5d': { interval: '15min', outputsize: 130 },   // 5 days × 26 bars
    '1mo': { interval: '1day', outputsize: 22 },
    '3mo': { interval: '1day', outputsize: 65 },
    '6mo': { interval: '1day', outputsize: 130 },
    '1y': { interval: '1week', outputsize: 52 },
    '5y': { interval: '1month', outputsize: 60 },
    'max': { interval: '1month', outputsize: 240 },
  }

  const config = rangeConfig[range] || { interval: '1day', outputsize: 30 }

  const res = await fetch(
    `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${apiKey}`,
    { next: { revalidate: 300 } } as RequestInit
  )
  if (!res.ok) return []

  const data = await res.json()
  if (data.status === 'error' || !data.values) return []

  const currency: string | null = data.meta?.currency ?? null

  return data.values
    .map((v: Record<string, string>) => ({
      date: new Date(v.datetime).toISOString(),
      open: v.open ? parseFloat(v.open) : null,
      high: v.high ? parseFloat(v.high) : null,
      low: v.low ? parseFloat(v.low) : null,
      close: v.close ? parseFloat(v.close) : null,
      volume: v.volume ? parseInt(v.volume) : null,
      currency,
    }))
    .filter((p: TwelveDataBar) => p.close !== null)
    .reverse() // Twelve Data returns newest first, we want chronological
}

type QuoteItem = Record<string, string>

/**
 * The quotes in a /quote response, each with the key it came under.
 *
 * One symbol comes back as the quote itself. Several come back as an object
 * keyed by symbol — { AAPL: {...}, MSFT: {...} } — not as an array. Reading
 * that object as a single quote found no `close` in it, so every batch of two or
 * more symbols parsed to nothing and fell through to the next provider, which
 * is why batch prices arrived without their daily change.
 */
export function quoteItems(data: unknown): Array<[string, QuoteItem]> {
  if (Array.isArray(data)) {
    return data.filter(isObject).map((item) => [String(item.symbol ?? ''), item as QuoteItem])
  }
  if (!isObject(data)) return []
  // A single quote, or a top-level error for the whole request.
  if ('symbol' in data || 'close' in data || 'code' in data) return [[String(data.symbol ?? ''), data as QuoteItem]]
  return Object.entries(data)
    .filter((entry): entry is [string, Record<string, unknown>] => isObject(entry[1]))
    .map(([key, item]) => [key, item as QuoteItem])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Batch quote endpoint — fetches up to 20 symbols in a single API call.
 * Twelve Data /quote?symbol=AAPL,MSFT,GOOG returns all quotes at once.
 * Uses 1 credit per symbol but only 1 HTTP round-trip.
 */
export async function getBatchQuotes(
  symbols: string[]
): Promise<Record<string, TwelveDataQuote>> {
  const apiKey = getApiKey()
  if (!apiKey || symbols.length === 0) return {}

  // Twelve Data accepts comma-separated symbols (max ~120 per call)
  const symbolStr = symbols.slice(0, 20).join(',')
  const res = await fetch(
    `${BASE}/quote?symbol=${encodeURIComponent(symbolStr)}&apikey=${apiKey}`,
    { cache: 'no-store' }
  )
  if (!res.ok) return {}

  const data = await res.json()
  const results: Record<string, TwelveDataQuote> = {}

  for (const [key, item] of quoteItems(data)) {
    if (item.status === 'error' || item.code) continue

    const price = item.close ? parseFloat(item.close) : null
    const previousClose = item.previous_close ? parseFloat(item.previous_close) : null
    const change = item.change ? parseFloat(item.change) : null
    const changePct = item.percent_change ? parseFloat(item.percent_change) : null

    const sym = item.symbol || key
    if (sym) {
      results[sym] = {
        symbol: sym,
        price,
        previousClose,
        change,
        changePct,
        currency: item.currency || 'USD',
        exchange: item.exchange || '',
        name: item.name || sym,
      }
    }
  }

  return results
}
