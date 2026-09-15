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

import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { getHistory } from './market'
import { adjustSeriesBySymbol } from './corporate-actions'

export type PriceRow = { symbol: string; date: string; close: number }

/** Which tier of the chain produced the rows; 'mixed' when stored rows were completed from a provider. */
export type HistorySource = 'stored' | 'provider' | 'mixed' | 'none'

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
  /** A symbol with fewer stored rows than this is fetched from the providers. */
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
  return serviceRoleClient()
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
  // Newest first, so a limit drops the oldest closes and never the latest ones:
  // ascending with a limit returned the first rows ever stored, and once a book
  // held enough symbols its recent closes were cut off.
  const { data: stored } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: false })
    .limit(limit)

  // The stored tier is judged per symbol. Judged across the whole request, a
  // book whose older holdings were stored never fetched a newer one: the other
  // rows cleared the threshold, the new symbol came back as `missing`, and it
  // stayed out of every risk figure for good.
  const storedRows = (stored ?? []) as PriceRow[]
  const storedCount = new Map<string, number>()
  for (const row of storedRows) storedCount.set(row.symbol, (storedCount.get(row.symbol) ?? 0) + 1)
  const thin = new Set(symbols.filter((s) => (storedCount.get(s) ?? 0) < minStoredRows))

  if (thin.size < symbols.length) {
    const kept = storedRows.filter((r) => !thin.has(r.symbol))
    const added = await topUpStoredHistory(lastStoredDates(kept))

    // Thin symbols go to the providers, at most once per retry window each, so
    // a symbol no provider knows does not cost three timeouts on every request.
    const now = Date.now()
    const due = [...thin].filter((symbol) => {
      const key = `thin:${symbol}`
      const attempted = lastTopUpAttempt.get(key)
      if (attempted !== undefined && now - attempted < TOP_UP_RETRY_MS) return false
      lastTopUpAttempt.set(key, now)
      return true
    })
    const fromProviders = await fetchFromProviders(due, range)
    const thinStored = storedRows.filter((r) => thin.has(r.symbol))

    const rows = adjustSeriesBySymbol(mergeRows([...kept, ...thinStored], [...added, ...fromProviders]))
    return { rows, source: added.length + fromProviders.length > 0 ? 'mixed' : 'stored', ...coverage(rows, symbols) }
  }

  // ── Tier 2: the live provider chain ──────────────────────────────────────
  const fetched = await fetchFromProviders(symbols, range)
  if (fetched.length === 0) return { rows: [], source: 'none', covered: [], missing: symbols }

  const rows = adjustSeriesBySymbol(fetched)
  return { rows, source: 'provider', ...coverage(rows, symbols) }
}

/**
 * Daily closes from the provider chain, written through as they arrive.
 *
 * One symbol failing must not take the whole book down; it is simply absent
 * from the result and shows up in `missing` for the caller to report. An
 * unfinished session is served but not stored (see topUpStoredHistory).
 */
async function fetchFromProviders(symbols: string[], range: string): Promise<PriceRow[]> {
  if (symbols.length === 0) return []
  const fetched: PriceRow[] = []
  const rowsToCache: StoredBar[] = []
  const settled = lastSettledSession()

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const history = await getHistory(symbol, range)
        for (const point of history) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          fetched.push({ symbol, date, close: point.close })
          if (date <= settled) rowsToCache.push(storedBar(symbol, date, point))
        }
      } catch {
        // Absent from the result; see above.
      }
    }),
  )

  await writeThrough(rowsToCache)
  return fetched
}

// ─── Keeping the stored tier current ────────────────────────────────────────
//
// The stored tier answered every request once it held enough rows, and nothing
// ever asked whether those rows were recent. The table stopped at the last day
// something fell through to the providers, and from then on every chart, return
// and risk figure was computed on a series that ended there — the portfolio line
// went flat and stayed flat. A stored series now gets the sessions it is missing
// before it is used.

/**
 * Hour (UTC) after which a weekday's session counts as closed for every market
 * quoted here: New York closes at 20:00 or 21:00 UTC, and the providers publish
 * the final bar shortly after.
 */
const SETTLED_HOUR_UTC = 22

/** How long a symbol that could not be topped up waits before it is tried again. */
export const TOP_UP_RETRY_MS = 30 * 60 * 1000

/**
 * The most recent session whose close should already be stored (YYYY-MM-DD).
 *
 * Weekends are skipped; exchange holidays are not known here, so on a holiday
 * the top-up finds nothing new and is not retried for TOP_UP_RETRY_MS.
 */
