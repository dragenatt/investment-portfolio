// Scenario comparison (E2) — pure functions, no I/O.
//
// Two or more allocations of the same holdings, run through the SAME simulated
// futures, measured on the same seven things, and each one explained against
// the baseline in the user's own numbers.
//
// "The same futures" is the whole point. If each allocation were simulated with
// its own random draws, a difference in drawdown would be part allocation and
// part luck, with no way to say which part. simulateWeightings draws the asset
// shocks once and values every allocation on them, so any gap that appears here
// comes from the weights and nothing else.
//
// Every engine used is one that already exists: GBM paths from monte-carlo.ts,
// the annualised covariance and expected returns the optimizer uses, portfolio
// volatility and risk contributions from risk-attribution.ts, max drawdown from
// analytics.ts. Nothing here is a second implementation of any of them.

import { calculateCovarianceMatrix } from './covariance'
import { calculateMaxDrawdown } from './analytics'
import { gbmInputsFromHistory, simulateWeightings, percentile } from './monte-carlo'
import { historicalExpectedReturns } from './optimizer'
import { portfolioVolatility, riskContributions } from './risk-attribution'
import { validateWeights, validateProbability } from './validation'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'

const WEEKS_PER_YEAR = 52
const DEFAULT_SIMULATIONS = 1000
const DEFAULT_SEED = 20260913
/** Below this a volatility is rounding dust, and a Sharpe ratio divided by it is noise. */
const MIN_VOLATILITY = 1e-6
/** Weight moves smaller than this are not worth a sentence. */
const MATERIAL_SHIFT = 0.005

export type Scenario = {
  id: string
  name: string
  /** One weight per symbol, in symbol order. Need not sum to 1; they are normalised. */
  weights: number[]
  rationale?: string
}

export type ScenarioInput = {
  symbols: string[]
  /** Daily returns on common dates, one row per symbol. */
  returnsMatrix: number[][]
  scenarios: Scenario[]
  /** Annual, as a fraction. */
  riskFreeRate: number
  horizonYears: number
  numSimulations?: number
  seed?: number
}

export type ScenarioMetrics = {
  id: string
  name: string
  rationale: string | null
  weights: Array<{ symbol: string; weight: number }>

  // Retorno
  /** w·μ with μ the annualised historical mean. An estimate, not a forecast. */
  expectedReturnPct: number
  /** Annualised growth of the median simulated outcome. */
  medianAnnualReturnPct: number

  // Riesgo
  volatilityPct: number

  // Sharpe
  sharpe: number | null

  // VaR
  /** Loss at the 5% worst simulated outcome over the horizon, as % of today's value. Negative is a gain. */
  var95Pct: number

  // Drawdown
  /** Median across paths of each path's worst peak-to-trough fall. */
  maxDrawdownMedianPct: number
  /** The 90th percentile of that — a bad but not extreme path. */
  maxDrawdownBadPct: number

  // Probabilidad
  /** Share of futures that end below today's value. */
  probabilityOfLoss: number
  /** Share of futures that end above what the risk-free rate would have paid. */
  probabilityBeatRiskFree: number

  // Concentracion
  hhi: number
  /** 1/HHI — how many equal-sized positions the book is equivalent to. */
  effectiveHoldings: number
  largestWeight: { symbol: string; weight: number }
  largestRiskShare: { symbol: string; pct: number }
  /** Percent of total risk per symbol, in symbol order. */
  riskSharePct: number[]
}

export type ScenarioExplanation = {
  scenarioId: string
  versusId: string
  headline: string
  reasons: string[]
}

export type ScenarioComparison = {
  horizonYears: number
  simulations: number
  seed: number
  riskFreeRatePct: number
  baselineId: string
  scenarios: ScenarioMetrics[]
  explanations: ScenarioExplanation[]
  rejected: Array<{ id: string; name: string; reason: string }>
  caveat: string
}

