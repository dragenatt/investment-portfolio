import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateSharpeRatio, calculateMaxDrawdown, calculateDailyReturns } from '@/lib/services/analytics'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { getHistory } from '@/lib/services/market'

type PriceRow = { symbol: string; date: string; close: number }

/**
 * Fetch price history from Supabase, falling back to Yahoo Finance
 * when the price_history table is empty or insufficient.
 */
async function fetchPriceHistory(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  symbols: string[]
): Promise<PriceRow[]> {
  // 1. Try Supabase price_history table first (fast, cached)
  const { data: dbHistory } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })
    .limit(2000)

  if (dbHistory && dbHistory.length >= 10) {
    return dbHistory
  }

  // 2. Fallback: fetch from Yahoo Finance for each symbol
  const allHistory: PriceRow[] = []
  const rowsToCache: Array<{
    symbol: string; exchange: string; date: string;
    open: number; high: number; low: number; close: number; volume: number
  }> = []

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const history = await getHistory(symbol, '1y')
        for (const point of history) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          allHistory.push({ symbol, date, close: point.close })
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
        // Skip symbols that fail to fetch
      }
    })
  )

  // 3. Cache fetched data in price_history for future use (fire and forget)
  if (rowsToCache.length > 0) {
    try {
      await supabase
        .from('price_history')
        .upsert(rowsToCache, { onConflict: 'symbol,exchange,date' })
    } catch {
      // Ignore cache write failures
    }
  }

  return allHistory.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Calculate Sortino ratio — like Sharpe but only penalizes downside volatility.
 */
function calculateSortinoRatio(returns: number[], riskFreeRate: number): number {
  if (returns.length < 2) return 0
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualizedReturn = meanReturn * 252
  const downsideReturns = returns.filter(r => r < 0)
  if (downsideReturns.length === 0) return annualizedReturn > 0 ? 3 : 0
  const downsideVariance = downsideReturns.reduce((a, b) => a + b * b, 0) / downsideReturns.length
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252)
  if (downsideDeviation === 0) return 0
  return (annualizedReturn - riskFreeRate) / downsideDeviation
}

/**
 * Calculate a composite risk score (0-10 scale).
 * Higher = more risky.
 */