export function lastSettledSession(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (now.getUTCHours() < SETTLED_HOUR_UTC) day.setUTCDate(day.getUTCDate() - 1)
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

/** A stored series ending before the last settled session is missing closes. */
export function isHistoryStale(lastDate: string | undefined, now: Date = new Date()): boolean {
  return !lastDate || lastDate < lastSettledSession(now)
}

/** The shortest provider range that still returns daily bars back to the last stored date. */
export function topUpRange(lastDate: string, now: Date = new Date()): string {
  const days = (Date.parse(lastSettledSession(now)) - Date.parse(lastDate)) / 86_400_000
  if (days <= 25) return '1mo'
  if (days <= 85) return '3mo'
  return '6mo'
}

/** Each symbol's latest stored date. */
export function lastStoredDates(rows: Array<{ symbol: string; date: string }>): Record<string, string> {
  const last: Record<string, string> = {}
  for (const row of rows) {
    if (!last[row.symbol] || row.date > last[row.symbol]) last[row.symbol] = row.date
  }
  return last
}

/** Stored rows plus top-up rows, one per symbol and date, ascending. */
export function mergeRows(stored: PriceRow[], added: PriceRow[]): PriceRow[] {
  const byKey = new Map<string, PriceRow>()
  for (const row of [...stored, ...added]) byKey.set(`${row.symbol}|${row.date}`, row)
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
}

const lastTopUpAttempt = new Map<string, number>()

/** Forget recent top-up attempts (tests). */
export function resetTopUpAttempts() {
  lastTopUpAttempt.clear()
}

/**
 * The closes each stored series is missing, fetched and written through.
 *
 * Takes each symbol's latest stored date and returns only the new settled
 * sessions after it — raw, like everything stored. Today's bar is left out
 * until the session has closed: stored mid-session it would sit in the table
 * as that day's close and, being the latest date, stop the next top-up.
 */
export async function topUpStoredHistory(
  lastDates: Record<string, string>,
  now: Date = new Date(),
): Promise<PriceRow[]> {
  const settled = lastSettledSession(now)
  const due = Object.entries(lastDates).filter(([symbol, last]) => {
    if (!isHistoryStale(last, now)) return false
    const attempted = lastTopUpAttempt.get(symbol)
    return attempted === undefined || now.getTime() - attempted >= TOP_UP_RETRY_MS
  })
  if (due.length === 0) return []

  const added: PriceRow[] = []
  const bars: StoredBar[] = []
  await Promise.all(
    due.map(async ([symbol, last]) => {
      lastTopUpAttempt.set(symbol, now.getTime())
      try {
        for (const point of await getHistory(symbol, topUpRange(last, now))) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          if (date <= last || date > settled) continue
          added.push({ symbol, date, close: point.close })
          bars.push(storedBar(symbol, date, point))
        }
      } catch {
        // The stored series is still served; the symbol is retried later.
      }
    }),
  )

  await writeThrough(bars)
  return added
}

type StoredBar = {
  symbol: string
  exchange: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type ProviderBar = { open?: number | null; high?: number | null; low?: number | null; close: number; volume?: number | null }

function storedBar(symbol: string, date: string, point: ProviderBar): StoredBar {
  return {
    symbol,
    exchange: 'yahoo',
    date,
    open: point.open ?? 0,
    high: point.high ?? 0,
    low: point.low ?? 0,
    close: point.close,
    volume: point.volume ?? 0,
  }
}

/** Write provider bars back to price_history with the service role. */
export async function writeThrough(rowsToCache: StoredBar[]): Promise<void> {
  if (rowsToCache.length === 0) return
  // Service role, not the caller's session: see cacheWriter above.
  //
  // The previous version of this block claimed it was "no longer the SILENT
  // default", and was: it wrapped the upsert in try/catch with an empty
  // handler. supabase-js does not THROW on a failed write, it returns
  // { error }, so the catch caught nothing and the error object was dropped
  // on the floor. The cache stayed empty and said nothing, for the second
  // time, for a different reason than the first.
  //
  // A cache write failing is genuinely not a read failure — the rows are
  // already in hand and the caller gets them. But it has to be audible, or
  // the next person measures an empty table and has no idea why.
  const writer = cacheWriter()
  if (!writer) {
    console.warn(
      '[price-history] no se pudo escribir el cache: falta SUPABASE_SERVICE_ROLE_KEY',
    )
  } else {
    try {
      const { error } = await writer
        .from('price_history')
        .upsert(rowsToCache, { onConflict: 'symbol,exchange,date' })
      if (error) {
        console.warn('[price-history] fallo al escribir el cache', {
          filas: rowsToCache.length,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        })
      }
    } catch (thrown) {
      // Network-level failure, which DOES throw.
      console.warn('[price-history] la escritura del cache lanzo', thrown)
    }
  }
}