export const SCENARIO_CAVEAT =
  'Todos los escenarios viven exactamente los mismos futuros simulados, asi que las diferencias entre ellos vienen de la asignacion y no de la suerte. ' +
  'Aun asi, el rendimiento esperado de cada activo es una estimacion a partir de su historia reciente, con un margen de error enorme: las diferencias de rendimiento entre escenarios son mucho menos confiables que las de riesgo. ' +
  'Se asume comprar y mantener desde hoy, sin costos, impuestos ni rebalanceo. No es una recomendacion.'

const pct1 = (value: number) => `${value.toFixed(1)}%`
const pp = (fraction: number) => `${Math.round(Math.abs(fraction) * 100)} pp`

function checkScenario(scenario: Scenario, assetCount: number): string | null {
  if (scenario.weights.length !== assetCount) {
    return `Tiene ${scenario.weights.length} pesos para ${assetCount} posiciones.`
  }
  if (!scenario.weights.every(Number.isFinite)) return 'Algun peso no es un numero.'
  if (scenario.weights.some((w) => w < 0)) {
    return 'Tiene un peso negativo, lo que implicaria vender en corto.'
  }
  if (!(scenario.weights.reduce((a, b) => a + b, 0) > 0)) return 'Todos los pesos son cero.'
  return null
}

/**
 * Compare allocations of the same holdings on shared simulated futures.
 *
 * Null when there are fewer than two valid scenarios, or the history is too
 * short to estimate returns from. Scenarios with invalid weights are set aside
 * in `rejected` with the reason, rather than silently dropped or silently fixed.
 */
export function compareScenarios(input: ScenarioInput): ScenarioComparison | null {
  const { symbols, returnsMatrix, riskFreeRate } = input
  const n = symbols.length
  if (n < 2 || returnsMatrix.length !== n) return null
  if (!Number.isFinite(riskFreeRate)) return null

  const horizonYears = Math.max(1 / WEEKS_PER_YEAR, input.horizonYears)
  if (!Number.isFinite(horizonYears)) return null
  const simulations = Math.max(100, Math.floor(input.numSimulations ?? DEFAULT_SIMULATIONS))
  const seed = input.seed ?? DEFAULT_SEED

  const rejected: ScenarioComparison['rejected'] = []
  const valid: Scenario[] = []
  for (const scenario of input.scenarios) {
    const reason = checkScenario(scenario, n)
    if (reason) rejected.push({ id: scenario.id, name: scenario.name, reason })
    else valid.push(scenario)
  }
  if (valid.length < 2) return null

  // Same estimates the efficient frontier uses, so a scenario here and a point
  // on the frontier agree on what an allocation is expected to return.
  const expected = historicalExpectedReturns(returnsMatrix)
  if (!expected) return null
  const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * TRADING_DAYS))
  if (!cov.every((row) => row.every(Number.isFinite))) return null

  const weeks = Math.max(1, Math.round(horizonYears * WEEKS_PER_YEAR))
  const simulated = simulateWeightings({
    inputs: gbmInputsFromHistory(returnsMatrix),
    weightings: valid.map((s) => s.weights),
    weeks,
    numSimulations: simulations,
    seed,
  })

  const riskFreeGrowth = Math.pow(1 + riskFreeRate, horizonYears)

  const metrics: ScenarioMetrics[] = []
  for (let s = 0; s < valid.length; s++) {
    const scenario = valid[s]
    const { weights, valuesByWeek } = simulated[s]
    if (!validateWeights(weights).valid) {
      rejected.push({ id: scenario.id, name: scenario.name, reason: 'Los pesos no suman 100%.' })
      continue
    }

    const volatility = portfolioVolatility(weights, cov)
    if (volatility === null) {
      rejected.push({ id: scenario.id, name: scenario.name, reason: 'No se pudo medir su volatilidad.' })
      continue
    }
    const expectedReturn = weights.reduce((sum, w, i) => sum + w * expected[i], 0)

    const finals = valuesByWeek[weeks - 1].slice().sort((a, b) => a - b)
    const median = percentile(finals, 0.5)
    const drawdowns = Array.from({ length: simulations }, (_, sim) => {
      const path = [1]
      for (let week = 0; week < weeks; week++) path.push(valuesByWeek[week][sim])
      return calculateMaxDrawdown(path)
    }).sort((a, b) => a - b)

    const probabilityOfLoss = finals.filter((v) => v < 1).length / simulations
    const probabilityBeatRiskFree = finals.filter((v) => v > riskFreeGrowth).length / simulations
    if (!validateProbability(probabilityOfLoss).valid || !validateProbability(probabilityBeatRiskFree).valid) {
      rejected.push({ id: scenario.id, name: scenario.name, reason: 'Una probabilidad salio fuera de 0 a 1.' })
      continue
    }

    const hhi = weights.reduce((sum, w) => sum + w * w, 0)
    const largestIndex = weights.reduce((best, w, i) => (w > weights[best] ? i : best), 0)

    const attribution = riskContributions(symbols, weights, cov)
    const riskSharePct = symbols.map(
      (symbol) => attribution?.contributions.find((c) => c.symbol === symbol)?.percentOfRisk ?? 0,
    )
    const riskiestIndex = riskSharePct.reduce((best, v, i) => (v > riskSharePct[best] ? i : best), 0)

    metrics.push({
      id: scenario.id,
      name: scenario.name,
      rationale: scenario.rationale ?? null,
      weights: symbols.map((symbol, i) => ({ symbol, weight: weights[i] })),
      expectedReturnPct: expectedReturn * 100,
      medianAnnualReturnPct: median > 0 ? (Math.pow(median, 1 / horizonYears) - 1) * 100 : -100,
      volatilityPct: volatility * 100,
      sharpe: volatility > MIN_VOLATILITY ? (expectedReturn - riskFreeRate) / volatility : null,
      var95Pct: (1 - percentile(finals, 0.05)) * 100,
      maxDrawdownMedianPct: percentile(drawdowns, 0.5),
      maxDrawdownBadPct: percentile(drawdowns, 0.9),
      probabilityOfLoss,
      probabilityBeatRiskFree,
      hhi,
      effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
      largestWeight: { symbol: symbols[largestIndex], weight: weights[largestIndex] },
      largestRiskShare: { symbol: symbols[riskiestIndex], pct: riskSharePct[riskiestIndex] },
      riskSharePct,
    })
  }

  if (metrics.length < 2) return null

  const baseline = metrics[0]
  const explanations = metrics.slice(1).map((other) => explainAgainst(baseline, other, expected, symbols))

  return {
    horizonYears,
    simulations,
    seed,
    riskFreeRatePct: riskFreeRate * 100,
    baselineId: baseline.id,
    scenarios: metrics,
    explanations,
    rejected,
    caveat: SCENARIO_CAVEAT,
  }
}

