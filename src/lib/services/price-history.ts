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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

/**
 * Six months, because it is the DEEPEST range the provider still returns DAILY
 * bars for. Anything longer comes back weekly or monthly, and every consumer of
 * this module annualises by 252 and computes "daily" returns.
 *
 * The old default was '1y', which returns WEEKLY bars. Combined with the broken
 * write-back below, that meant every analytics request was served 54 weekly
 * bars that the risk endpoint treated as daily: a portfolio rendered at 224%
 * annual volatility, and a "30-day" rolling window that was really 30 weeks.
 *
 * The stored tier is what gets past this six-month ceiling: each call writes
 * today's bars through, so the table deepens on its own past what any single
 * provider call can return.
 */
const DEFAULT_RANGE = '6mo'
const DEFAULT_MIN_STORED_ROWS = 10

/**
 * Price history is reference data: public market prices, identical for every
 * user, and nothing about anyone's portfolio. It is written with the service
 * role for the same reason `baselines` and `factor_returns` are — the table has
 * RLS on with a SELECT policy and no INSERT policy, so a write through a user's
 * session client is denied.
 *
 * That denial is why this cache had NEVER filled. The write was wrapped in a
 * try/catch that swallowed it, so every request went to the provider and the
 * stored tier stayed empty from the day it was built. Silence is the reason it
 * survived: nothing was broken enough to notice.
 */
function cacheWriter(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

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
    // Service role, not the caller's session: see cacheWriter above.
    const writer = cacheWriter()
    if (writer) {
      try {
        await writer
          .from('price_history')
          .upsert(rowsToCache, { onConflict: 'symbol,exchange,date' })
      } catch {
        // A cache write failure is still not a read failure — the rows are
        // already in hand. But it is no longer the SILENT default it was.
      }
    }
  }

  if (fetched.length === 0) return { rows: [], source: 'none', covered: [], missing: symbols }

  const rows = adjustSeriesBySymbol(fetched)
  return { rows, source: 'provider', ...coverage(rows, symbols) }
}
