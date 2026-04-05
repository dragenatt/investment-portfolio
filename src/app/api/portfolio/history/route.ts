import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { cacheGet, cacheSet } from '@/lib/cache/redis'
import { getHistory } from '@/lib/services/market'
import { computeDailyPositions, buildDailyTimeline } from '@/lib/services/portfolio-history'

const RANGE_MAP: Record<string, string> = {
  '1': '1d',
  '7': '5d',
  '30': '1mo',
  '90': '3mo',
  '365': '1y',
  'max': 'max',
}

export async function GET(req: Request) {
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

  // PRIMARY SOURCE: Use portfolio_snapshots if available
  const { data: snapshotData } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value')
    .in('portfolio_id', portfolioIds)
    .gte('snapshot_date', cutoffStr)
    .order('snapshot_date', { ascending: true })

  if (snapshotData && snapshotData.length >= 7) {
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

  const { data: transactions } = await supabase
    .from('transactions')
    .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id, symbol)')
    .in('position.portfolio_id', portfolioIds)
    .order('executed_at', { ascending: true })

  if (!transactions || transactions.length === 0) return success([])

  const flatTxns = transactions.map((t: Record<string, unknown>) => {
    const position = t.position as { symbol: string }
    return {
      executed_at: t.executed_at as string,
      type: t.type as 'buy' | 'sell' | 'dividend' | 'split',
      symbol: position.symbol,
      quantity: t.quantity as number,
      price: t.price as number,
    }
  })

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
        const rowsToCache: Array<{ symbol: string; exchange: string; date: string; open: number; high: number; low: number; close: number; volume: number }> = []
        for (const point of history) {
          const date = new Date(point.date).toISOString().slice(0, 10)
          if (point.close != null) {
            priceMap[date] = point.close
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

        if (rowsToCache.length > 0) {
          await supabase.from('price_history').upsert(rowsToCache, { onConflict: 'symbol,exchange,date' }).select()
        }

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
