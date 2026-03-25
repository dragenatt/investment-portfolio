/**
 * Market data service with multi-source fallback
 *
 * Priority: Twelve Data (if API key set) → Yahoo Finance (always available)
 * Each function tries the primary source first, falls back automatically.
 */

import * as twelveData from './twelve-data'

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

async function yahooQuote(symbol: string) {
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

// ─── Public API (with automatic fallback) ────────────────────────────────

export async function searchSymbols(query: string) {
  // Try Twelve Data first (doesn't need API key for search)
  try {
    const results = await twelveData.searchSymbols(query)
    if (results.length > 0) return results
  } catch { /* fall through */ }

  // Fallback to Yahoo
  return yahooSearch(query)
}

export async function getQuote(symbol: string) {
  // Try Twelve Data if available
  if (await twelveData.isAvailable()) {
    try {
      const quote = await twelveData.getQuote(symbol)
      if (quote?.price != null) return quote
    } catch { /* fall through */ }
  }

  // Fallback to Yahoo
  return yahooQuote(symbol)
}

export async function getHistory(symbol: string, range: string = '1mo') {
  // Try Twelve Data if available
  if (await twelveData.isAvailable()) {
    try {
      const history = await twelveData.getHistory(symbol, range)
      if (history.length > 0) return history
    } catch { /* fall through */ }
  }

  // Fallback to Yahoo
  return yahooHistory(symbol, range)
}

/** Returns which data source is currently active */
export async function getActiveSource(): Promise<'twelve-data' | 'yahoo'> {
  return (await twelveData.isAvailable()) ? 'twelve-data' : 'yahoo'
}
