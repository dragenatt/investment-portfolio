import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { calculateDailyReturns } from '@/lib/services/analytics'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import {
  efficientFrontier,
  historicalExpectedReturns,
  FRONTIER_CAVEAT,
} from '@/lib/services/optimizer'
import { compareAllocationStrategies } from '@/lib/services/allocation-strategies'
import {
  compareRobustVsClassic,
  weightSensitivity,
  type ReturnRange,
} from '@/lib/services/robust-optimizer'

const TRADING_DAYS = 252

/** Below this there is not enough history for a covariance worth optimising against. */
const MIN_OBSERVATIONS = 60

/**
 * What the same holdings would look like allocated differently.
 *
 * Deliberately NOT called "recommendations". Every number here is conditional on
 * expected returns estimated from the past, which is the weakest input in
 * finance, and the response says so twice — once in the frontier's caveat and
 * once in the strategy comparison's. Four strategies are returned rather than
 * one winner, because a single "optimal" allocation invites copying and four
 * that disagree invite the question of what each one optimises.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `analytics:optimization:${pid}`,
    900,
    async () => {
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('currency')
        .eq('id', pid)
        .single()

      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      // One holding has no allocation problem to solve.
      if (!positions || positions.length < 2) {
        return { message: 'Se necesitan al menos dos posiciones para comparar asignaciones.' }
      }

      const symbols = positions.map((p) => p.symbol)
      const { rows: history } = await fetchAdjustedPriceHistory(supabase, symbols, {
        limit: undefined,
      })

      const bySymbol = new Map<string, Map<string, number>>()
      for (const row of history) {
        let closes = bySymbol.get(row.symbol)
        if (!closes) {
          closes = new Map<string, number>()
          bySymbol.set(row.symbol, closes)
        }
        closes.set(row.date, row.close)
      }

      // Only holdings with a real price series, and only dates every one of them
      // has. Optimising across assets with different histories would compare
      // their behaviour on days some of them were not being observed.
      const priced = positions.filter((p) => (bySymbol.get(p.symbol)?.size ?? 0) > 0)
      if (priced.length < 2) {
        return { message: 'No hay suficiente historial de precios para estas posiciones.' }
      }

      const allDates = [...new Set(history.map((h) => h.date))].sort()
      const commonDates = allDates.filter((d) =>
        priced.every((p) => bySymbol.get(p.symbol)!.has(d)),
      )

      if (commonDates.length < MIN_OBSERVATIONS + 1) {
        return {
          message: `Se necesitan al menos ${MIN_OBSERVATIONS} dias de historial comun; hay ${Math.max(0, commonDates.length - 1)}.`,
        }
      }

      const activeSymbols = priced.map((p) => p.symbol)
      const returnsMatrix = priced.map((p) =>
        calculateDailyReturns(commonDates.map((d) => bySymbol.get(p.symbol)!.get(d)!)),
      )

      const dailyCov = calculateCovarianceMatrix(returnsMatrix)
      const cov = dailyCov.map((row) => row.map((v) => v * TRADING_DAYS))
      const expected = historicalExpectedReturns(returnsMatrix)

      // The book as it actually stands, valued at the last common date.
      const lastDate = commonDates[commonDates.length - 1]
      const marketValues = priced.map(
        (p) => p.quantity * (bySymbol.get(p.symbol)!.get(lastDate) ?? 0),
      )
      const bookValue = marketValues.reduce((a, b) => a + b, 0)
      const currentWeights =
        bookValue > 0 ? marketValues.map((v) => v / bookValue) : undefined

      const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')

      const frontier = expected
        ? efficientFrontier(activeSymbols, cov, expected, {
            riskFreeRate: riskFree.rate,
            currentWeights,
          })
        : null

      const strategies = compareAllocationStrategies(activeSymbols, returnsMatrix, 95)

      // ── How wide is each estimate, really ──────────────────────────────
      //
      // The roadmap asks for ranges instead of point estimates ("AAPL: 8%-12%")
      // and the temptation is to invent a width — plus or minus two points,
      // say. That would be a number with no source, which is the thing the
      // roadmap forbids everywhere else.
      //
      // So the width comes from the data: the standard error of an annualised
      // mean estimated from n observations is sigma / sqrt(years). It is the
      // honest measure of how little the history pins the mean down, and it is
      // usually shockingly large — which is the lesson, not a defect.
      const years = (commonDates.length - 1) / TRADING_DAYS
      const ranges: ReturnRange[] | null =
        expected && years > 0
          ? activeSymbols.map((symbol, i) => {
              const annualVol = Math.sqrt(Math.max(0, cov[i][i]))
              const standardError = annualVol / Math.sqrt(years)
              return {
                symbol,
                low: expected[i] - standardError,
                high: expected[i] + standardError,
              }
            })
          : null

      const robust =
        ranges && activeSymbols.length >= 2
          ? compareRobustVsClassic(activeSymbols, cov, ranges, {
              riskFreeRate: riskFree.rate,
            })
          : null

      const sensitivity =
        ranges && activeSymbols.length >= 2
          ? weightSensitivity(activeSymbols, cov, ranges, { riskFreeRate: riskFree.rate })
          : null

      return {
        symbols: activeSymbols,
        observations: commonDates.length - 1,
        from_date: commonDates[0],
        to_date: lastDate,
        risk_free_rate: {
          currency: riskFree.currency,
          annual_pct: Math.round(riskFree.rate * 10000) / 100,
          source: riskFree.source,
          as_of: riskFree.asOf,
          is_fallback: riskFree.isFallback,
        },
        // Labelled `estimated_` rather than `expected_` everywhere it appears,
        // so nothing downstream can render it as an observed fact.
        estimated_returns: expected
          ? activeSymbols.map((symbol, i) => ({
              symbol,
              annual_pct: expected[i] * 100,
              basis: 'media historica anualizada',
            }))
          : null,
        efficient_frontier: frontier,
        // Neither of these needs a forecast, which is the reason they are worth
        // showing next to a frontier that does.
        allocation_strategies: strategies,
        // What the estimates are worth, and what the optimiser does once that
        // is admitted. The width is one standard error either side of the mean
        // — roughly a 68% interval — computed from the data, not chosen.
        return_ranges: ranges
          ? ranges.map((r) => ({
              symbol: r.symbol,
              low_pct: r.low * 100,
              high_pct: r.high * 100,
              width_pp: (r.high - r.low) * 100,
              basis: 'media historica +/- 1 error estandar (intervalo ~68%)',
            }))
          : null,
        robust_optimization: robust,
        weight_sensitivity: sensitivity,
        caveat: FRONTIER_CAVEAT,
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