function calculateRiskScore(volatility: number, maxDrawdown: number, sharpe: number): number {
  // Volatility contribution (0-4): >40% annual vol = max
  const volScore = Math.min(volatility / 10, 4)
  // Drawdown contribution (0-4): >40% max drawdown = max
  const ddScore = Math.min(maxDrawdown / 10, 4)
  // Sharpe penalty (0-2): negative Sharpe increases risk
  const sharpeScore = sharpe < 0 ? Math.min(Math.abs(sharpe), 2) : 0
  return Math.min(volScore + ddScore + sharpeScore, 10)
}

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
        return { message: 'No positions' }
      }

      // Get price history — tries DB first, falls back to Yahoo Finance
      const symbols = positions.map(p => p.symbol)
      const history = await fetchPriceHistory(supabase, symbols)

      if (history.length < 10) {
        return { message: 'No positions' }
      }

      // Also fetch benchmark (SPY) for beta/alpha calculations
      let benchmarkReturns: number[] = []
      try {
        const spyHistory = await fetchPriceHistory(supabase, ['SPY'])
        if (spyHistory.length >= 10) {
          const spyCloses = spyHistory
            .filter(h => h.symbol === 'SPY')
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(h => h.close)
          benchmarkReturns = calculateDailyReturns(spyCloses)
        }
      } catch { /* skip benchmark */ }

      // Calculate portfolio value per day
      const dateMap = new Map<string, number>()
      for (const h of history) {
        const pos = positions.find(p => p.symbol === h.symbol)
        if (!pos) continue
        const current = dateMap.get(h.date) || 0
        dateMap.set(h.date, current + pos.quantity * h.close)
      }

      const sortedEntries = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      const dates = sortedEntries.map(e => e[0])
      const values = sortedEntries.map(e => e[1])
      const returns = calculateDailyReturns(values)

      if (returns.length < 2) {
        return { message: 'No positions' }
      }

      // Use CETES 28-day rate as risk-free rate (approx 10% annual in MXN, ~5% USD)
      const riskFreeRate = 0.10
      const TRADING_DAYS = 252

      // Core metrics
      const volatility = calculateVolatility(returns) * 100
      const sharpe = calculateSharpeRatio(returns, riskFreeRate)
      const sortino = calculateSortinoRatio(returns, riskFreeRate)
      const maxDrawdown = calculateMaxDrawdown(values)

      // Find max drawdown date
      let maxDDDate = dates[0] || ''
      let peak = values[0]
      let worstDD = 0
      for (let i = 0; i < values.length; i++) {
        if (values[i] > peak) peak = values[i]
        const dd = peak > 0 ? ((peak - values[i]) / peak) * 100 : 0
        if (dd > worstDD) {
          worstDD = dd
          maxDDDate = dates[i]
        }
      }

      // Calmar Ratio
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length
      const cagr = Math.pow(1 + mean, TRADING_DAYS) - 1
      const calmar = maxDrawdown > 0 ? (cagr * 100) / maxDrawdown : 0

      // VaR 95%
      const sortedReturns = [...returns].sort((a, b) => a - b)
      const var95Index = Math.floor(returns.length * 0.05)
      const var95 = sortedReturns[var95Index] ? Math.abs(sortedReturns[var95Index]) * 100 : 0

      // Beta and Alpha (relative to SPY benchmark)
      let beta = 1
      let alpha = 0
      let trackingError = 0
      let informationRatio = 0

      if (benchmarkReturns.length >= 10) {
        // Align returns length (use the shorter of the two)
        const minLen = Math.min(returns.length, benchmarkReturns.length)
        const pReturns = returns.slice(-minLen)
        const bReturns = benchmarkReturns.slice(-minLen)

        // Beta = Cov(portfolio, benchmark) / Var(benchmark)
        const pMean = pReturns.reduce((a, b) => a + b, 0) / pReturns.length
        const bMean = bReturns.reduce((a, b) => a + b, 0) / bReturns.length
        let covariance = 0
        let benchVariance = 0
        for (let i = 0; i < minLen; i++) {
          covariance += (pReturns[i] - pMean) * (bReturns[i] - bMean)
          benchVariance += (bReturns[i] - bMean) ** 2
        }
        covariance /= minLen - 1
        benchVariance /= minLen - 1

        beta = benchVariance > 0 ? covariance / benchVariance : 1

        // Alpha = annualized(portfolio return - beta * benchmark return)
        const pAnnual = pMean * TRADING_DAYS * 100
        const bAnnual = bMean * TRADING_DAYS * 100
        alpha = pAnnual - beta * bAnnual

        // Tracking Error = std dev of excess returns, annualized
        const excessReturns = pReturns.map((r, i) => r - bReturns[i])
        const exMean = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length
        const exVar = excessReturns.reduce((a, b) => a + (b - exMean) ** 2, 0) / (excessReturns.length - 1)
        trackingError = Math.sqrt(exVar) * Math.sqrt(TRADING_DAYS) * 100

        // Information Ratio = alpha / tracking error
        informationRatio = trackingError > 0 ? alpha / trackingError : 0
      }

      // Composite risk score
      const riskScore = calculateRiskScore(volatility, maxDrawdown, sharpe)

      // Drawdown series for chart
      const drawdownValues = values.map((_, i) => {
        const pk = Math.max(...values.slice(0, i + 1))
        return pk > 0 ? -((pk - values[i]) / pk) * 100 : 0
      })

      return {
        current: {
          risk_score: Math.round(riskScore * 10) / 10,
          sharpe_ratio: Math.round(sharpe * 100) / 100,
          sortino_ratio: Math.round(sortino * 100) / 100,
          max_drawdown: Math.round(maxDrawdown * 100) / 100,
          max_drawdown_date: maxDDDate,
          volatility: Math.round(volatility * 100) / 100,
          beta: Math.round(beta * 100) / 100,
          alpha: Math.round(alpha * 100) / 100,
          calmar_ratio: Math.round(calmar * 100) / 100,
          var_95: Math.round(var95 * 100) / 100,
          tracking_error: Math.round(trackingError * 100) / 100,
          information_ratio: Math.round(informationRatio * 100) / 100,
        },
        drawdown_series: {
          dates,
          values: drawdownValues.map(v => Math.round(v * 100) / 100),
        },
        dataPoints: values.length,
      }
    }
  )
  return success(data)
}