/**
 * Why `other` differs from `base`, in the user's numbers.
 *
 * Every sentence starts from the weights, because the weights are the only
 * thing that differs between two scenarios on shared futures. Risk, return and
 * concentration follow from them directly; drawdown, VaR and probability follow
 * from risk and return; and the explanation says that in that order, so the
 * reader can trace each number back to the allocation that caused it.
 */
function explainAgainst(
  base: ScenarioMetrics,
  other: ScenarioMetrics,
  expected: number[],
  symbols: string[],
): ScenarioExplanation {
  const shifts = symbols.map((symbol, i) => ({
    symbol,
    from: base.weights[i].weight,
    to: other.weights[i].weight,
    delta: other.weights[i].weight - base.weights[i].weight,
    expected: expected[i],
    index: i,
  }))

  if (shifts.every((s) => Math.abs(s.delta) < MATERIAL_SHIFT)) {
    return {
      scenarioId: other.id,
      versusId: base.id,
      headline: `${other.name} es practicamente la misma asignacion que ${base.name}, asi que en los mismos futuros simulados da los mismos resultados.`,
      reasons: [],
    }
  }

  const volDirection = other.volatilityPct < base.volatilityPct ? 'baja' : 'sube'
  const retDirection = other.expectedReturnPct < base.expectedReturnPct ? 'baja' : 'sube'
  const headline =
    `Frente a ${base.name}, ${other.name} ${volDirection} la volatilidad de ${pct1(base.volatilityPct)} a ${pct1(other.volatilityPct)} ` +
    `y ${retDirection} el rendimiento estimado de ${pct1(base.expectedReturnPct)} a ${pct1(other.expectedReturnPct)}.`

  const reasons: string[] = []

  // 1. The allocation itself.
  const cut = shifts.filter((s) => s.delta < -MATERIAL_SHIFT).sort((a, b) => a.delta - b.delta)[0]
  const added = shifts.filter((s) => s.delta > MATERIAL_SHIFT).sort((a, b) => b.delta - a.delta)[0]
  const moves: string[] = []
  if (cut) moves.push(`quita ${pp(cut.delta)} a ${cut.symbol} (${pct1(cut.from * 100)} → ${pct1(cut.to * 100)})`)
  if (added) moves.push(`agrega ${pp(added.delta)} a ${added.symbol} (${pct1(added.from * 100)} → ${pct1(added.to * 100)})`)
  reasons.push(`El cambio principal: ${moves.join(' y ')}. Todo lo demas se sigue de ahi.`)

  // 2. Risk — where it comes from on each side, stated rather than inferred.
  // An earlier version said "X carried 54% of the risk and now carries 11%, so
  // volatility rises", which is backwards whenever the rise comes from a
  // holding that was added. Naming the riskiest holding on each side is true in
  // every case; asserting a cause from one of them is not.
  const baseTop = base.largestRiskShare
  const otherTop = other.largestRiskShare
  const volChange = Math.abs(other.volatilityPct - base.volatilityPct)
  const sources =
    baseTop.symbol === otherTop.symbol
      ? `la mayor fuente de riesgo sigue siendo ${baseTop.symbol}, que pasa de aportar ${pct1(baseTop.pct)} a ${pct1(otherTop.pct)} del riesgo total`
      : `la mayor fuente de riesgo pasa de ${baseTop.symbol} (${pct1(baseTop.pct)} del riesgo en ${base.name}) a ${otherTop.symbol} (${pct1(otherTop.pct)} en ${other.name})`
  reasons.push(
    `Riesgo: ${sources}. ` +
      (volChange < 0.05
        ? 'La volatilidad total practicamente no cambia.'
        : `La volatilidad total ${volDirection} ${volChange.toFixed(1)} puntos.`),
  )

  // 3. Return — attributed to the position whose move changed it most.
  const returnDrivers = shifts
    .map((s) => ({ ...s, effect: s.delta * s.expected }))
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
  const driver = returnDrivers[0]
  reasons.push(
    `Rendimiento estimado: la mayor parte de la diferencia viene de ${driver.symbol}, que tiene un rendimiento historico estimado de ${pct1(driver.expected * 100)} y ${driver.delta > 0 ? 'gana' : 'pierde'} ${pp(driver.delta)} de peso ` +
      `(${driver.effect >= 0 ? '+' : '−'}${Math.abs(driver.effect * 100).toFixed(1)} puntos de rendimiento).`,
  )

  // 4. Sharpe — the two together.
  if (base.sharpe !== null && other.sharpe !== null) {
    reasons.push(
      `Sharpe: ${other.sharpe.toFixed(2)} frente a ${base.sharpe.toFixed(2)}. ` +
        (other.sharpe > base.sharpe
          ? 'Obtiene mas rendimiento estimado por cada punto de volatilidad, aunque eso depende sobre todo de estimaciones de rendimiento poco confiables.'
          : 'Obtiene menos rendimiento estimado por cada punto de volatilidad; ojo, esa comparacion depende sobre todo de estimaciones de rendimiento poco confiables.'),
    )
  }

  // 5. Drawdown and VaR — consequences of the risk, on the same futures.
  reasons.push(
    `Caidas: en los mismos futuros simulados, su caida maxima tipica es ${pct1(other.maxDrawdownMedianPct)} frente a ${pct1(base.maxDrawdownMedianPct)}, ` +
      `y en un camino malo (percentil 90) ${pct1(other.maxDrawdownBadPct)} frente a ${pct1(base.maxDrawdownBadPct)}. ` +
      `En el 5% de los peores futuros (VaR al 95%) termina con ${describeVar(other.var95Pct)}; ${base.name}, con ${describeVar(base.var95Pct)}.`,
  )

  // 6. Probability.
  reasons.push(
    `Probabilidad: termina con perdida en ${pct1(other.probabilityOfLoss * 100)} de los futuros frente a ${pct1(base.probabilityOfLoss * 100)}, ` +
      `y supera a la tasa libre de riesgo en ${pct1(other.probabilityBeatRiskFree * 100)} frente a ${pct1(base.probabilityBeatRiskFree * 100)}.`,
  )

  // 7. Concentration.
  reasons.push(
    `Concentracion: su HHI es ${other.hhi.toFixed(2)} frente a ${base.hhi.toFixed(2)}, equivalente a tener ${other.effectiveHoldings.toFixed(1)} posiciones del mismo tamano en vez de ${base.effectiveHoldings.toFixed(1)}. ` +
      `Su posicion mas grande es ${other.largestWeight.symbol} con ${pct1(other.largestWeight.weight * 100)}.`,
  )

  return { scenarioId: other.id, versusId: base.id, headline, reasons }
}

