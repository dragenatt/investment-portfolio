/**
 * Market data service with multi-source fallback + caching
 *
 * Quotes: Yahoo's spark endpoint first (every symbol, twenty per request, no
 * key), then Twelve Data → Finnhub → Yahoo's per-symbol chart for whatever it
 * did not answer. History: Twelve Data → Finnhub → Yahoo. Search: Twelve Data
 * → Finnhub → Yahoo, then the local dictionary when none of them answers (see
 * searchSymbols).
 *
 * Quotes used to start with Twelve Data. On the key this app runs with (basic
 * plan: 8 credits a minute, 800 a day, one credit per symbol) a batch of more
 * than eight symbols is refused outright, and its quotes move once a minute —
 * so a live screen polling a book of thirty symbols never got a Twelve Data
 * price, and spent the daily credits the history charts depend on trying.
 *
 * Resilience:
 * - Circuit breakers for each data source
 * - Retry with exponential backoff for transient failures
 * - Quote cache in memory and in Redis for LIVE_QUOTE_TTL_MS: what "live" can mean
 * - History cache, in memory and in Redis (5 min intraday, 1 hour otherwise)
 * - Automatic fallback with timeout of 4s per source
 * - Quote fetches bypass Next's data cache (see yahooQuote)
 */

import * as twelveData from './twelve-data'
import * as finnhub from './finnhub'
import { CircuitBreaker, withRetry } from './resilience'
import { cachePrice, cacheBatchPrices, getCachedPriceEntries, cacheGet, cacheSet, CACHE_KEYS, type CachedPriceEntry } from '@/lib/cache/redis'
import { ASSET_UNIVERSE } from '@/lib/data/asset-universe'
import { LIVE_QUOTE_TTL_MS } from './live-prices'

// ─── Symbol normalization ───────────────────────────────────────────────────
// Maps Yahoo-style index symbols to Twelve Data format.
// ^-prefix symbols are Yahoo indices that Twelve Data doesn't support on free tier.
// We skip them for Twelve Data and let Yahoo handle them via fallback.

const TWELVE_DATA_SYMBOL_MAP: Record<string, string> = {
  '^N225': 'N225',  // Nikkei 225 — supported in Twelve Data as N225
}

/** Symbols that should skip Twelve Data entirely (US indices not on free tier) */
function shouldSkipTwelveData(symbol: string): boolean {
  return symbol.startsWith('^') && !TWELVE_DATA_SYMBOL_MAP[symbol]
}

/** Translate a symbol for Twelve Data API calls */
function toTwelveDataSymbol(symbol: string): string {
  return TWELVE_DATA_SYMBOL_MAP[symbol] || symbol
}

// ─── Yahoo symbol spelling ──────────────────────────────────────────────────
// Yahoo writes a share class with a dash: BRK-B, HEI-A. Asked for the spelling
// brokers, statements and CSV files use — BRK.B — the chart endpoint answers
// "Not Found" and the batch endpoint simply leaves the symbol out, so such a
// holding had no price, no daily change and no history for as long as it
// existed, and nothing said why.
//
// Only the class letters A, B and C are translated: a single-letter suffix is
// also how Yahoo names some exchanges, and London's ".L" (BP.L) must keep its
// dot. Nothing stored changes — the position keeps the symbol its owner typed,
// and every quote comes back under that spelling.
const YAHOO_CLASS_SHARE = /^([A-Z]{1,5})\.([ABC])$/

function toYahooSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(YAHOO_CLASS_SHARE, '$1-$2')
}

// ─── Circuit Breakers (for resilience) ──────────────────────────────────────

const twelveDataBreaker = new CircuitBreaker({
  name: 'twelve-data',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
})

const finnhubBreaker = new CircuitBreaker({
  name: 'finnhub',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
})

const yahooBreaker = new CircuitBreaker({
  name: 'yahoo',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
})

// ─── In-memory quote cache (survives within a single serverless invocation) ──

type CachedQuote = {
  data: QuoteResult
  expiresAt: number
  /** When a provider produced the quote — not when it was cached. Null when unknown. */
  fetchedAt: number | null
}

type QuoteResult = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  currency: string
  exchange: string
  marketState?: string
  name?: string
}

// How long a quote is reused before a provider is asked again: LIVE_QUOTE_TTL_MS
// (live-prices.ts), the same interval the screens poll at.
const QUOTE_TTL_S = LIVE_QUOTE_TTL_MS / 1000
const CACHE_TTL_MS = LIVE_QUOTE_TTL_MS
const quoteCache = new Map<string, CachedQuote>()

function getCachedEntry(symbol: string): CachedQuote | null {
  const entry = quoteCache.get(symbol.toUpperCase())
  if (entry && Date.now() < entry.expiresAt) return entry
  if (entry) quoteCache.delete(symbol.toUpperCase())
  return null
}

