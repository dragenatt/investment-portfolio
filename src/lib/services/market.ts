/**
 * Market data service with multi-source fallback + caching
 *
 * Priority: Twelve Data (if API key set) → Finnhub (if API key set) → Yahoo Finance (always available)
 * Each function tries the primary source first, falls back automatically.
 *
 * Resilience:
 * - Circuit breakers for each data source
 * - Retry with exponential backoff for transient failures
 * - In-memory quote cache (60s TTL) for within-invocation reuse
 * - History cache, in memory and in Redis (5 min intraday, 1 hour otherwise)
 * - Redis cache for cross-invocation performance
 * - Automatic fallback with timeout of 4s per source
 */

import * as twelveData from './twelve-data'
import * as finnhub from './finnhub'
import { CircuitBreaker, withRetry } from './resilience'
import { cachePrice, cacheBatchPrices, getCachedPriceEntries, cacheGet, cacheSet, CACHE_KEYS, type CachedPriceEntry } from '@/lib/cache/redis'

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

const CACHE_TTL_MS = 60_000 // 60 seconds
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
  cachePrice(symbol, quote.price, 300, { previousClose: quote.previousClose, currency: quote.currency })
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

async function yahooQuote(symbol: string): Promise<QuoteResult | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { next: { revalidate: 30 } } as RequestInit
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
    symbol: meta.symbol,
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

async function yahooHistory(symbol: string, range: string = '1mo') {
  const intervalMap: Record<string, string> = {
    '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
    '6mo': '1d', '1y': '1wk', '5y': '1mo', 'max': '1mo',
  }
  const interval = intervalMap[range] || '1d'

  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
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

// ─── Search aliases for common terms people use ─────────────────────────

const SEARCH_ALIASES: Array<{
  keywords: string[]
  result: { symbol: string; name: string; type: string; exchange: string; exchDisp: string }
}> = [
  { keywords: ['syp500', 'sp500', 's&p500', 's&p 500', 'snp500', 'spy500', 'standard poor'],
    result: { symbol: '^GSPC', name: 'S&P 500', type: 'index', exchange: 'SNP', exchDisp: 'SNP' } },
  { keywords: ['nasdaq', 'nasaq', 'nasdac', 'ixic'],
    result: { symbol: '^IXIC', name: 'Nasdaq Composite', type: 'index', exchange: 'NASDAQ', exchDisp: 'NASDAQ' } },
  { keywords: ['dow jones', 'dow', 'djia', 'dji'],
    result: { symbol: '^DJI', name: 'Dow Jones Industrial', type: 'index', exchange: 'DJI', exchDisp: 'DJI' } },
  { keywords: ['nikkei', 'n225', 'japon', 'japan'],
    result: { symbol: '^N225', name: 'Nikkei 225', type: 'index', exchange: 'OSA', exchDisp: 'Osaka' } },
  { keywords: ['ftse', 'london', 'londres'],
    result: { symbol: '^FTSE', name: 'FTSE 100', type: 'index', exchange: 'LSE', exchDisp: 'London' } },
  { keywords: ['russell', 'rut', 'russell2000'],
    result: { symbol: '^RUT', name: 'Russell 2000', type: 'index', exchange: 'RUS', exchDisp: 'Russell' } },
  { keywords: ['femsa', 'femsaubd', 'oxxo'],
    result: { symbol: 'FEMSAUBD.MX', name: 'FEMSA UBD', type: 'stock', exchange: 'BMV', exchDisp: 'BMV' } },
]

function matchAliases(query: string): typeof SEARCH_ALIASES[number]['result'][] {
  const q = query.toLowerCase().trim()
  return SEARCH_ALIASES
    .filter(a => a.keywords.some(k => q.includes(k) || k.includes(q)))
    .map(a => a.result)
}

export async function searchSymbols(query: string) {
  // Check local aliases first
  const aliasMatches = matchAliases(query)

  try {
    const results = await withTimeout(twelveData.searchSymbols(query))
    if (results.length > 0) {
      // Prepend alias matches that aren't already in results
      const existing = new Set(results.map((r: { symbol: string }) => r.symbol))
      const unique = aliasMatches.filter(a => !existing.has(a.symbol))
      return [...unique, ...results]
    }
  } catch { /* fall through */ }

  const yahooResults = await yahooSearch(query)
  if (yahooResults.length > 0) {
    const existing = new Set(yahooResults.map((r: { symbol: string }) => r.symbol))
    const unique = aliasMatches.filter(a => !existing.has(a.symbol))
    return [...unique, ...yahooResults]
  }

  // If APIs returned nothing, return alias matches only
  return aliasMatches
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

  // 3. Try Twelve Data with circuit breaker and retry (skip unsupported symbols)
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

  // 4. Try Finnhub with circuit breaker and retry
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

  // 5. Fallback to Yahoo with circuit breaker and retry
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

  // 3. Split symbols: some should skip Twelve Data (e.g. ^-prefix US indices)
  const tdSymbols: string[] = []
  const skipTdSymbols: string[] = []
  for (const s of stillMissing) {
    if (shouldSkipTwelveData(s)) {
      skipTdSymbols.push(s)
    } else {
      tdSymbols.push(s)
    }
  }

  let unresolved = [...skipTdSymbols]

  // 4. Try Twelve Data batch endpoint with circuit breaker (only compatible symbols)
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
            cacheBatchPrices({ [original]: { price: entry.price, previousClose: entry.previousClose, currency: entry.currency } }, 300)
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

  // 5. Try Finnhub for unresolved symbols
  if (await finnhub.isAvailable()) {
    try {
      await fetchFinnhubBatch(unresolved, results)
      // Check which symbols are still missing after Finnhub
      unresolved = unresolved.filter(s => !results[s] && !results[s.toUpperCase()])
    } catch { /* fall through */ }
  }

  if (unresolved.length === 0) return results

  // 6. Final fallback: Yahoo Finance for remaining unresolved symbols
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
