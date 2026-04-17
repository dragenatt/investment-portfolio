import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { calculateSimpleReturn, calculateTWR, calculateMWR } from '@/lib/services/returns'
import { getHistory } from '@/lib/services/market'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1Y'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_RETURNS}${pid}:${period}`,
    600,
    async () => {
      const cutoff = getPeriodCutoff(period)

      // Try snapshots first
      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('portfolio_id', pid)
        .gte('snapshot_date', cutoff)
        .order('snapshot_date', { ascending: true })

      // Get transactions for TWR/MWR
      const { data: transactions } = await supabase
        .from('transactions')
        .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id, symbol)')
        .eq('position.portfolio_id', pid)
        .gte('executed_at', cutoff)
        .order('executed_at', { ascending: true })

      let snaps = (snapshots ?? []).map((s) => ({ date: s.snapshot_date, value: s.total_value }))

      // FALLBACK: If no snapshots, build from positions + Yahoo price history
      if (snaps.length < 2) {
        const { data: positions } = await supabase
          .from('positions')
          .select('symbol, quantity, avg_cost')
          .eq('portfolio_id', pid)
          .gt('quantity', 0)

        if (positions && positions.length > 0) {
          const symbols = positions.map(p => p.symbol)
          const priceMap: Record<string, Record<string, number>> = {}

          await Promise.all(
            symbols.map(async (symbol) => {
              try {
                // Try DB first
                const { data: cached } = await supabase
                  .from('price_history')
                  .select('date, close')
                  .eq('symbol', symbol)
                  .gte('date', cutoff)
                  .order('date', { ascending: true })

                if (cached && cached.length >= 5) {
                  priceMap[symbol] = {}
                  for (const row of cached) priceMap[symbol][row.date] = row.close
                  return
                }

                // Fallback to Yahoo
                const range = periodToRange(period)
                const history = await getHistory(symbol, range)
                priceMap[symbol] = {}
                for (const point of history) {
                  if (point.close == null) continue
                  const date = new Date(point.date).toISOString().slice(0, 10)
                  if (date >= cutoff) priceMap[symbol][date] = point.close
                }
              } catch { /* skip */ }
            })
          )

          // Build daily portfolio values from price history
          const allDates = new Set<string>()
          for (const sym of symbols) {
            for (const date of Object.keys(priceMap[sym] || {})) {
              allDates.add(date)
            }
          }

          const sortedDates = [...allDates].sort()
          const lastPrices: Record<string, number> = {}

          for (const date of sortedDates) {
            let totalValue = 0
            for (const pos of positions) {
              const price = priceMap[pos.symbol]?.[date]
              if (price != null) lastPrices[pos.symbol] = price
              const currentPrice = lastPrices[pos.symbol] ?? pos.avg_cost
              totalValue += pos.quantity * currentPrice
            }
            snaps.push({ date, value: totalValue })
          }
        }
      }

      const lastSnap = snaps[snaps.length - 1]
      const firstSnap = snaps[0]

      // Calculate total cost from positions
      const { data: positionsForCost } = await supabase
        .from('positions')
        .select('quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      const totalCost = (positionsForCost ?? []).reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)

      // Simple return
      const simple = lastSnap
        ? calculateSimpleReturn(lastSnap.value, totalCost)
        : 0

      // TWR
      const cashFlows = (transactions ?? [])
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: (t.executed_at as string).split('T')[0],
          amount: t.type === 'buy' ? -(t.quantity as number) * (t.price as number) : (t.quantity as number) * (t.price as number),
        }))

      const twr = calculateTWR(snaps, cashFlows)
      const mwr = lastSnap
        ? calculateMWR(cashFlows, lastSnap.value, new Date())
        : 0

      // Calendar returns (monthly)
      const calendar = buildCalendarReturns(snaps)

      return { summary: { simple, twr, mwr, period }, calendar, periods: [] }
    }
  )

  return success(data)
}

function getPeriodCutoff(period: string): string {
  const now = new Date()
  switch (period) {
    case '1M': now.setMonth(now.getMonth() - 1); break
    case '3M': now.setMonth(now.getMonth() - 3); break
    case '6M': now.setMonth(now.getMonth() - 6); break
    case 'YTD': now.setMonth(0); now.setDate(1); break
    case '1Y': now.setFullYear(now.getFullYear() - 1); break
    case 'ALL': now.setFullYear(2020); break
    default: now.setFullYear(now.getFullYear() - 1)
  }
  return now.toISOString().split('T')[0]
}

function periodToRange(period: string): string {
  switch (period) {
    case '1M': return '1mo'
    case '3M': return '3mo'
    case '6M': return '6mo'
    case 'YTD': return '1y'
    case '1Y': return '1y'
    case 'ALL': return 'max'
    default: return '1y'
  }
}

function buildCalendarReturns(snapshots: Array<{ date: string; value: number }>) {
  if (snapshots.length < 2) return []

  const monthly: Record<string, { start: number; end: number }> = {}
  for (const snap of snapshots) {
    const month = snap.date.slice(0, 7) // YYYY-MM
    if (!monthly[month]) monthly[month] = { start: snap.value, end: snap.value }
    monthly[month].end = snap.value
  }

  const years: Record<number, (number | null)[]> = {}
  for (const [month, data] of Object.entries(monthly)) {
    const [yearStr, monthStr] = month.split('-')
    const year = parseInt(yearStr)
    const monthIdx = parseInt(monthStr) - 1
    if (!years[year]) years[year] = new Array(12).fill(null)
    years[year][monthIdx] = data.start > 0 ? ((data.end - data.start) / data.start) * 100 : 0
  }

  return Object.entries(years).map(([year, months]) => ({
    year: parseInt(year),
    months,
    total: months.reduce((sum: number, m) => sum + (m ?? 0), 0),
  }))
}