function getCached(symbol: string): QuoteResult | null {
  return getCachedEntry(symbol)?.data ?? null
}

/** `fetchedAt` defaults to now; a quote rebuilt from Redis passes its own. */
function setCache(symbol: string, data: QuoteResult, fetchedAt: number | null = Date.now()) {
  quoteCache.set(symbol.toUpperCase(), { data, expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt })
}

/**
 * A quote rebuilt from the shared price cache. The daily change is recomputed
 * from the cached previous close, so a quote served from the cache moves the
 * day's P&L like one fresh from a provider.
 */
function quoteFromCache(symbol: string, entry: CachedPriceEntry): QuoteResult {
  const previousClose = entry.previousClose != null && entry.previousClose > 0 ? entry.previousClose : null
  const change = previousClose != null ? entry.price - previousClose : null
  return {
    symbol: symbol.toUpperCase(),
    price: entry.price,
    previousClose,
    change,
    changePct: previousClose != null && change != null ? (change / previousClose) * 100 : null,
    currency: entry.currency ?? 'USD',
    exchange: '',
  }
}

/** Write a quote to the shared price cache, previous close included. */
function sharePrice(symbol: string, quote: Pick<QuoteResult, 'price' | 'previousClose' | 'currency'>) {
  if (quote.price == null) return
  cachePrice(symbol, quote.price, QUOTE_TTL_S, { previousClose: quote.previousClose, currency: quote.currency })
}

/** Clear the in-memory cache (useful for testing) */
export function clearQuoteCache() {
  quoteCache.clear()
}

// ─── Timeout helper ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 4_000

function withTimeout<T>(promise: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ])
}

// ─── Known symbol names (reliable fallback when API doesn't return names) ───

const KNOWN_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^DJI': 'Dow Jones Industrial',
  '^IXIC': 'Nasdaq Composite',
  '^N225': 'Nikkei 225',
  '^FTSE': 'FTSE 100',
  '^RUT': 'Russell 2000',
  '^NYA': 'NYSE Composite',
  '^STOXX50E': 'Euro Stoxx 50',
  'SPY': 'SPDR S&P 500 ETF',
  'QQQ': 'Invesco QQQ Trust',
  'VOO': 'Vanguard S&P 500 ETF',
  'IVV': 'iShares Core S&P 500',
  'VTI': 'Vanguard Total Stock Market',
}

function resolveSymbolName(symbol: string, apiName?: string): string | undefined {
  return apiName || KNOWN_NAMES[symbol] || KNOWN_NAMES[symbol.toUpperCase()] || undefined
}

// ─── Yahoo Finance (fallback) ────────────────────────────────────────────

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v1/finance'

async function yahooSearch(query: string) {
  const res = await fetch(
    `${YAHOO_BASE}/search?q=${encodeURIComponent(query)}&quotesCount=10&lang=en-US`,
    { next: { revalidate: 60 } } as RequestInit
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.quotes || []).map((q: Record<string, unknown>) => ({
    symbol: q.symbol as string,
    name: (q.shortname || q.longname) as string,
    type: q.quoteType as string,
    exchange: q.exchange as string,
    exchDisp: q.exchDisp as string,
  }))
}

// Quote fetches are 'no-store'. They used `next: { revalidate: 30 }`, and
// Next's data cache answers an expired entry with the stale copy while it
// refreshes in the background — so the price came back up to a minute older
// than the cache said, then sat in the quote cache stamped as fetched "now".
// Measured: BTC-USD held one price for over two minutes while Yahoo moved it
// every ten seconds. Freshness is the quote cache's job, with a known TTL.
const LIVE: RequestInit = { cache: 'no-store' }