function describeVar(var95Pct: number): string {
  return var95Pct >= 0 ? `una perdida de ${pct1(var95Pct)}` : `una ganancia de ${pct1(-var95Pct)}`
}

// ─── Reading a request ──────────────────────────────────────────────────────

/** Every scenario the portfolio route knows how to build. */
export const SCENARIO_IDS = [
  'current',
  'equalWeight',
  'inverseVolatility',
  'riskParity',
  'minCVaR',
  'minVariance',
  'maxSharpe',
  'custom',
] as const
export type ScenarioId = (typeof SCENARIO_IDS)[number]

/** What opens when nothing is asked for: the book, and three that need no return forecast or one that needs little. */
export const DEFAULT_SCENARIO_IDS: ScenarioId[] = ['current', 'equalWeight', 'riskParity', 'minVariance']

/** Horizons offered, in years. A free number invites 0.001 and 400. */
export const SCENARIO_HORIZONS = [1, 3, 5, 10] as const

export type ScenarioRequest = {
  horizonYears: number
  include: ScenarioId[]
  /** Custom weights in symbol order (any scale), or null when none or invalid. */
  custom: number[] | null
  errors: string[]
}

/**
 * Horizon, scenario list and optional custom weights from a query string.
 *
 * `?horizon=3&include=current,riskParity&custom=VOO:70,AAPL:30`. Anything
 * unrecognised falls back to a default rather than failing the request, and a
 * bad custom allocation is refused with a reason instead of being "fixed".
 */
