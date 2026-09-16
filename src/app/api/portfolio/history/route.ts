import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { cacheGet, cacheSet } from '@/lib/cache/redis'
import { getHistory } from '@/lib/services/market'
import { computeDailyPositions, buildDailyTimeline, snapshotsCoverWindow, type DailySnapshot } from '@/lib/services/portfolio-history'
import { buildIntradayTimeline, MIN_INTRADAY_POINTS, type IntradayBar } from '@/lib/services/portfolio-intraday'
import { lastSettledSession, topUpStoredHistory, writeThrough, isDailyRange } from '@/lib/services/price-history'
import { apiHandler } from '@/lib/api/handler'

/**
 * The provider range each button asks for.
 *
 * Every entry returns ONE BAR PER SESSION. '1y' and 'max' used to be mapped to
 * the provider ranges of the same names, which come back weekly and monthly —
 * and those bars were then written into price_history as if they were daily
 * closes. Six months is the deepest daily range the providers serve; past that
 * the stored tier, which deepens a session at a time, is what covers the window.
 */
const RANGE_MAP: Record<string, string> = {
  '30': '1mo',
  '90': '3mo',
  '365': '6mo',
  'max': '6mo',
}

/**
 * The two ranges a daily close cannot draw.
 *
 * A day holds one close, so "1D" was a line between yesterday's and today's —
 * two dots and a straight segment. These ranges are drawn from intraday bars
 * instead; see portfolio-intraday.ts.
 */
const INTRADAY_RANGE: Record<string, string> = {
  '1': '1d',
  '7': '5d',
}

/** Days of stored closes to read for the price each intraday window opens at. */
const PREVIOUS_CLOSE_LOOKBACK_DAYS = 12

type FlatTransaction = {
  executed_at: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  symbol: string
  quantity: number
  price: number
}

/** Symbols the book held at any point from `since` onwards. */
function symbolsHeldSince(snapshots: DailySnapshot[], since: string): string[] {
  const held = new Set<string>()
  // The snapshot in force when the window opens counts too, even if it predates it.
  const opening = [...snapshots].reverse().find((s) => s.date <= since) ?? snapshots[0]
  for (const snapshot of [opening, ...snapshots.filter((s) => s.date >= since)]) {
    for (const [symbol, quantity] of Object.entries(snapshot?.positions ?? {})) {
      if (quantity > 0) held.add(symbol)
    }
  }
  return [...held]
}

