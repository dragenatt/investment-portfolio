import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { alignCommonHistory } from '@/lib/services/common-history'
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
import { compareBlackLittermanVsMarkowitz } from '@/lib/services/black-litterman'

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
export async function computeOptimization(supabase: SupabaseClient, pid: string, _params: Record<string, never>) {
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

  const symbols = (positions ?? []).map((p) => p.symbol)
  const { rows: history } =
    symbols.length >= 2
      ? await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })
      : { rows: [] }

  // Only holdings with a real price series, and only dates every one of
  // them has — see common-history.ts, shared with the scenario comparison.
  const aligned = alignCommonHistory(positions ?? [], history, {
    minObservations: MIN_OBSERVATIONS,
  })
  if ('message' in aligned) return { message: aligned.message }

  const { symbols: activeSymbols, commonDates, returnsMatrix, currentWeights, lastDate } = aligned

  const dailyCov = calculateCovarianceMatrix(returnsMatrix)
  const cov = dailyCov.map((row) => row.map((v) => v * TRADING_DAYS))
  const expected = historicalExpectedReturns(returnsMatrix)

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

  // ── Black-Litterman ────────────────────────────────────────────────
  //
  // The market portfolio here is the user's OWN current weights, not a true
  // market-cap index — this app does not have market caps for arbitrary
  // holdings. That substitution is real and is labelled: the equilibrium
  // returned is "what your current allocation implies you believe", which is
  // a genuinely useful thing to show someone and is NOT the textbook prior.
  //
  // With no views it returns those weights back unchanged, which is the
  // model's defining property and the reason it is safe to show by default.
  const blackLitterman =
    currentWeights && activeSymbols.length >= 2
      ? compareBlackLittermanVsMarkowitz(activeSymbols, cov, currentWeights, [], {
          riskFreeRate: riskFree.rate,
        })
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
    black_litterman: blackLitterman
      ? {
          ...blackLitterman,
          // Said plainly: the prior is the user's own book, not the market.
          equilibrium_basis:
            'Los rendimientos de equilibrio se derivan de TUS pesos actuales, no de una cartera de mercado por capitalizacion. Responden a "que tendrias que estar creyendo para que tu asignacion actual fuera optima", que es una pregunta util pero no es el prior clasico del modelo.',
        }
      : null,
    caveat: FRONTIER_CAVEAT,
  }
}