export function parseScenarioRequest(params: URLSearchParams, symbols: string[]): ScenarioRequest {
  const errors: string[] = []

  const horizonRaw = Number(params.get('horizon'))
  const horizonYears = (SCENARIO_HORIZONS as readonly number[]).includes(horizonRaw) ? horizonRaw : 1

  const known = new Set<string>(SCENARIO_IDS)
  const includeRaw = params.get('include')
  let include: ScenarioId[] = includeRaw
    ? [...new Set(includeRaw.split(',').map((s) => s.trim()).filter((s) => known.has(s)))] as ScenarioId[]
    : [...DEFAULT_SCENARIO_IDS]

  let custom: number[] | null = null
  const customRaw = params.get('custom')
  if (customRaw) {
    const weights = symbols.map(() => 0)
    let ok = true
    for (const pair of customRaw.split(',')) {
      const [symbol, value] = pair.split(':').map((part) => part?.trim())
      const index = symbols.indexOf(symbol ?? '')
      const weight = Number(value)
      if (index < 0) {
        errors.push(`${symbol || '(vacio)'} no es una posicion de esta cartera.`)
        ok = false
      } else if (!Number.isFinite(weight) || weight < 0) {
        errors.push(`El peso de ${symbol} no es valido.`)
        ok = false
      } else {
        weights[index] = weight
      }
    }
    if (ok && !(weights.reduce((a, b) => a + b, 0) > 0)) {
      errors.push('La asignacion personalizada no tiene ningun peso.')
      ok = false
    }
    if (ok) {
      custom = weights
      if (!include.includes('custom')) include = [...include, 'custom']
    }
  }
  if (!custom) include = include.filter((id) => id !== 'custom')

  return { horizonYears, include, custom, errors }
}
