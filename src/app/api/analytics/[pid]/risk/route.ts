import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateDailyReturns, calculateBetaAlpha, explainBenchmarkMetrics } from '@/lib/services/analytics'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata, combinePriceSources, COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { riskContributions, describeRiskConcentration } from '@/lib/services/risk-attribution'
import { analyseDrawdowns, recoveryProfile } from '@/lib/services/drawdown'
import { analyseTailRisk } from '@/lib/services/var'
import { principalComponents, describeIndependence } from '@/lib/services/pca'
import { rollingRiskSeries, detectStressPeriods } from '@/lib/services/rolling-metrics'
import { calculateSortinoRatio, detectCadence } from '@/lib/services/asset-metrics'
import { portfolioValueSeries } from '@/lib/services/portfolio-series'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'
import { closesInBase, todaysSymbolFactors } from '@/lib/services/book-valuation'


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

  const data = await withAuditedCache(
    `${CACHE_KEYS.ANALYTICS_RISK}${user.id}:${pid}`,
    300,
    async () => {
      // The portfolio's own currency decides which risk-free rate it has to beat.
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('currency:base_currency')
        .eq('id', pid)
        .single()

      // Beta and alpha are statements about a comparison, so which series they
      // compare against is part of the answer, not an implementation detail.
      const benchmarkSymbol = await getPortfolioBenchmark(supabase, pid)

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
      const { rows: quoted, source: priceSource } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })
      // The value series weights each holding by quantity × close, so the closes
      // go into the portfolio's currency first (today's rate): a mixed book's
      // series added pesos to dollars. Each holding's own return is unchanged.
      const fx = await todaysSymbolFactors(supabase, symbols, portfolio?.currency ?? 'USD')
      const history = closesInBase(quoted, fx.factors)

      if (history.length < 10) {
        return { message: 'No positions' }
      }

      let benchmarkReturns: number[] = []
      let benchmarkSource: typeof priceSource | null = null
      try {
        const { rows: benchmarkHistory, source: benchmarkTier } = await fetchAdjustedPriceHistory(supabase, [
          benchmarkSymbol,
        ])
        benchmarkSource = benchmarkTier
        if (benchmarkHistory.length >= 10) {
          const closes = benchmarkHistory
            .filter((h: PriceRow) => h.symbol === benchmarkSymbol)
            .sort((a: PriceRow, b: PriceRow) => a.date.localeCompare(b.date))
            .map((h: PriceRow) => h.close)
          benchmarkReturns = calculateDailyReturns(closes)
        }
      } catch { /* a missing benchmark leaves beta and alpha unreported */ }

      // Portfolio value per date, counting ONLY dates where every holding is
      // priced. Summing whatever happened to be present made the book appear to
      // lose a position for a day and get it back the next — two such dates in
      // a hundred and thirty reported a real 18% annual volatility as 178%.
      const series = portfolioValueSeries(history, positions)
      if (!series) {
        return { message: 'No positions' }
      }

      const { dates, values, droppedDates, excludedSymbols } = series
      const returns = calculateDailyReturns(values)

      if (returns.length < 2) {
        return { message: 'No positions' }
      }

      // Previously a flat 10% for every portfolio, which flattered dollar books
      // and punished peso ones. Now resolved per currency from the publishing
      // central bank or treasury, with the source reported alongside.
      const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')
      const riskFreeRate = riskFree.rate


      // How far apart the bars actually are. The provider does not always
      // return daily data, and annualising by 252 regardless is how this
      // endpoint rendered a portfolio at 224% volatility off WEEKLY bars while
      // calling a 30-week rolling window "30 days".
      const cadence =
        detectCadence(dates.map((date, i) => ({ date, close: values[i] }))) ?? {
          daysPerBar: 1,
          periodsPerYear: TRADING_DAYS,
          label: '1 dia',
        }
      const { periodsPerYear } = cadence

      // calculateVolatility and calculateSharpeRatio annualise by 252
      // internally. Rescaling converts without a second copy of the arithmetic.
      const annualScale = Math.sqrt(periodsPerYear / TRADING_DAYS)

      // Core metrics
      const volatility = calculateVolatility(returns) * annualScale * 100
      const meanPerBar = returns.reduce((a, b) => a + b, 0) / returns.length
      const annualisedReturn = meanPerBar * periodsPerYear
      const sharpe =
        volatility > 1e-8 ? (annualisedReturn - riskFreeRate) / (volatility / 100) : 0
      const sortino = calculateSortinoRatio(returns, riskFreeRate, periodsPerYear)
      // Drawdown as episodes rather than a single depth: the recovery is usually
      // what decides whether someone actually held on.
      const drawdowns = analyseDrawdowns(dates.map((date, i) => ({ date, value: values[i] })))
      const maxDrawdown = drawdowns.maxDrawdownPct
      const maxDDDate = drawdowns.worstEpisode?.troughDate ?? dates[0] ?? ''

      // Calmar Ratio
      const cagr = Math.pow(1 + meanPerBar, periodsPerYear) - 1
      const calmar = maxDrawdown > 0 ? (cagr * 100) / maxDrawdown : 0

      // Tail risk, four ways. One number labelled "VaR" invites a reader to
      // treat it as the answer; four that disagree invite the question of why,
      // which is the part worth learning. var95 keeps the historical figure so
      // the existing field means exactly what it always meant.
      const tailRisk = analyseTailRisk(returns, 95)
      const var95 = tailRisk?.historicalPct ?? 0

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
      const activeReturn = benchmarkStats?.activeReturn ?? 0

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
      // How many genuinely separate bets the book is running, next to the HHI it
      // is so often confused with. HHI answers "is the money spread out"; this
      // answers "is the risk spread out", and a book can pass one and fail the
      // other badly. Both are reported so neither can be read as the whole story.
      let independence = null
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
          // Per-bar covariance annualised to match the volatility reported
          // above — by the cadence, not by a constant.
          const perBarCov = calculateCovarianceMatrix(returnsMatrix)
          const cov = perBarCov.map((row) => row.map((v) => v * periodsPerYear))
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

          // Eigen-decomposition of the same covariance matrix. Annualising it
          // above scaled every entry by the same constant, and the variance
          // shares this reads are ratios, so the scaling cancels out.
          const pca = principalComponents(cov, priced.map((p) => p.symbol))
          if (pca) {
            const hhi = weights.reduce((sum, w) => sum + w * w, 0)
            independence = {
              holdings: priced.length,
              effective_bets: pca.effectiveBets,
              components_for_90pct: pca.componentsFor90Pct,
              // The weight-based measure, carried alongside on purpose: the
              // point of this block is the gap between the two.
              hhi,
              hhi_effective_holdings: hhi > 0 ? 1 / hhi : null,
              summary: describeIndependence(priced.length, pca.effectiveBets),
              components: pca.components.map((c) => ({
                index: c.index,
                variance_explained_pct: c.varianceExplainedPct,
                cumulative_pct: c.cumulativePct,
                loadings: c.loadings.map((l) => ({ symbol: l.symbol, loading: l.loading })),
              })),
            }
          }
        }
      }

      // Composite risk score
      const riskScore = calculateRiskScore(volatility, maxDrawdown, sharpe)

      // The single volatility number above is an average over the whole history,
      // which hides the thing that matters most: whether it is getting worse.
      // A quarter-long window is preferred; a month is the fallback for shorter
      // histories, and below that there is nothing honest to plot.
      //
      // `returns` has one fewer entry than `values`, so it lines up with
      // dates.slice(1) — the date each return was earned on.
      const returnDates = dates.slice(1)
      const MIN_ROLLING_POINTS = 20
      // Windows are expressed in BARS. A quarter is 63 daily bars but only 13
      // weekly ones, so the candidate list is scaled to the cadence rather than
      // hardcoded — otherwise "63" silently means fifteen months.
      const barsPerQuarter = Math.max(5, Math.round(periodsPerYear / 4))
      const barsPerMonth = Math.max(4, Math.round(periodsPerYear / 12))
      const rollingWindow = [barsPerQuarter, barsPerMonth].find(
        (w) => returns.length - w + 1 >= MIN_ROLLING_POINTS,
      )
      const rolling = rollingWindow
        ? rollingRiskSeries(returnDates, returns, {
            window: rollingWindow,
            riskFreeAnnual: riskFreeRate,
            periodsPerYear,
            // The benchmark trades on its own calendar. Passing a series that
            // does not line up would correlate the portfolio against the wrong
            // days, so it is only included when the two match exactly.
            benchmarkReturns:
              benchmarkReturns.length === returns.length ? benchmarkReturns : undefined,
          })
        : null

      // Drawdown series for chart
      const drawdownValues = values.map((_, i) => {
        const pk = Math.max(...values.slice(0, i + 1))
        return pk > 0 ? -((pk - values[i]) / pk) * 100 : 0
      })

      return {
        current: {
          risk_score: Math.round(riskScore * 10) / 10,
          sharpe_ratio: Math.round(sharpe * 100) / 100,
          // Null when the portfolio never had a down day: there is no downside
          // deviation to divide by, and the old code answered 3 or 0 instead.
          sortino_ratio: sortino === null ? null : Math.round(sortino * 100) / 100,
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
        independence,
        // The cadence travels with the payload: a "30" here means thirty BARS,
        // and only the cadence says whether that is six weeks or seven months.
        bar_cadence: cadence,
        // What had to be skipped to measure a consistent series, said out loud
        // rather than left as a silent difference between claim and data.
        coverage: {
          dates_used: dates.length,
          dates_dropped: droppedDates.length,
          excluded_symbols: excludedSymbols,
        },
        rolling_risk: rolling
          ? {
              window_bars: rolling.window,
              window_label: `${rolling.window} barras de ${cadence.label}`,
              observations_used: rolling.observationsUsed,
              benchmark_symbol:
                rolling.points.some((p) => p.correlation !== null) ? benchmarkSymbol : null,
              points: rolling.points.map((p) => ({
                date: p.date,
                volatility_pct: p.volatilityPct === null ? null : Math.round(p.volatilityPct * 100) / 100,
                sharpe: p.sharpe === null ? null : Math.round(p.sharpe * 100) / 100,
                correlation: p.correlation === null ? null : Math.round(p.correlation * 1000) / 1000,
              })),
              // Descriptive only: these are stretches where this portfolio's own
              // volatility ran far above its own normal. They say nothing about
              // what comes next.
              stress_periods: detectStressPeriods(rolling),
            }
          : null,
        tail_risk: tailRisk,
        recovery: recoveryProfile(drawdowns),
        benchmark: {
          symbol: benchmarkSymbol,
          name: BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol,
          currency: BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.currency ?? 'USD',
          // Beta, alpha, tracking error and information ratio are all measured
          // against this series and mean nothing without it.
          available: benchmarkReturns.length >= 10,
          active_return_pct: activeReturn,
          // Tracking error and the information ratio are the two metrics readers
          // most often misread, so they travel with their explanation.
          explanations: benchmarkStats
            ? explainBenchmarkMetrics(
                benchmarkStats,
                BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol,
              )
            : null,
        },
        dataPoints: values.length,
        _meta: buildResultMetadata({
          model: 'risk',
          data: {
            description: `Valor diario del portafolio con las cantidades actuales y precios de cierre${benchmarkReturns.length >= 10 ? ', e historial del benchmark' : ''}`,
            symbols: positions.map((p) => p.symbol).filter((s) => !excludedSymbols.includes(s)),
            excluded: excludedSymbols,
            priceSource: combinePriceSources(priceSource, benchmarkReturns.length >= 10 ? benchmarkSource : null),
          },
          period: { from: dates[0], to: dates[dates.length - 1], observations: returns.length, cadence: cadence.label },
          assumptions: [
            COMMON_ASSUMPTIONS.tradingDays,
            COMMON_ASSUMPTIONS.splitAdjusted,
            COMMON_ASSUMPTIONS.priceReturn,
            COMMON_ASSUMPTIONS.baseCurrencyToday(fx.base),
            { name: 'VaR', value: '95%, un día; histórico, paramétrico, Cornish-Fisher y CVaR', source: 'var.ts' },
            { name: 'Alfa de esta vista', value: 'Rendimiento activo simple (tasa libre en cero para beta y alfa)', source: 'Convención de la ruta de riesgo' },
            { name: 'Puntaje de riesgo', value: 'Volatilidad, caída máxima y Sharpe negativo, escala 0-10', source: 'Convención (risk route)' },
          ],
          benchmark: { symbol: benchmarkSymbol, name: BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol },
          riskFreeRate: riskFree,
        }),
      }
    }
  )
  return success(data)
}