/** Provider bars for each symbol, five symbols at a time, failures left out. */
async function fetchIntradayBars(symbols: string[], range: string): Promise<Record<string, IntradayBar[]>> {
  const bars: Record<string, IntradayBar[]> = {}
  for (let i = 0; i < symbols.length; i += 5) {
    const chunk = symbols.slice(i, i + 5)
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const history = await getHistory(symbol, range)
          return {
            symbol,
            bars: history
              .filter((point: { close: number | null }) => point.close != null)
              .map((point: { date: string; close: number }) => ({ time: new Date(point.date).toISOString(), close: point.close })),
          }
        } catch {
          return { symbol, bars: [] as IntradayBar[] }
        }
      }),
    )
    for (const result of results) if (result.bars.length > 0) bars[result.symbol] = result.bars
  }
  return bars
}

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'general')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') || '30'

  // Check Redis cache (5 min TTL — this is a heavy computation)
  const cacheKey = `portfolio:history:${user.id}:${range}`
  const cached = await cacheGet<Array<Record<string, unknown>>>(cacheKey)
  if (cached) return success(cached)

  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id')
    .is('deleted_at', null)

  if (!portfolios || portfolios.length === 0) return success([])

  const portfolioIds = portfolios.map(p => p.id)

  // Compute cutoff date for range filtering
  const rangeDays = range === 'max' ? 3650 : (parseInt(range) || 30)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - rangeDays)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  const loadTransactions = async (): Promise<FlatTransaction[]> => {
    const { data } = await supabase
      .from('transactions')
      .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id, symbol)')
      .in('position.portfolio_id', portfolioIds)
      .order('executed_at', { ascending: true })
      // Ties on executed_at (the modal records a date, not a time) replay in entry order.
      .order('created_at', { ascending: true })
    return (data ?? []).map((t: Record<string, unknown>) => ({
      executed_at: t.executed_at as string,
      type: t.type as FlatTransaction['type'],
      symbol: (t.position as { symbol: string }).symbol,
      quantity: t.quantity as number,
      price: t.price as number,
    }))
  }

  let transactions: FlatTransaction[] | null = null

  // ── 1D and 1W: the session itself ────────────────────────────────────────
  // Before the nightly-snapshot branch, which has one point per night and so
  // has nothing to say about a window measured in hours.
  if (INTRADAY_RANGE[range]) {
    transactions = await loadTransactions()
    const snapshots = computeDailyPositions(transactions)
    const symbols = symbolsHeldSince(snapshots, cutoffStr)

    if (symbols.length > 0) {
      const bars = await fetchIntradayBars(symbols, INTRADAY_RANGE[range])
      const opensAt = Object.values(bars).flat().reduce<string | null>(
        (earliest, bar) => (earliest === null || bar.time < earliest ? bar.time : earliest),
        null,
      )

      // The close of the session before the window, so a holding that has not
      // printed yet is worth what it was last worth rather than nothing.
      const lookback = new Date(`${(opensAt ?? new Date().toISOString()).slice(0, 10)}T00:00:00Z`)
      lookback.setUTCDate(lookback.getUTCDate() - PREVIOUS_CLOSE_LOOKBACK_DAYS)
      const { data: storedCloses } = await supabase
        .from('price_history')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .gte('date', lookback.toISOString().slice(0, 10))
        .lt('date', (opensAt ?? new Date().toISOString()).slice(0, 10))
        .order('date', { ascending: true })

      const previousCloses: Record<string, number> = {}
      for (const row of storedCloses ?? []) previousCloses[row.symbol] = Number(row.close)

      const transactionPrices: Record<string, number> = {}
      for (const txn of transactions) if (txn.price > 0) transactionPrices[txn.symbol] = txn.price

      const points = buildIntradayTimeline({ snapshots, bars, previousCloses, transactionPrices })
      if (points.length >= MIN_INTRADAY_POINTS) {
        // Short: these are the ranges that move while the reader is watching.
        await cacheSet(cacheKey, points, 60)
        return success(points)
      }
      // Too few bars to be a chart — the daily path below still covers the book.
    }
  }

  // PRIMARY SOURCE: Use portfolio_snapshots if available
  const { data: snapshotData } = await supabase
    .from('portfolio_snapshots')
    .select('portfolio_id, snapshot_date, total_value')
    .in('portfolio_id', portfolioIds)
    .gte('snapshot_date', cutoffStr)
    .order('snapshot_date', { ascending: true })

  if (snapshotData && snapshotsCoverWindow(snapshotData, portfolioIds, cutoffStr)) {
    // Aggregate across portfolios by date
    const dateValues: Record<string, number> = {}
    for (const snap of snapshotData) {
      dateValues[snap.snapshot_date] = (dateValues[snap.snapshot_date] || 0) + snap.total_value
    }

    const timeline = Object.entries(dateValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }))

    // Add benchmark overlay
    let benchmarkData: { dates: string[]; values: number[] } = { dates: [], values: [] }
    try {
      const { getBenchmarkSeries } = await import('@/lib/services/benchmarks')
      benchmarkData = await getBenchmarkSeries(supabase, 'SPY', cutoffStr, new Date().toISOString().split('T')[0])
    } catch (e) {
      console.warn('Benchmarks service not available, skipping benchmark overlay:', e)
    }

    // Normalize portfolio to start at 100 for comparison
    const startValue = timeline[0]?.value || 1
    const normalizedPortfolio = timeline.map((t) => ({
      date: t.date,
      value: t.value,
      normalized: (t.value / startValue) * 100,
    }))

    const result = {
      timeline: normalizedPortfolio,
      benchmark: benchmarkData,
      benchmarkSymbol: 'SPY',
      source: 'snapshots',
    }

    await cacheSet(cacheKey, result, range === 'max' || parseInt(range) > 30 ? 600 : 120)
    return success(result)
  }

  // FALLBACK: Reconstruct from transactions + price_history (existing code below)

  const flatTxns = transactions ?? (await loadTransactions())
  if (flatTxns.length === 0) return success([])

  const snapshots = computeDailyPositions(flatTxns)
  if (snapshots.length === 0) return success([])

  const symbols = [...new Set(flatTxns.map(t => t.symbol))]
  const yahooRange = RANGE_MAP[range] || '1mo'

  const historicalPrices: Record<string, Record<string, number>> = {}

  // Check cache in price_history table
  for (const symbol of symbols) {
    const { data: cached } = await supabase
      .from('price_history')
      .select('date, close')
      .eq('symbol', symbol)
      .gte('date', cutoffStr)
      .order('date', { ascending: true })

    if (cached && cached.length > 0) {
      const priceMap: Record<string, number> = {}
      for (const row of cached) {
        priceMap[row.date] = row.close
      }
      historicalPrices[symbol] = priceMap
    }
  }

  // Stored closes stop where the last provider call stopped; without this the
  // chart carried that close forward to today and the line went flat.
  const storedLast: Record<string, string> = {}
  for (const [symbol, priceMap] of Object.entries(historicalPrices)) {
    const dates = Object.keys(priceMap).sort()
    if (dates.length > 0) storedLast[symbol] = dates[dates.length - 1]
  }
  for (const row of await topUpStoredHistory(storedLast)) {
    historicalPrices[row.symbol][row.date] = row.close
  }

  // Fetch from Yahoo for uncached symbols
  const uncachedSymbols = symbols.filter(s => !historicalPrices[s] || Object.keys(historicalPrices[s]).length === 0)

  const chunks: string[][] = []
  for (let i = 0; i < uncachedSymbols.length; i += 5) {
    chunks.push(uncachedSymbols.slice(i, i + 5))
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        const history = await getHistory(symbol, yahooRange)
        const priceMap: Record<string, number> = {}
        const rowsToCache: Parameters<typeof writeThrough>[0] = []
        const settled = lastSettledSession()
        for (const point of history) {
          const date = new Date(point.date).toISOString().slice(0, 10)
          if (point.close != null) {
            priceMap[date] = point.close
            // Only finished sessions are stored, and through the service role:
            // the user's client is denied by RLS, so this write never landed.
            // A range that is not one bar per session is never stored at all.
            if (isDailyRange(yahooRange) && date <= settled) {
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
          }
        }

        await writeThrough(rowsToCache)

        return { symbol, priceMap }
      })
    )
    for (const { symbol, priceMap } of results) {
      historicalPrices[symbol] = priceMap
    }
  }

  // Build fallback prices from last transaction price per symbol
  const transactionPrices: Record<string, number> = {}
  for (const txn of flatTxns) {
    if (txn.price > 0) transactionPrices[txn.symbol] = txn.price
  }

  const today = new Date().toISOString().slice(0, 10)
  const timeline = buildDailyTimeline(snapshots, historicalPrices, today, transactionPrices)
  const filtered = timeline.filter(t => t.date >= cutoffStr)

  // Cache the computed result for 5 minutes
  await cacheSet(cacheKey, filtered, 300)

  return success(filtered)
}

export const GET = apiHandler(getHandler)
