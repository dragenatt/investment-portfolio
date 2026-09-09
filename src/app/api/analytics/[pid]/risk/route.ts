import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateSharpeRatio, calculateDailyReturns, calculateBetaAlpha } from '@/lib/services/analytics'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { riskContributions, describeRiskConcentration } from '@/lib/services/risk-attribution'
import { analyseDrawdowns } from '@/lib/services/drawdown'


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
      // The portfolio's own currency decides which risk-free rate it has to beat.
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('currency')
        .eq('id', pid)
        .single()

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
      const { rows: history } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })

      if (history.length < 10) {
        return { message: 'No positions' }
      }

      // Also fetch benchmark (SPY) for beta/alpha calculations
      let benchmarkReturns: number[] = []
      try {
        const { rows: spyHistory } = await fetchAdjustedPriceHistory(supabase, ['SPY'])
        if (spyHistory.length >= 10) {
          const spyCloses = spyHistory
            .filter((h: PriceRow) => h.symbol === 'SPY')
            .sort((a: PriceRow, b: PriceRow) => a.date.localeCompare(b.date))
            .map((h: PriceRow) => h.close)
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

      // Previously a flat 10% for every portfolio, which flattered dollar books
      // and punished peso ones. Now resolved per currency from the publishing
      // central bank or treasury, with the source reported alongside.
      const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')
      const riskFreeRate = riskFree.rate
      const TRADING_DAYS = 252

      // Core metrics
      const volatility = calculateVolatility(returns) * 100
      const sharpe = calculateSharpeRatio(returns, riskFreeRate)
      const sortino = calculateSortinoRatio(returns, riskFreeRate)
      // Drawdown as episodes rather than a single depth: the recovery is usually
      // what decides whether someone actually held on.
      const drawdowns = analyseDrawdowns(dates.map((date, i) => ({ date, value: values[i] })))
      const maxDrawdown = drawdowns.maxDrawdownPct
      const maxDDDate = drawdowns.worstEpisode?.troughDate ?? dates[0] ?? ''

      // Calmar Ratio
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length
      const cagr = Math.pow(1 + mean, TRADING_DAYS) - 1
      const calmar = maxDrawdown > 0 ? (cagr * 100) / maxDrawdown : 0

      // VaR 95%
      const sortedReturns = [...returns].sort((a, b) => a - b)
      const var95Index = Math.floor(returns.length * 0.05)
      const var95 = sortedReturns[var95Index] ? Math.abs(sortedReturns[var95Index]) * 100 : 0

      // Beta and Alpha (relative to SPY benchmark).
      // The risk-free rate is passed as 0 on purpose: this endpoint has always
      // reported the plain excess-return alpha (Rp - beta*Rm), and Jensen's alpha
      // reduces to exactly that when the risk-free rate is zero. Snapshots pass
      // the real rate because it stores Jensen's alpha.
      const benchmarkStats = calculateBetaAlpha(returns, benchmarkReturns, 0)
      const beta = benchmarkStats?.beta ?? 1
      const alpha = benchmarkStats?.alpha ?? 0
      const trackingError = benchmarkStats?.trackingError ?? 0
      const informationRatio = benchmarkStats?.informationRatio ?? 0

      // Where the risk actually sits. Weight says how much money is in a holding;
      // it says nothing about how much of the book's volatility that holding
      // produces, and the two come apart whenever volatilities differ.
      const bySymbol = new Map<string, Map<string, number>>()
      for (const row of history) {
        let dateCloses = bySymbol.get(row.symbol)
        if (!dateCloses) {
          dateCloses = new Map<string, number>()
          bySymbol.set(row.symbol, dateCloses)
        }
        dateCloses.set(row.date, row.close)
      }

      const priced = positions.filter((p) => (bySymbol.get(p.symbol)?.size ?? 0) >= 3)
      const commonDates = dates.filter((d) =>
        priced.every((p) => bySymbol.get(p.symbol)!.has(d)),
      )

      let riskAttribution = null
      if (priced.length > 0 && commonDates.length >= 3) {
        const lastDate = commonDates[commonDates.length - 1]
        const marketValues = priced.map(
          (p) => p.quantity * (bySymbol.get(p.symbol)!.get(lastDate) ?? 0),
        )
        const bookValue = marketValues.reduce((a, b) => a + b, 0)

        if (bookValue > 0) {
          const weights = marketValues.map((v) => v / bookValue)
          const returnsMatrix = priced.map((p) =>
            calculateDailyReturns(commonDates.map((d) => bySymbol.get(p.symbol)!.get(d)!)),
          )
          // Daily covariance annualised to match the volatility reported above.
          const dailyCov = calculateCovarianceMatrix(returnsMatrix)
          const cov = dailyCov.map((row) => row.map((v) => v * TRADING_DAYS))
          const attribution = riskContributions(
            priced.map((p) => p.symbol),
            weights,
            cov,
          )

          if (attribution) {
            riskAttribution = {
              portfolio_volatility_pct: attribution.portfolioVolatility * 100,
              undiversified_volatility_pct: attribution.undiversifiedVolatility * 100,
              diversification_benefit_pct: attribution.diversificationBenefit * 100,
              diversification_ratio: attribution.diversificationRatio,
              summary: describeRiskConcentration(attribution.contributions),
              contributions: attribution.contributions.map((c) => ({
                symbol: c.symbol,
                weight_pct: c.weight * 100,
                volatility_pct: c.volatility * 100,
                percent_of_risk: c.percentOfRisk,
              })),
            }
          }
        }
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
        risk_free_rate: {
          currency: riskFree.currency,
          annual_pct: Math.round(riskFree.rate * 10000) / 100,
          source: riskFree.source,
          as_of: riskFree.asOf,
          is_fallback: riskFree.isFallback,
        },
        drawdown_series: {
          dates,
          values: drawdownValues.map(v => Math.round(v * 100) / 100),
        },
        drawdown_analysis: {
          max_pct: drawdowns.maxDrawdownPct,
          current_pct: drawdowns.currentDrawdownPct,
          recovery_required_pct: drawdowns.recoveryRequiredPct,
          average_pct: drawdowns.averageDrawdownPct,
          longest_recovery_days: drawdowns.longestRecoveryDays,
          episodes: drawdowns.episodes,
          underwater: drawdowns.underwater,
        },
        risk_attribution: riskAttribution,
        dataPoints: values.length,
      }
    }
  )
  return success(data)
}
