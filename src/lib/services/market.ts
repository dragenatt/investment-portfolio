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
 * - Redis cache for cross-invocation performance
 * - Automatic fallback with timeout of 4s per source
 */

import * as twelveData from './twelve-data'
import * as finnhub from './finnhub'
import { CircuitBreaker, withRetry } from './resilience'
import { getCachedPrice, cachePrice, getCachedBatchPrices, cacheBatchPrices } from '@/lib/cache/redis'

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

function getCached(symbol: string): QuoteResult | null {
  const entry = quoteCache.get(symbol.toUpperCase())
  if (entry && Date.now() < entry.expiresAt) return entry.data
  if (entry) quoteCache.delete(symbol.toUpperCase())
  return null
}

function setCache(symbol: string, data: QuoteResult) {
  quoteCache.set(symbol.toUpperCase(), { data, expiresAt: Date.now() + CACHE_TTL_MS })
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
  const previousClose = meta.previousClose ?? null
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

  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString(),
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    volume: quotes.volume?.[i],
  })).filter((p: { close: number | null }) => p.close !== null)
}

// ─── Public API (with automatic fallback + caching) ──────────────────────

export async function searchSymbols(query: string) {
  try {
    const results = await withTimeout(twelveData.searchSymbols(query))
    if (results.length > 0) return results
  } catch { /* fall through */ }

  return yahooSearch(query)
}

export async function getQuote(symbol: string): Promise<QuoteResult | null> {
  // 1. In-memory cache
  const memCached = getCached(symbol)
  if (memCached) return memCached

  // 2. Redis cache
  const redisCached = await getCachedPrice(symbol)
  if (redisCached) {
    const quoteResult: QuoteResult = {
      symbol: symbol.toUpperCase(),
      price: redisCached,
      previousClose: null,
      change: null,
      changePct: null,
      currency: 'USD',
      exchange: '',
    }
    setCache(symbol, quoteResult)
    return quoteResult
  }

  // 3. Try Twelve Data with circuit breaker and retry
  if (await twelveData.isAvailable()) {
    try {
      const quote = await twelveDataBreaker.execute(() =>
        withRetry(() => withTimeout(twelveData.getQuote(symbol)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
      )
      if (quote?.price != null) {
        setCache(symbol, quote)
        if (quote.price != null) cachePrice(symbol, quote.price, 300)
        return quote
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
        }
        setCache(symbol, quoteResult)
        if (quoteResult.price != null) cachePrice(symbol, quoteResult.price, 300)
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
      if (quote.price != null) cachePrice(symbol, quote.price, 300)
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
export async function getBatchQuotes(
  symbols: string[]
): Promise<Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>> {
  const results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }> = {}
  const uncached: string[] = []

  // 1. Serve from in-memory cache first
  for (const s of symbols) {
    const cached = getCached(s)
    if (cached) {
      results[cached.symbol || s] = {
        price: cached.price,
        change: cached.change,
        changePct: cached.changePct,
        currency: cached.currency,
      }
    } else {
      uncached.push(s)
    }
  }

  if (uncached.length === 0) return results

  // 2. Check Redis cache for remaining symbols
  const redisCachedPrices = await getCachedBatchPrices(uncached)
  const stillMissing: string[] = []
  for (const s of uncached) {
    const redisPrice = redisCachedPrices[s]
    if (redisPrice != null) {
      const entry: QuoteResult = {
        symbol: s.toUpperCase(),
        price: redisPrice,
        previousClose: null,
        change: null,
        changePct: null,
        currency: 'USD',
        exchange: '',
      }
      setCache(s, entry)
      results[s.toUpperCase()] = {
        price: entry.price,
        change: entry.change,
        changePct: entry.changePct,
        currency: entry.currency,
      }
    } else {
      stillMissing.push(s)
    }
  }

  if (stillMissing.length === 0) return results

  // 3. Try Twelve Data batch endpoint with circuit breaker
  if (await twelveData.isAvailable()) {
    try {
      const batchResults = await twelveDataBreaker.execute(() =>
        withRetry(() => withTimeout(twelveData.getBatchQuotes(stillMissing), 6_000), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 3000 })
      )
      const unresolved: string[] = []

      for (const s of stillMissing) {
        const q = batchResults[s.toUpperCase()] || batchResults[s]
        if (q?.price != null) {
          const entry: QuoteResult = {
            symbol: q.symbol || s,
            price: q.price,
            previousClose: q.previousClose ?? null,
            change: q.change,
            changePct: q.changePct,
            currency: q.currency,
            exchange: q.exchange || '',
            name: q.name || s,
          }
          setCache(s, entry)
          if (entry.price != null) cacheBatchPrices({ [s]: entry.price }, 300)
          results[entry.symbol] = {
            price: entry.price,
            change: entry.change,
            changePct: entry.changePct,
            currency: entry.currency,
          }
        } else {
          unresolved.push(s)
        }
      }

      // Fall back to Finnhub for symbols that Twelve Data couldn't resolve
      if (unresolved.length > 0) {
        await fetchFinnhubBatch(unresolved, results)
      }

      return results
    } catch { /* fall through to Finnhub */ }
  }

  // 4. Try Finnhub individual calls with circuit breaker
  if (await finnhub.isAvailable()) {
    try {
      await fetchFinnhubBatch(stillMissing, results)
      return results
    } catch { /* fall through to Yahoo */ }
  }

  // 5. Fallback: parallel Yahoo calls with circuit breaker
  await fetchYahooBatch(stillMissing, results)
  return results
}

/** Helper: fetch multiple symbols via Finnhub in parallel */
async function fetchFinnhubBatch(
  symbols: string[],
  results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>
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
          if (entry.price != null) cachePrice(s, entry.price, 300)
          results[q.symbol || s] = {
            price: entry.price,
            change: entry.change,
            changePct: entry.changePct,
            currency: entry.currency,
          }
        }
      } catch { /* skip */ }
    })
  )
}

/** Helper: fetch multiple symbols via Yahoo in parallel */
async function fetchYahooBatch(
  symbols: string[],
  results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>
) {
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await yahooBreaker.execute(() =>
          withRetry(() => withTimeout(yahooQuote(s)), { maxRetries: 1, baseDelayMs: 300, maxDelayMs: 2000 })
        )
        if (q) {
          setCache(s, q)
          if (q.price != null) cachePrice(s, q.price, 300)
          results[q.symbol || s] = {
            price: q.price,
            change: q.change,
            changePct: q.changePct,
            currency: q.currency,
          }
        }
      } catch { /* skip */ }
    })
  )
}

export async function getHistory(symbol: string, range: string = '1mo') {
  if (await twelveData.isAvailable()) {
    try {
      const history = await withTimeout(twelveData.getHistory(symbol, range), 6_000)
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
