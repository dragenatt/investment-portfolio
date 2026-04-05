import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateSharpeRatio, calculateMaxDrawdown, calculateDailyReturns } from '@/lib/services/analytics'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_RISK}${pid}`,
    300,
    async () => {
      // Get portfolio positions
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) {
        return { volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'No positions' }
      }

      // Get price history for portfolio value calculation
      const symbols = positions.map(p => p.symbol)
      const { data: history } = await supabase
        .from('price_history')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .order('date', { ascending: true })
        .limit(365)

      if (!history || history.length < 10) {
        return { volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'Insufficient price history' }
      }

      // Calculate portfolio value per day
      const dateMap = new Map<string, number>()
      for (const h of history) {
        const pos = positions.find(p => p.symbol === h.symbol)
        if (!pos) continue
        const current = dateMap.get(h.date) || 0
        dateMap.set(h.date, current + pos.quantity * h.close)
      }

      const values = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1])
      const returns = calculateDailyReturns(values)

      // Use CETES 28-day rate as risk-free rate (approx 10% annual in MXN, ~5% USD)
      const riskFreeRate = 0.10

      const TRADING_DAYS = 252
      const maxDrawdown = calculateMaxDrawdown(values)
      const totalValue = values[values.length - 1] ?? 0

      // Calmar Ratio
      const mean = returns.length > 0
        ? returns.reduce((a, b) => a + b, 0) / returns.length
        : 0
      const cagr = returns.length > 0
        ? (Math.pow(1 + mean, TRADING_DAYS) - 1)
        : 0
      const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : 0

      // VaR 95%
      const sortedReturns = [...returns].sort((a, b) => a - b)
      const var95Index = Math.floor(returns.length * 0.05)
      const var95 = sortedReturns[var95Index] ? Math.abs(sortedReturns[var95Index]) * totalValue : 0

      // Drawdown series
      const drawdownSeries = values.map((_, i) => {
        const peak = Math.max(...values.slice(0, i + 1))
        return peak > 0 ? -((peak - values[i]) / peak) * 100 : 0
      })

      return {
        volatility: calculateVolatility(returns) * 100,
        sharpe: calculateSharpeRatio(returns, riskFreeRate),
        maxDrawdown,
        calmar,
        var95,
        drawdownSeries,
        dataPoints: values.length,
      }
    }
  )
  return success(data)
}
