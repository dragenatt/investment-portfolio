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
import { compareBlackLittermanVsMarkowitz, impliedEquilibriumReturns, viewsFromInputs, type ViewInput } from '@/lib/services/black-litterman'
import { compareModels } from '@/lib/services/model-comparison'
import { buildResultMetadata, COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'
import { resolveConstraints, type WeightConstraints } from '@/lib/services/weight-constraints'
import { UNKNOWN_SECTOR } from '@/lib/services/allocation-breakdown'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'


/** Below this there is not enough history for a covariance worth optimising against. */
const MIN_OBSERVATIONS = 60

/**
 * Limits the caller may put on the frontier (P1-31).
 *
 * All optional. With none of them the curve is long-only and fully invested and
 * nothing else, which is what it always was — so an existing caller sees exactly
 * the same numbers as before.
 */
export type OptimizationParams = {
  minWeight?: number
  maxWeight?: number
  /** Largest share a sector may take, keyed by the sector names in company_data. */
  sectorCaps?: Record<string, number>
  /**
   * Smallest annual expected return the minimum-CVaR book may have (P1-32).
   *
   * A fraction, on the same annualised basis as `estimated_returns`. Without it
   * "minimise expected shortfall" has one answer — the calmest holdings — and
   * the trade-off the task is about never appears.
   */
  minReturn?: number
  /**
   * The user's opinions for Black-Litterman (4.7). Only the synchronous route
   * passes them: job params are numbers, and an opinion is not one.
   */
  views?: ViewInput[]
}

/** Why the request produced no curve, in words a reader can act on. */
const INFEASIBLE_MESSAGES: Record<string, string> = {
  'min-weight-exceeds-one': 'El peso minimo pedido no cabe: multiplicado por el numero de posiciones pasa del 100%.',
  'max-weight-below-one': 'El peso maximo pedido no alcanza: aun con todas las posiciones en su tope no se llega al 100%.',
  'bounds-crossed': 'El peso minimo pedido es mayor que el maximo.',
  'sector-cap-below-its-minimums': 'Un tope sectorial es menor que lo que el peso minimo ya obliga a poner en ese sector.',
  'sector-caps-cannot-reach-one': 'Los topes sectoriales sumados no permiten una cartera totalmente invertida.',
  'min-return-unreachable': 'El rendimiento minimo pedido esta por encima de lo que cualquier cartera con estas posiciones y estos limites puede estimar.',
}

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
export async function computeOptimization(supabase: SupabaseClient, pid: string, params: OptimizationParams = {}) {
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('currency:base_currency')
    .eq('id', pid)
    .single()

  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  const symbols = (positions ?? []).map((p) => p.symbol)
  const { rows: history, source: priceSource } =
    symbols.length >= 2
      ? await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })
      : { rows: [], source: 'none' as const }

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

  // Sector labels only matter when a sector cap was actually asked for; without
  // one there is nothing to look up and no query to make.
  const wantsSectorCaps = Object.keys(params.sectorCaps ?? {}).length > 0
  let sectors: string[] | undefined
  if (wantsSectorCaps) {
    const { data: companies } = await supabase
      .from('company_data')
      .select('symbol, sector')
      .in('symbol', activeSymbols)
    const bySymbol = new Map((companies ?? []).map((c) => [c.symbol as string, (c.sector as string | null) ?? UNKNOWN_SECTOR]))
    sectors = activeSymbols.map((symbol) => bySymbol.get(symbol) ?? UNKNOWN_SECTOR)
  }

  const requested: WeightConstraints = {
    minWeight: params.minWeight,
    maxWeight: params.maxWeight,
    sectors,
    sectorCaps: params.sectorCaps,
    minReturn: params.minReturn,
    // The floor is compared against the same annualised estimates the frontier
    // optimises on, so the units a reader sees and the units it binds on match.
    expectedReturns: expected ?? undefined,
  }

  // Say so rather than quietly dropping them: weights that violate what the
  // caller asked for are worse than no weights at all.
  const resolution = resolveConstraints(activeSymbols.length, requested)
  if (!resolution.ok) {
    return { message: INFEASIBLE_MESSAGES[resolution.reason] ?? 'Las restricciones pedidas no describen ninguna cartera.' }
  }

  const frontier = expected
    ? efficientFrontier(activeSymbols, cov, expected, {
        riskFreeRate: riskFree.rate,
        currentWeights,
        constraints: requested,
      })
    : null

  // The minimum-CVaR row honours the same limits the frontier does. The other
  // three are fixed recipes with no freedom to constrain: equal weight, inverse
  // volatility and risk parity are what they are.
  const strategies = compareAllocationStrategies(activeSymbols, returnsMatrix, 95, resolution.constraints)

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
  const equilibrium = currentWeights ? impliedEquilibriumReturns(cov, currentWeights) : null
  const blackLitterman =
    currentWeights && equilibrium && activeSymbols.length >= 2
      ? compareBlackLittermanVsMarkowitz(
          activeSymbols,
          cov,
          currentWeights,
          viewsFromInputs(params.views ?? [], activeSymbols, equilibrium).views,
          { riskFreeRate: riskFree.rate },
        )
      : null

  // ── The five models on one ruler (P2-6) ──────────────────────────────
  //
  // Same holdings, same window, same estimates and ranges as everything above,
  // each model's weights measured the same way. No winner is picked.
  const modelComparison = expected
    ? compareModels({
        symbols: activeSymbols,
        returnsMatrix,
        cov,
        estimatedReturns: expected,
        riskFreeRate: riskFree.rate,
        currentWeights,
        ranges,
        views: params.views ?? null,
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
    // What the curve was actually constrained to, so a reader is never left
    // guessing whether a limit they asked for was applied. Null means the
    // frontier is long-only and fully invested and nothing more.
    constraints: resolution.constraints.trivial
      ? null
      : {
          min_weight_pct: (params.minWeight ?? 0) * 100,
          max_weight_pct: (params.maxWeight ?? 1) * 100,
          sector_caps: Object.entries(params.sectorCaps ?? {}).map(([sector, cap]) => ({
            sector,
            cap_pct: cap * 100,
            symbols: activeSymbols.filter((_, i) => sectors?.[i] === sector),
          })),
          // Applies to the minimum-CVaR allocation; the frontier already spans
          // every return level by construction.
          min_return_pct: params.minReturn === undefined ? null : params.minReturn * 100,
        },
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
            'Los rendimientos de equilibrio se derivan de TUS pesos actuales, no de una cartera de mercado por capitalización. Responden a "qué tendrías que estar creyendo para que tu asignación actual fuera óptima", que es una pregunta útil pero no es el prior clásico del modelo.',
        }
      : null,
    model_comparison: modelComparison,
    caveat: FRONTIER_CAVEAT,
    _meta: buildResultMetadata({
      model: 'optimization',
      data: { description: 'Rendimientos diarios de las posiciones en sus fechas comunes, pesos al último cierre común', symbols: activeSymbols, excluded: symbols.filter((s) => !activeSymbols.includes(s)), priceSource },
      period: { from: commonDates[0], to: lastDate, observations: commonDates.length - 1, cadence: '1 dia' },
      assumptions: [
        COMMON_ASSUMPTIONS.tradingDays,
        COMMON_ASSUMPTIONS.splitAdjusted,
        { name: 'Rendimientos esperados', value: 'Media histórica anualizada', source: 'optimizer.ts (historicalExpectedReturns)' },
        { name: 'Rangos de rendimiento', value: '±1 error estándar de la media', source: 'optimization job' },
        { name: 'Restricciones', value: 'Solo largos, 100% invertido', source: 'optimizer.ts' },
        { name: 'Equilibrio de Black-Litterman', value: 'Implícito en tus pesos actuales, aversión al riesgo 2.5, tau 0.05', source: 'black-litterman.ts' },
        { name: 'CVaR', value: '95%, un día, histórico', source: 'allocation-strategies.ts' },
      ],
      riskFreeRate: riskFree,
    }),
  }
}
