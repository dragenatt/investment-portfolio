// Historical price access — the one place that decides where a price series
// comes from and says which tier answered.
//
// The chain is: stored history first, then the live provider chain, and the
// provider results are written back so the next reader hits the stored tier.
// Whichever tier answers, the series is split-adjusted on the way out, because
// what gets stored is raw and a raw split is a -75% day (see corporate-actions).
//
// This used to be copy-pasted, character for character, into the risk endpoint
// and the Monte Carlo endpoint. Two copies of a data path is two places for the
// ordering to drift apart, which is exactly what roadmap rule #2 forbids.

import { type SupabaseClient } from '@supabase/supabase-js'
import { getHistory } from './market'
import { adjustSeriesBySymbol } from './corporate-actions'

export type PriceRow = { symbol: string; date: string; close: number }

/** Which tier of the chain produced the rows. */
export type HistorySource = 'stored' | 'provider' | 'none'

export type HistoryResult = {
  /** Split-adjusted, ascending by date. */
  rows: PriceRow[]
  source: HistorySource
  /** Symbols the result actually has prices for. */
  covered: string[]
  /** Symbols nothing could be found for — the caller decides whether that is fatal. */
  missing: string[]
}

export type FetchOptions = {
  /** Maximum stored rows to pull across all symbols. */
  limit?: number
  /** Range requested from the provider chain when the stored tier is thin. */
  range?: string
  /** Stored rows below this count send the request on to the providers. */
  minStoredRows?: number
}

const DEFAULT_LIMIT = 2000
const DEFAULT_RANGE = '1y'
const DEFAULT_MIN_STORED_ROWS = 10

function coverage(rows: PriceRow[], symbols: string[]): { covered: string[]; missing: string[] } {
  const seen = new Set(rows.map((r) => r.symbol))
  return {
    covered: symbols.filter((s) => seen.has(s)),
    missing: symbols.filter((s) => !seen.has(s)),
  }
}

/**
 * Daily closes for a set of symbols, split-adjusted and ascending by date.
 *
 * Stored rows are preferred because they are fast and do not spend a provider
 * call. Falling through to the providers writes what it finds back to
 * price_history — raw, exactly as quoted, so the stored tier stays a faithful
 * record and adjustment stays a read-time decision that can be improved later
 * without a backfill.
 */
export async function fetchAdjustedPriceHistory(
  supabase: SupabaseClient,
  symbols: string[],
  options: FetchOptions = {},
): Promise<HistoryResult> {
  if (symbols.length === 0) return { rows: [], source: 'none', covered: [], missing: [] }

  const limit = options.limit ?? DEFAULT_LIMIT
  const range = options.range ?? DEFAULT_RANGE
  const minStoredRows = options.minStoredRows ?? DEFAULT_MIN_STORED_ROWS

  // ── Tier 1: stored history ───────────────────────────────────────────────
  const { data: stored } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })
    .limit(limit)

  if (stored && stored.length >= minStoredRows) {
    const rows = adjustSeriesBySymbol(stored as PriceRow[])
    return { rows, source: 'stored', ...coverage(rows, symbols) }
  }

  // ── Tier 2: the live provider chain ──────────────────────────────────────
  const fetched: PriceRow[] = []
  const rowsToCache: Array<{
    symbol: string
    exchange: string
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }> = []

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const history = await getHistory(symbol, range)
        for (const point of history) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          fetched.push({ symbol, date, close: point.close })
          rowsToCache.push({
            symbol,
            exchange: 'yahoo',
            date,
            open: point.open ?? 0,
            high: point.high ?? 0,
            low: point.low ?? 0,
            close: point.close,
            volume: point.volume ?? 0,
          })
        }
      } catch {
        // One symbol failing must not take the whole book down; it shows up in
        // `missing` so the caller can say so.
      }
    }),
  )

  if (rowsToCache.length > 0) {
    try {
      await supabase.from('price_history').upsert(rowsToCache, { onConflict: 'symbol,exchange,date' })
    } catch {
      // A cache write failure is not a read failure.
    }
  }

  if (fetched.length === 0) return { rows: [], source: 'none', covered: [], missing: symbols }

  const rows = adjustSeriesBySymbol(fetched)
  return { rows, source: 'provider', ...coverage(rows, symbols) }
}