async function yahooQuote(symbol: string): Promise<QuoteResult | null> {
  const asked = toYahooSymbol(symbol)
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asked)}?interval=1d&range=1d`,
    LIVE,
  )
  if (!res.ok) return null
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  const meta = result.meta
  const price = meta.regularMarketPrice ?? null
  // Yahoo's chart meta no longer carries `previousClose`; it sends
  // `chartPreviousClose`, the close before the chart's first bar, which for
  // range=1d is the previous session's close. Reading only the old field left
  // every quote without a daily change, so "Hoy" sat at zero on every screen.
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null
  const change = (price != null && previousClose != null) ? price - previousClose : null
  const changePct = (change != null && previousClose && previousClose !== 0) ? (change / previousClose) * 100 : null
  return {
    // Under the spelling the caller asked about, not Yahoo's.
    symbol: asked === symbol.toUpperCase() ? meta.symbol : symbol,
    price,
    previousClose,
    change,
    changePct,
    currency: meta.currency,
    exchange: meta.exchangeName,
    marketState: meta.marketState,
    name: resolveSymbolName(meta.symbol, meta.shortName || meta.longName),
  }
}

/** Symbols per spark request; the endpoint answers for up to twenty. */
const SPARK_BATCH = 20

type SparkMeta = {
  symbol?: string
  regularMarketPrice?: number
  previousClose?: number
  chartPreviousClose?: number
  currency?: string
  exchangeName?: string
  shortName?: string
  longName?: string
}

/**
 * Quotes for many symbols from Yahoo's spark endpoint, twenty per request.
 *
 * The same figures as yahooQuote — the price and the previous session's close
 * from the chart meta — in one round trip per twenty symbols instead of one per
 * symbol. A symbol Yahoo does not know is simply absent from the answer. A
 * failed request throws, so the breaker counts it and the caller falls back.
 */
async function yahooSparkQuotes(symbols: string[]): Promise<Record<string, QuoteResult>> {
  // Yahoo's spelling → the caller's, so a share class comes back as asked.
  const asked = new Map<string, string>()
  for (const symbol of symbols) asked.set(toYahooSymbol(symbol), symbol.toUpperCase())

  const chunks: string[][] = []
  const spellings = [...asked.keys()]
  for (let i = 0; i < spellings.length; i += SPARK_BATCH) chunks.push(spellings.slice(i, i + SPARK_BATCH))

  const answers = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${chunk.map(encodeURIComponent).join(',')}&range=1d&interval=1d`,
        LIVE,
      )
      if (!res.ok) throw new Error(`Yahoo spark ${res.status}`)
      const data = await res.json()
      return (data?.spark?.result ?? []) as Array<{ symbol?: string; response?: Array<{ meta?: SparkMeta }> }>
    }),
  )

  const quotes: Record<string, QuoteResult> = {}
  for (const item of answers.flat()) {
    const meta = item.response?.[0]?.meta
    const answered = (item.symbol ?? meta?.symbol ?? '').toUpperCase()
    const symbol = asked.get(answered) ?? answered
    const price = typeof meta?.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null
    if (!symbol || !meta || price == null) continue
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null
    const change = previousClose != null ? price - previousClose : null
    quotes[symbol] = {
      symbol,
      price,
      previousClose,
      change,
      changePct: change != null && previousClose ? (change / previousClose) * 100 : null,
      currency: meta.currency ?? 'USD',
      exchange: meta.exchangeName ?? '',
      name: resolveSymbolName(symbol, meta.shortName || meta.longName),
    }
  }
  return quotes
}

