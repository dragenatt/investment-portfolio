/**
 * Market data service with multi-source fallback + in-memory cache
 *
 * Priority: Twelve Data (if API key set) → Yahoo Finance (always available)
 * Each function tries the primary source first, falls back automatically.
 *
 * Performance:
 * - In-memory quote cache (60s TTL) avoids redundant external API calls
 * - getBatchQuotes() uses Twelve Data's native batch endpoint (1 call for N symbols)
 * - Fallback timeout of 4s prevents slow cascading failures
 */

import * as twelveData from './twelve-data'

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
    { next: { revalidate: 60 } }
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
    { next: { revalidate: 30 } }
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
    { next: { revalidate: 300 } }
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
  // 1. Check cache first
  const cached = getCached(symbol)
  if (cached) return cached

  // 2. Try Twelve Data with timeout
  if (await twelveData.isAvailable()) {
    try {
      const quote = await withTimeout(twelveData.getQuote(symbol))
      if (quote?.price != null) {
        setCache(symbol, quote)
        return quote
      }
    } catch { /* fall through */ }
  }

  // 3. Fallback to Yahoo with timeout
  try {
    const quote = await withTimeout(yahooQuote(symbol))
    if (quote) setCache(symbol, quote)
    return quote
  } catch {
    return null
  }
}

/**
 * Batch quote fetcher — single API call for multiple symbols.
 * Uses Twelve Data's native batch endpoint when available,
 * otherwise falls back to parallel Yahoo calls.
 * All results are cached individually.
 */
export async function getBatchQuotes(
  symbols: string[]
): Promise<Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>> {
  const results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }> = {}
  const uncached: string[] = []

  // 1. Serve from cache first
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

  // 2. Try Twelve Data batch endpoint (single HTTP call for all symbols)
  if (await twelveData.isAvailable()) {
    try {
      const batchResults = await withTimeout(
        twelveData.getBatchQuotes(uncached),
        6_000 // slightly longer timeout for batch
      )
      const stillMissing: string[] = []

      for (const s of uncached) {
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
          results[entry.symbol] = {
            price: entry.price,
            change: entry.change,
            changePct: entry.changePct,
            currency: entry.currency,
          }
        } else {
          stillMissing.push(s)
        }
      }

      // Only fall back for symbols that Twelve Data couldn't resolve
      if (stillMissing.length > 0) {
        await fetchYahooBatch(stillMissing, results)
      }

      return results
    } catch { /* fall through to Yahoo */ }
  }

  // 3. Fallback: parallel Yahoo calls
  await fetchYahooBatch(uncached, results)
  return results
}

/** Helper: fetch multiple symbols via Yahoo in parallel */
async function fetchYahooBatch(
  symbols: string[],
  results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>
) {
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await withTimeout(yahooQuote(s))
        if (q) {
          setCache(s, q)
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

  return yahooHistory(symbol, range)
}

/** Returns which data source is currently active */
export async function getActiveSource(): Promise<'twelve-data' | 'yahoo'> {
  return (await twelveData.isAvailable()) ? 'twelve-data' : 'yahoo'
}
