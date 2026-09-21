// Live prices over Supabase Realtime (C2) — pure functions, no I/O.
//
// Whoever fetches a fresh quote writes it to current_prices, and Realtime
// pushes the change to every client watching that symbol — another tab, another
// user holding the same stock.
//
// Streaming was meant to replace polling, which dropped to a five-minute
// heartbeat while the channel was up. But nothing writes current_prices except
// those same polls (and the nightly job): the stream carried only what the
// heartbeat fetched, so on a screen by itself prices moved every five minutes.
// Polling is the update path again, every LIVE_POLL_MS, and the stream is what
// it can actually be — the same prices, sooner, for everyone else watching.
//
// These functions decide what gets written, what a pushed row does to the
// prices on screen, what a client subscribes to, and how often it still polls.

import type { BatchQuote } from './market'

/** How long a stored quote is treated as current by the routes that read it. */
export const QUOTE_TTL_MS = 5 * 60 * 1000
/**
 * How long the server reuses a quote before asking a provider again, in memory
 * and in Redis (market.ts). It was 60 seconds in memory and five minutes in
 * Redis, which a screen polling for live prices would have been served for.
 */
export const LIVE_QUOTE_TTL_MS = 15 * 1000
/**
 * How often a visible screen asks for its prices, whatever the channel is doing.
 * The same as the server's quote TTL: asking more often returns the same price.
 */
export const LIVE_POLL_MS = LIVE_QUOTE_TTL_MS
/** Realtime's `in` filter accepts at most this many values. */
export const MAX_FILTER_SYMBOLS = 100
/**
 * Symbols per provider call. Twelve Data's batch endpoint takes twenty, so the
 * quotes route asks for them twenty at a time rather than in one call.
 */
export const QUOTES_PER_REQUEST = 20

export type CurrentPriceRow = {
  symbol: string
  exchange: string
  price: number
  change_pct: number | null
  volume: number
  currency: string
  source: string
  fetched_at: string
  expires_at: string
}

/**
 * A symbol list in provider-sized batches.
 *
 * The quotes route used to slice the list to twenty and answer for those, so a
 * book with more holdings than that silently had no live price for the rest —
 * and, since that route is what writes current_prices, their stored quote never
 * refreshed either. Every symbol asked for is now fetched.
 */
export function symbolChunks(symbols: string[], size: number = QUOTES_PER_REQUEST): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += Math.max(1, size)) chunks.push(symbols.slice(i, i + Math.max(1, size)))
  return chunks
}

/** Currency pairs live on the FX exchange, as the rates route has always stored them. */
export function exchangeFor(symbol: string): string {
  return symbol.endsWith('=X') ? 'FX' : 'US'
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * current_prices rows for the quotes a provider just returned.
 *
 * A quote without a positive, finite price is left out: a stored 0 would be
 * pushed to every client as a real price and read as a 100% loss.
 */
export function quotesToPriceRows(quotes: Record<string, BatchQuote>, now: number): CurrentPriceRow[] {
  const rows: CurrentPriceRow[] = []
  for (const [symbol, quote] of Object.entries(quotes)) {
    const price = toNumber(quote.price)
    if (price === null || price <= 0) continue
    rows.push({
      symbol,
      exchange: exchangeFor(symbol),
      price,
      change_pct: toNumber(quote.changePct),
      volume: 0,
      currency: quote.currency || 'USD',
      source: 'provider',
      // The quote's own read time when it has one: a price served from the
      // cache and published now is still as old as the read behind it.
      fetched_at: quote.fetchedAt && Number.isFinite(Date.parse(quote.fetchedAt)) ? quote.fetchedAt : new Date(now).toISOString(),
      expires_at: new Date(now + QUOTE_TTL_MS).toISOString(),
    })
  }
  return rows
}

export type StoredPrice = {
  symbol: string
  exchange: string
  price: unknown
  change_pct: unknown
  expires_at: string
}

/**
 * The rows worth writing: new symbols, changed prices, and stored rows that
 * have expired. Rewriting an identical price would make Realtime broadcast a
 * change that is not one to every client watching the symbol.
 */
export function changedRows(next: CurrentPriceRow[], stored: StoredPrice[], now: number): CurrentPriceRow[] {
  const byKey = new Map(stored.map((row) => [`${row.symbol}|${row.exchange}`, row]))
  return next.filter((row) => {
    const existing = byKey.get(`${row.symbol}|${row.exchange}`)
    if (!existing) return true
    if (Date.parse(existing.expires_at) <= now) return true
    return toNumber(existing.price) !== row.price || toNumber(existing.change_pct) !== row.change_pct
  })
}

export type PriceUpdate = { symbol: string; price: unknown; change_pct: unknown; fetched_at?: unknown }

/**
 * The prices on screen after a pushed row, or null when the row changes nothing
 * this view shows.
 *
 * The daily change is recomputed against the quote's own previous close when it
 * has one, so a pushed price moves the day's P&L consistently with the price
 * itself; the row's stored change is used only without that anchor.
 */
export function mergePriceUpdate(
  current: Record<string, BatchQuote> | undefined,
  update: PriceUpdate,
): Record<string, BatchQuote> | null {
  if (!current) return null
  const quote = current[update.symbol]
  if (!quote) return null

  const price = toNumber(update.price)
  if (price === null || price <= 0) return null

  const previousClose = toNumber(quote.previousClose)
  const anchored = previousClose !== null && previousClose > 0
  const change = anchored ? price - previousClose : quote.change
  const changePct = anchored ? ((price - previousClose) / previousClose) * 100 : toNumber(update.change_pct)

  // The pushed row's read time travels with its price; without one the price
  // is new and its age unknown, so the old timestamp must not vouch for it.
  const fetchedAt = typeof update.fetched_at === 'string' && Number.isFinite(Date.parse(update.fetched_at))
    ? update.fetched_at
    : undefined

  return {
    ...current,
    [update.symbol]: { ...quote, price, change, changePct, fetchedAt },
  }
}

/** Symbols a filter will accept: no commas, parentheses or spaces to break out with. */
const SAFE_SYMBOL = /^[A-Za-z0-9.^=_-]{1,20}$/

/**
 * The Realtime filter for the symbols on screen, or null for none.
 *
 * current_prices is shared market data that every signed-in user may read, so
 * row-level security alone would deliver every price anyone looks at. The
 * filter narrows the stream to what this view shows.
 */
export function realtimeSymbolFilter(symbols: string[]): string | null {
  const safe = [...new Set(symbols.filter((s) => SAFE_SYMBOL.test(s)))].sort().slice(0, MAX_FILTER_SYMBOLS)
  return safe.length > 0 ? `symbol=in.(${safe.join(',')})` : null
}

export type ChannelState = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'CONNECTING'

/** 1s, 2s, 4s … capped at 30s between resubscription attempts. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt))
}