async function yahooHistory(symbol: string, range: string = '1mo') {
  const intervalMap: Record<string, string> = {
    '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
    '6mo': '1d', '1y': '1wk', '5y': '1mo', 'max': '1mo',
  }
  const interval = intervalMap[range] || '1d'

  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}?interval=${interval}&range=${range}`,
    { next: { revalidate: 300 } } as RequestInit
  )
  if (!res.ok) return []
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return []

  const timestamps = result.timestamp || []
  const quotes = result.indicators?.quote?.[0] || {}
  // Yahoo publishes a split- and dividend-adjusted series alongside the raw one.
  // It is the correct basis for returns; the raw close stays for display.
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose

  // The unit the closes are in. Carried on every bar so whatever stores them
  // records what they are — a series of numbers with no currency is what let
  // the value chart add pesos to dollars.
  const currency: string | null = result.meta?.currency ?? null

  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString(),
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    adjClose: adjusted?.[i] ?? null,
    volume: quotes.volume?.[i],
    currency,
  })).filter((p: { close: number | null }) => p.close !== null)
}

// ─── Public API (with automatic fallback + caching) ──────────────────────

// ─── Search: the local dictionary ───────────────────────────────────────────
//
// What search answers from when no provider does. All three can fail at once,
// and from a datacenter they do: Yahoo's search answers some clients with a 429
// outright, Finnhub needs a key, and a keyed Twelve Data search spends the
// credits the history charts live on. A search that then comes back empty
// reads as "this app does not know Apple", so every asset the app already
// offers can be found without them: the universe the sector browser shows
// (asset-universe.ts, the one list of them), plus the indices and the
// cryptocurrencies below, which the universe — companies and funds by sector —
// does not hold.

type SearchResult = { symbol: string; name: string; type: string; exchange: string; exchDisp: string }

/** Names people type for a universe asset that are not in its own: its brands, and plain Spanish. */
const SEARCH_NICKNAMES: Record<string, string[]> = {
  'FEMSAUBD.MX': ['oxxo'],
  'WALMEX.MX': ['bodega aurrera', 'sams club'],
  'AMXB.MX': ['telcel', 'claro'],
  'TLEVISACPO.MX': ['izzi', 'sky méxico'],
  'GRUMAB.MX': ['maseca'],
  'GAPB.MX': ['aeropuertos del pacífico'],
  'ASURB.MX': ['aeropuertos del sureste'],
  'OMAB.MX': ['aeropuertos centro norte'],
  'GOOGL': ['youtube'],
  'META': ['facebook', 'instagram', 'whatsapp'],
  'BRK.B': ['buffett'],
  'GLD': ['oro'],
  'TLT': ['bonos del tesoro'],
  'AGG': ['bonos'],
}

const SEARCH_ALIASES: Array<{ keywords: string[]; result: SearchResult }> = [
  { keywords: ['syp500', 'sp500', 's&p500', 's&p 500', 'snp500', 'spy500', 'standard poor'],
    result: { symbol: '^GSPC', name: 'S&P 500', type: 'index', exchange: 'SNP', exchDisp: 'SNP' } },
  { keywords: ['nasdaq', 'nasaq', 'nasdac', 'ixic'],
    result: { symbol: '^IXIC', name: 'Nasdaq Composite', type: 'index', exchange: 'NASDAQ', exchDisp: 'NASDAQ' } },
  { keywords: ['dow jones', 'dow', 'djia', 'dji'],
    result: { symbol: '^DJI', name: 'Dow Jones Industrial', type: 'index', exchange: 'DJI', exchDisp: 'DJI' } },
  { keywords: ['ipc', 'ipc méxico', 'bolsa mexicana', 'mexbol', 'índice de precios y cotizaciones'],
    result: { symbol: '^MXX', name: 'S&P/BMV IPC', type: 'index', exchange: 'BMV', exchDisp: 'BMV' } },
  { keywords: ['nikkei', 'n225', 'japón', 'japan'],
    result: { symbol: '^N225', name: 'Nikkei 225', type: 'index', exchange: 'OSA', exchDisp: 'Osaka' } },
  { keywords: ['ftse', 'london', 'londres'],
    result: { symbol: '^FTSE', name: 'FTSE 100', type: 'index', exchange: 'LSE', exchDisp: 'London' } },
  { keywords: ['russell', 'rut', 'russell2000'],
    result: { symbol: '^RUT', name: 'Russell 2000', type: 'index', exchange: 'RUS', exchDisp: 'Russell' } },
  { keywords: ['bitcoin', 'btc'],
    result: { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto', exchange: 'CCC', exchDisp: 'Cripto' } },
  { keywords: ['ethereum', 'ether', 'eth'],
    result: { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto', exchange: 'CCC', exchDisp: 'Cripto' } },
  ...ASSET_UNIVERSE.map((asset) => {
    const market = asset.symbol.endsWith('.MX') ? 'BMV' : 'US'
    return {
      keywords: SEARCH_NICKNAMES[asset.symbol] ?? [],
      result: {
        symbol: asset.symbol,
        name: asset.name,
        type: asset.sector === 'ETFs' ? 'etf' : 'stock',
        exchange: market,
        exchDisp: market,
      },
    }
  }),
]

/** Lowercase, without accents, every run of spaces or punctuation one space: "Coca-Cola" → "coca cola". */
function searchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Without the spaces too, so "cocacola" finds Coca-Cola and "jp morgan" JPMorgan. */
function compact(text: string): string {
  return text.replace(/ /g, '')
}

type DictionaryEntry = {
  result: SearchResult
  /** The symbol, and the ticker alone — WALMEX for WALMEX.MX, BRK for BRK.B — compacted. */
  symbols: string[]
  /** The name and the keywords, as searchText writes them. */
  names: string[]
}

/** The ticker without what marks its market or kind: WALMEX for WALMEX.MX, GSPC for ^GSPC, BTC for BTC-USD. */
function tickerOf(symbol: string): string {
  return symbol.replace(/^\^/, '').replace(/-USD$/, '').replace(/\.[A-Z]{1,2}$/, '')
}

/** The symbol and its ticker as a query is compared with them: "BRK.B" → brkb, brk. */
function symbolKeys(symbol: string): string[] {
  return [...new Set([symbol, tickerOf(symbol)].map((s) => compact(searchText(s))))]
}

const DICTIONARY: DictionaryEntry[] = SEARCH_ALIASES.map(({ keywords, result }) => ({
  result,
  symbols: symbolKeys(result.symbol),
  names: [...new Set([result.name, ...keywords].map(searchText).filter(Boolean))],
}))

type Rank = 0 | 1 | 2 | 3

/**
 * How well an entry matches a query already written by searchText, or null.
 *
 * 0 — the symbol, the ticker, the name or a keyword, exactly.
 * 1 — every word of the query is a whole word of the name or a keyword:
 *     "gold" is SPDR Gold Shares before it is Goldman Sachs.
 * 2 — a start: of the symbol, of the name typed without spaces ("cocacol"), of
 *     a word of the name ("app" for Apple), or of one word of the name for each
 *     word of the query ("walmart mex", "banco bajio").
 * 3 — the query holds the whole name ("apple inc"), or a word of the name holds
 *     the query ("morgan" in JPMorgan Chase), from four letters: "oro" is not
 *     the end of "tesoro". Last, because the words ignored may be the ones that
 *     tell two names apart: "walmart mexico" holds "Walmart", and asks for
 *     Walmart de México.
 *
 * A one-letter query only matches exactly: "V" is Visa, not every name with a
 * v; and a one-letter word in a longer query must sit where it is typed, so
 * "s&p" finds S&P Global and not United Parcel Service.
 */
function matchRank(entry: DictionaryEntry, query: string): Rank | null {
  const q = compact(query)
  if (!q) return null
  if (entry.symbols.includes(q) || entry.names.some((name) => compact(name) === q)) return 0
  if (q.length < 2) return null

  const words = query.split(' ')
  const nameWords = entry.names.map((name) => name.split(' '))
  if (nameWords.some((ofName) => words.every((word) => ofName.includes(word)))) return 1

  if (
    entry.symbols.some((symbol) => symbol.startsWith(q)) ||
    entry.names.some((name) => compact(name).startsWith(q) || ` ${name}`.includes(` ${query}`)) ||
    nameWords.some((ofName) => words.every((word) => word.length > 1 && ofName.some((w) => w.startsWith(word))))
  ) {
    return 2
  }

  if (
    entry.names.some((name) => ` ${query} `.includes(` ${name} `)) ||
    (q.length >= 4 && entry.names.some((name) => name.includes(query)))
  ) {
    return 3
  }
  return null
}

/** Every dictionary entry the query matches, the best first, then in catalog order. */
function searchDictionary(query: string): Array<{ result: SearchResult; rank: Rank }> {
  const q = searchText(query)
  const matches: Array<{ result: SearchResult; rank: Rank; index: number }> = []
  DICTIONARY.forEach((entry, index) => {
    const rank = matchRank(entry, q)
    if (rank !== null) matches.push({ result: entry.result, rank, index })
  })
  return matches.sort((a, b) => a.rank - b.rank || a.index - b.index)
}

/** One row per symbol, the first kept: every list here renders keyed by symbol. */
function uniqueBySymbol(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    if (!result?.symbol || seen.has(result.symbol)) return false
    seen.add(result.symbol)
    return true
  })
}

/** How many dictionary matches go above a provider's answer, and how many answer alone. */
const DICTIONARY_ON_TOP = 5
const DICTIONARY_ALONE = 10

// ─── Search ─────────────────────────────────────────────────────────────────

/**
 * Twelve Data, then Finnhub, then Yahoo: the first that answers, with the
 * dictionary's exact, whole-word and prefix matches on top — the indices and
 * brands the providers do not know by those words ("sp500", "oxxo"). What the
 * provider has under exactly the symbol typed goes between the dictionary's
 * exact matches and the rest of them: "ipc" is the IPC index before London's
 * IPC, and "gold" the ticker GOLD before SPDR Gold Shares. When none answers,
 * the dictionary alone.
 *
 * Each provider gets FETCH_TIMEOUT_MS and a failure of its own. Yahoo's used to
 * have neither: a network error there threw out of this function, so the route
 * answered 500 instead of the matches it already had, and a Yahoo that hung
 * held the search for as long as it did.
 */
export async function searchSymbols(rawQuery: string): Promise<SearchResult[]> {
  // "  aapl  " is "aapl": one cache entry, and one keyed Twelve Data credit, not
  // one per way of typing the spaces. A query of spaces alone is no query —
  // Twelve Data answers an empty one with whatever it likes.
  const query = rawQuery.trim().replace(/\s+/g, ' ')
  if (!query) return []

  const dictionary = searchDictionary(query)

  const providers: Array<(q: string) => Promise<SearchResult[]>> = [
    twelveData.searchSymbols,
    finnhub.searchSymbols,
    yahooSearch,
  ]
  const typed = compact(searchText(query))
  for (const search of providers) {
    try {
      const answer = await withTimeout(search(query))
      const results = Array.isArray(answer) ? uniqueBySymbol(answer) : []
      if (results.length === 0) continue

      // A match the provider also answered keeps the provider's row, which
      // names the listing more fully ("Walmart de México, S.A.B. de C.V.").
      const answered = new Map(results.map((r) => [r.symbol, r]))
      const onTop = dictionary.filter((match) => match.rank <= 2).slice(0, DICTIONARY_ON_TOP)
      const row = (match: (typeof onTop)[number]) => answered.get(match.result.symbol) ?? match.result
      return uniqueBySymbol([
        ...onTop.filter((match) => match.rank === 0).map(row),
        ...results.filter((r) => compact(searchText(r.symbol)) === typed),
        ...onTop.map(row),
        ...results,
      ])
    } catch { /* the next provider */ }
  }

  return dictionary.slice(0, DICTIONARY_ALONE).map((match) => match.result)
}

export async function getQuote(symbol: string): Promise<QuoteResult | null> {
  // 1. In-memory cache
  const memCached = getCached(symbol)
  if (memCached) return memCached

  // 2. Redis cache
  const redisCached = (await getCachedPriceEntries([symbol]))[symbol]
  if (redisCached) {
    const quoteResult = quoteFromCache(symbol, redisCached)
    setCache(symbol, quoteResult, redisCached.fetchedAt ?? null)
    return quoteResult
  }

  // 3. Yahoo spark: the live source (see the header of this file)
  try {
    const quote = (await yahooBreaker.execute(() => withTimeout(yahooSparkQuotes([symbol]))))[symbol.toUpperCase()]
    if (quote?.price != null) {
      const normalized = { ...quote, symbol }
      setCache(symbol, normalized)
      sharePrice(symbol, normalized)
      return normalized
    }
  } catch { /* fall through */ }

  // 4. Try Twelve Data with circuit breaker and retry (skip unsupported symbols)
  if (!shouldSkipTwelveData(symbol) && await twelveData.isAvailable()) {
    try {
      const tdSymbol = toTwelveDataSymbol(symbol)
      const quote = await twelveDataBreaker.execute(() =>
        withRetry(() => withTimeout(twelveData.getQuote(tdSymbol)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
      )
      if (quote?.price != null) {
        const normalized = { ...quote, symbol, name: resolveSymbolName(symbol, quote.name) }
        setCache(symbol, normalized)
        sharePrice(symbol, normalized)
        return normalized
      }
    } catch { /* fall through */ }
  }

  // 5. Try Finnhub with circuit breaker and retry
  if (await finnhub.isAvailable()) {
    try {
      const quote = await finnhubBreaker.execute(() =>
        withRetry(() => withTimeout(finnhub.getQuote(symbol)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
      )
      if (quote?.price != null) {
        const quoteResult: QuoteResult = {
          symbol: quote.symbol,
          price: quote.price,
          previousClose: quote.previousClose,
          change: quote.change,
          changePct: quote.changePct,
          currency: quote.currency,
          exchange: quote.exchange,
          name: resolveSymbolName(symbol),
        }
        setCache(symbol, quoteResult)
        sharePrice(symbol, quoteResult)
        return quoteResult
      }
    } catch { /* fall through */ }
  }

  // 6. Fallback to Yahoo with circuit breaker and retry
  try {
    const quote = await yahooBreaker.execute(() =>
      withRetry(() => withTimeout(yahooQuote(symbol)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
    )
    if (quote) {
      setCache(symbol, quote)
      sharePrice(symbol, quote)
    }
    return quote
  } catch {
    return null
  }
}

/**
 * Batch quote fetcher — single API call for multiple symbols.
 * Uses Twelve Data's native batch endpoint when available,
 * falls back to Finnhub individual calls, then parallel Yahoo calls.
 * All results are cached in Redis and in-memory.
 */
export type BatchQuote = {
  price: number | null
  previousClose?: number | null
  change: number | null
  changePct: number | null
  currency: string
  name?: string
  /**
   * When a provider produced this price (ISO). A cache hit keeps the time of
   * the original read, so freshness.ts can tell a quote from a second ago from
   * one that has sat in Redis for four minutes. Absent only when the age is
   * genuinely unknown.
   */
  fetchedAt?: string
}

export async function getBatchQuotes(
  symbols: string[],
  opts: { fresh?: boolean } = {}
): Promise<Record<string, BatchQuote>> {
  // `fresh` bypasses the caches so previousClose comes straight from a provider.
  // The price caches only hold the price, so serving from them would return a null
  // previousClose and mask the daily baseline anchor (see services/baselines.ts).
  const fresh = opts.fresh === true
  const results: Record<string, BatchQuote> = {}
  const uncached: string[] = []

  // 1. Serve from in-memory cache first (skipped when fresh data is required)
  for (const s of symbols) {
    const hit = fresh ? null : getCachedEntry(s)
    if (hit) {
      const cached = hit.data
      results[cached.symbol || s] = {
        price: cached.price,
        previousClose: cached.previousClose,
        change: cached.change,
        changePct: cached.changePct,
        currency: cached.currency,
        name: cached.name,
        ...(hit.fetchedAt !== null ? { fetchedAt: new Date(hit.fetchedAt).toISOString() } : {}),
      }
    } else {
      uncached.push(s)
    }
  }

  if (uncached.length === 0) return results

  // 2. Check Redis cache for remaining symbols (skipped when fresh)
  const redisCachedPrices: Record<string, CachedPriceEntry | null> = fresh ? {} : await getCachedPriceEntries(uncached)
  const stillMissing: string[] = []
  for (const s of uncached) {
    const redisEntry = redisCachedPrices[s]
    if (redisEntry) {
      const entry = quoteFromCache(s, redisEntry)
      const fetchedAt = redisEntry.fetchedAt ?? null
      setCache(s, entry, fetchedAt)
      results[s.toUpperCase()] = {
        price: entry.price,
        previousClose: entry.previousClose,
        change: entry.change,
        changePct: entry.changePct,
        currency: entry.currency,
        ...(fetchedAt !== null ? { fetchedAt: new Date(fetchedAt).toISOString() } : {}),
      }
    } else {
      stillMissing.push(s)
    }
  }

  if (stillMissing.length === 0) return results

  // 3. Yahoo spark: every symbol, twenty per request (see the header of this file)
  let pending = stillMissing
  try {
    const spark = await yahooBreaker.execute(() => withTimeout(yahooSparkQuotes(pending)))
    for (const s of pending) {
      const quote = spark[s.toUpperCase()]
      if (quote?.price == null) continue
      const entry = { ...quote, symbol: s }
      setCache(s, entry)
      sharePrice(s, entry)
      results[s] = {
        price: entry.price,
        previousClose: entry.previousClose,
        change: entry.change,
        changePct: entry.changePct,
        currency: entry.currency,
        name: entry.name,
        fetchedAt: new Date().toISOString(),
      }
    }
    pending = pending.filter((s) => !results[s])
  } catch { /* fall through to the keyed providers */ }

  if (pending.length === 0) return results

  // 4. Split symbols: some should skip Twelve Data (e.g. ^-prefix US indices)
  const tdSymbols: string[] = []
  const skipTdSymbols: string[] = []
  for (const s of pending) {
    if (shouldSkipTwelveData(s)) {
      skipTdSymbols.push(s)
    } else {
      tdSymbols.push(s)
    }
  }

  let unresolved = [...skipTdSymbols]

  // 5. Try Twelve Data batch endpoint with circuit breaker (only compatible symbols)
  if (tdSymbols.length > 0 && await twelveData.isAvailable()) {
    try {
      const mappedSymbols = tdSymbols.map(toTwelveDataSymbol)
      const batchResults = await twelveDataBreaker.execute(() =>
        withRetry(() => withTimeout(twelveData.getBatchQuotes(mappedSymbols), 6_000), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 3000 })
      )

      for (let i = 0; i < tdSymbols.length; i++) {
        const original = tdSymbols[i]
        const mapped = mappedSymbols[i]
        const q = batchResults[mapped.toUpperCase()] || batchResults[mapped] || batchResults[original.toUpperCase()] || batchResults[original]
        if (q?.price != null) {
          const entry: QuoteResult = {
            symbol: original,
            price: q.price,
            previousClose: q.previousClose ?? null,
            change: q.change,
            changePct: q.changePct,
            currency: q.currency,
            exchange: q.exchange || '',
            name: resolveSymbolName(original, q.name),
          }
          setCache(original, entry)
          if (entry.price != null) {
            cacheBatchPrices({ [original]: { price: entry.price, previousClose: entry.previousClose, currency: entry.currency } }, QUOTE_TTL_S)
          }
          results[original] = {
            price: entry.price,
            previousClose: entry.previousClose,
            change: entry.change,
            changePct: entry.changePct,
            currency: entry.currency,
            name: entry.name,
            fetchedAt: new Date().toISOString(),
          }
        } else {
          unresolved.push(original)
        }
      }
    } catch {
      // Twelve Data failed entirely — all tdSymbols need fallback
      unresolved.push(...tdSymbols)
    }
  } else if (tdSymbols.length > 0) {
    // Twelve Data not available — all symbols need fallback
    unresolved.push(...tdSymbols)
  }

  if (unresolved.length === 0) return results

  // 6. Try Finnhub for unresolved symbols
  if (await finnhub.isAvailable()) {
    try {
      await fetchFinnhubBatch(unresolved, results)
      // Check which symbols are still missing after Finnhub
      unresolved = unresolved.filter(s => !results[s] && !results[s.toUpperCase()])
    } catch { /* fall through */ }
  }

  if (unresolved.length === 0) return results

  // 7. Final fallback: Yahoo Finance for remaining unresolved symbols
  await fetchYahooBatch(unresolved, results)
  return results
}

/** Helper: fetch multiple symbols via Finnhub in parallel */
async function fetchFinnhubBatch(
  symbols: string[],
  results: Record<string, BatchQuote>
) {
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await finnhubBreaker.execute(() =>
          withRetry(() => withTimeout(finnhub.getQuote(s)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
        )
        if (q?.price != null) {
          const entry: QuoteResult = {
            symbol: q.symbol,
            price: q.price,
            previousClose: q.previousClose,
            change: q.change,
            changePct: q.changePct,
            currency: q.currency,
            exchange: q.exchange,
          }
          setCache(s, entry)
          sharePrice(s, entry)
          results[q.symbol || s] = {
            price: entry.price,
            previousClose: entry.previousClose,
            change: entry.change,
            changePct: entry.changePct,
            currency: entry.currency,
            name: entry.name,
            fetchedAt: new Date().toISOString(),
          }
        }
      } catch { /* skip */ }
    })
  )
}

/** Helper: fetch multiple symbols via Yahoo in parallel */
async function fetchYahooBatch(
  symbols: string[],
  results: Record<string, BatchQuote>
) {
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await yahooBreaker.execute(() =>
          withRetry(() => withTimeout(yahooQuote(s)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
        )
        if (q) {
          setCache(s, q)
          sharePrice(s, q)
          results[q.symbol || s] = {
            price: q.price,
            previousClose: q.previousClose,
            change: q.change,
            changePct: q.changePct,
            currency: q.currency,
            name: q.name,
            fetchedAt: new Date().toISOString(),
          }
        }
      } catch { /* skip */ }
    })
  )
}

/** The provider chain for one series, with no cache in front of it. */
async function fetchHistory(symbol: string, range: string) {
  if (!shouldSkipTwelveData(symbol) && await twelveData.isAvailable()) {
    try {
      const tdSymbol = toTwelveDataSymbol(symbol)
      const history = await withTimeout(twelveData.getHistory(tdSymbol, range), 6_000)
      if (history.length > 0) return history
    } catch { /* fall through */ }
  }

  if (await finnhub.isAvailable()) {
    try {
      const history = await withTimeout(finnhub.getHistory(symbol, range), 6_000)
      if (history.length > 0) return history
    } catch { /* fall through */ }
  }

  return yahooHistory(symbol, range)
}

// ─── History cache ──────────────────────────────────────────────────────────
//
// getQuote has had a 60-second cache since the beginning. getHistory had none,
// and it is asked for far more often than it looks: opening one asset's page
// requests five series — /stats wants the symbol at 6mo, the benchmark at 6mo
// and the symbol at 5y; /signal wants the symbol at 6mo again; the chart asks
// for its own range — and two of those are the same request, made from
// different endpoints that could not see each other. Each one walked the whole
// provider chain, up to 6 seconds per source before falling through.
//
// Two layers, because they fix different halves of it: a Map, so the duplicate
// calls inside one invocation are free, and Redis, so the next invocation does
// not start from nothing. The TTLs are the ones /api/market/[symbol]/history
// has been serving this same data with.

type HistorySeries = Awaited<ReturnType<typeof fetchHistory>>

/** Ranges whose bars are intraday, and go stale within the session. */
const INTRADAY_RANGES = new Set(['1d', '5d'])
const HISTORY_TTL_MS = 3_600_000
const HISTORY_INTRADAY_TTL_MS = 300_000

function historyTtlMs(range: string): number {
  return INTRADAY_RANGES.has(range) ? HISTORY_INTRADAY_TTL_MS : HISTORY_TTL_MS
}

/** The range belongs in the key: a symbol's 6mo and 5y are different series. */
function historyKey(symbol: string, range: string): string {
  return `${symbol.toUpperCase()}:${range}`
}

const historyCache = new Map<string, { data: HistorySeries; expiresAt: number }>()

/** Clear the in-memory history cache (useful for testing) */
export function clearHistoryCache() {
  historyCache.clear()
}

export async function getHistory(symbol: string, range: string = '1mo'): Promise<HistorySeries> {
  const key = historyKey(symbol, range)
  const ttlMs = historyTtlMs(range)

  const local = historyCache.get(key)
  if (local && Date.now() < local.expiresAt) return local.data
  if (local) historyCache.delete(key)

  const shared = await cacheGet<HistorySeries>(`${CACHE_KEYS.MARKET_HISTORY}${key}`)
  if (shared && shared.length > 0) {
    historyCache.set(key, { data: shared, expiresAt: Date.now() + ttlMs })
    return shared
  }

  const history = await fetchHistory(symbol, range)

  // An empty series is what the provider chain returns when every source
  // failed. Remembering that for an hour would turn one bad minute into an
  // hour of empty charts, so only a real series is kept.
  if (history.length > 0) {
    historyCache.set(key, { data: history, expiresAt: Date.now() + ttlMs })
    await cacheSet(`${CACHE_KEYS.MARKET_HISTORY}${key}`, history, Math.round(ttlMs / 1000))
  }

  return history
}

/** Returns which data source is currently active */
export async function getActiveSource(): Promise<'twelve-data' | 'finnhub' | 'yahoo'> {
  if (await twelveData.isAvailable()) return 'twelve-data'
  if (await finnhub.isAvailable()) return 'finnhub'
  return 'yahoo'
}

/** Returns the health status of each data source (circuit breaker state) */
export function getSourceHealth(): Record<string, 'closed' | 'open' | 'half-open'> {
  return {
    'twelve-data': twelveDataBreaker.getState(),
    'finnhub': finnhubBreaker.getState(),
    'yahoo': yahooBreaker.getState(),
  }
}
