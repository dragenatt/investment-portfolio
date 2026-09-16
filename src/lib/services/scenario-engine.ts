// Scenario engine (P2-9) — pure functions, no I/O.
//
// One definition of "a scenario" and one way to run it, for every part of the
// app that asks "what could this portfolio do": the advisor's plans, the
// portfolio's projections, the lab, rebalancing, optimisation and backtesting.
//
// A scenario holds everything the answer depends on — capital, weights,
// contributions, horizon, benchmark, the risk model, costs, inflation and
// shocks — and nothing else. The same scenario always produces the same
// result: its canonical form is hashed into a key, the key seeds the random
// stream when no seed is given, and the result carries key, seed and engine
// version so any figure can be traced back to exactly what produced it.
//
// The randomness is the portfolio Monte Carlo's own correlated GBM generator
// (forEachCorrelatedStep in monte-carlo.ts), stepped monthly. Costs use the cost
// model and never invent a cost: an absent cost is zero and the result says the
// figures are gross.

import { choleskyDecomposition } from './covariance'
import { forEachCorrelatedStep, gbmInputsFromHistory, percentile, type GbmInputs } from './monte-carlo'
import { DEFAULT_COST_MODEL, tradeCost, type CostModel } from './costs'
import type { PlanParams } from './advisor'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

export const SCENARIO_ENGINE_VERSION = '1.0.0'

const MONTHS_PER_YEAR = 12
const DEFAULT_SIMULATIONS = 1000
export const MAX_SIMULATIONS = 10_000
export const MAX_HORIZON_MONTHS = 600
const WEIGHT_TOLERANCE = 1e-6

export type ScenarioHolding = { symbol: string; weight: number }

export type ScenarioRiskModel = {
  /** Annual arithmetic expected return per holding, as a fraction. */
  expectedReturns: number[]
  /** Annual volatility per holding, as a fraction. */
  volatilities: number[]
  /** Correlation matrix, ordered as the holdings. */
  correlation: number[][]
  /** Where the estimates came from — history, a profile, a user's assumption. */
  source: string
}

export type ScenarioShock = {
  /** Month (1-based) at the end of which the shock lands. */
  month: number
  /** Instant price change, as a fraction: -0.3 is a 30% fall. */
  return: number
  /** Holdings it hits; all of them when omitted. */
  symbols?: string[]
  label?: string
}

export type ScenarioBenchmark = {
  symbol: string
  expectedReturn: number
  volatility: number
  /** Correlation of the benchmark with each holding, ordered as the holdings. */
  correlations: number[]
}

export type ScenarioSpec = {
  capital: number
  holdings: ScenarioHolding[]
  contributions?: {
    /** Added at the end of each month, split across holdings by target weight. */
    monthly: number
    /** Yearly raise of the contribution, as a fraction. */
    annualIncrease?: number
  }
  horizonMonths: number
  benchmark?: ScenarioBenchmark | null
  risk: ScenarioRiskModel
  costs?: CostModel
  /** Annual inflation, as a fraction, to express values in today's money. */
  inflation?: number
  rebalance?: 'none' | 'monthly' | 'annual'
  shocks?: ScenarioShock[]
  simulations?: number
  seed?: number
}

export type NormalisedScenario = Required<Omit<ScenarioSpec, 'benchmark' | 'seed'>> & {
  benchmark: ScenarioBenchmark | null
  seed: number
  key: string
}

export type ScenarioValidation = { ok: true; scenario: NormalisedScenario } | { ok: false; errors: string[] }

// ─── Canonical form and key ─────────────────────────────────────────────────

/** Stable JSON: object keys sorted, so the same scenario always serialises identically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** 32-bit FNV-1a, as eight hex digits. Identity, not security. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const finite = (v: number) => Number.isFinite(v)

/**
 * Validate a scenario and fill its defaults.
 *
 * Everything that could make two runs of "the same" scenario differ is pinned
 * here: defaults are explicit, and the key is computed on the filled-in form,
 * so leaving a field out and passing its default produce the same key.
 */
export function normaliseScenario(spec: ScenarioSpec): ScenarioValidation {
  const errors: string[] = []
  const n = spec.holdings?.length ?? 0

  if (!(finite(spec.capital) && spec.capital >= 0)) errors.push('El capital inicial debe ser un número mayor o igual a cero.')
  if (n === 0) errors.push('El escenario necesita al menos una posición.')

  const weights = (spec.holdings ?? []).map((h) => h.weight)
  if (n > 0) {
    if (!weights.every((w) => finite(w) && w >= 0)) errors.push('Los pesos deben ser números no negativos.')
    else if (Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > WEIGHT_TOLERANCE) errors.push('Los pesos deben sumar 100%.')
    if (new Set(spec.holdings.map((h) => h.symbol)).size !== n) errors.push('Cada posición debe aparecer una sola vez.')
  }

  const months = Math.floor(spec.horizonMonths)
  if (!(months >= 1 && months <= MAX_HORIZON_MONTHS)) errors.push(`El horizonte debe estar entre 1 y ${MAX_HORIZON_MONTHS} meses.`)

  const risk = spec.risk
  if (!risk || risk.expectedReturns?.length !== n || risk.volatilities?.length !== n || risk.correlation?.length !== n) {
    errors.push('El modelo de riesgo debe tener un rendimiento esperado, una volatilidad y una fila de correlación por posición.')
  } else {
    if (!risk.expectedReturns.every((r) => finite(r) && r > -1)) errors.push('Los rendimientos esperados deben ser números mayores que -100%.')
    if (!risk.volatilities.every((v) => finite(v) && v >= 0)) errors.push('Las volatilidades deben ser números no negativos.')
    const c = risk.correlation
    const square = c.every((row) => row.length === n && row.every((v) => finite(v) && v >= -1 - 1e-9 && v <= 1 + 1e-9))
    const symmetric = square && c.every((row, i) => row.every((v, j) => Math.abs(v - c[j][i]) < 1e-9)) && c.every((row, i) => Math.abs(row[i] - 1) < 1e-9)
    if (!symmetric) errors.push('La correlación debe ser una matriz simétrica con unos en la diagonal y valores entre -1 y 1.')
    if (!risk.source?.trim()) errors.push('El modelo de riesgo debe decir de dónde salen sus estimaciones.')
  }

  const monthly = spec.contributions?.monthly ?? 0
  const increase = spec.contributions?.annualIncrease ?? 0
  if (!(finite(monthly) && monthly >= 0)) errors.push('La aportación mensual debe ser mayor o igual a cero.')
  if (!(finite(increase) && increase > -1)) errors.push('El aumento anual de la aportación debe ser mayor que -100%.')

  const inflation = spec.inflation ?? 0
  if (!(finite(inflation) && inflation > -1)) errors.push('La inflación debe ser un número mayor que -100%.')

  const costs = spec.costs ?? DEFAULT_COST_MODEL
  if (![costs.commissionPct, costs.spreadPct, costs.custodyAnnualPct, costs.capitalGainsTaxPct].every((v) => finite(v) && v >= 0 && v < 100)) {
    errors.push('Los costos deben ser porcentajes entre 0 y 100.')
  }

  const shocks = spec.shocks ?? []
  for (const shock of shocks) {
    if (!(Number.isInteger(shock.month) && shock.month >= 1 && shock.month <= months)) errors.push('Cada choque debe caer en un mes dentro del horizonte.')
    if (!(finite(shock.return) && shock.return > -1)) errors.push('Un choque no puede hacer caer un activo 100% o más.')
    if (shock.symbols?.some((s) => !spec.holdings.some((h) => h.symbol === s))) errors.push('Un choque menciona una posición que el escenario no tiene.')
  }

  const benchmark = spec.benchmark ?? null
  if (benchmark) {
    if (!(finite(benchmark.expectedReturn) && finite(benchmark.volatility) && benchmark.volatility >= 0)) errors.push('El benchmark necesita rendimiento y volatilidad válidos.')
    if (benchmark.correlations?.length !== n || !benchmark.correlations.every((v) => finite(v) && Math.abs(v) <= 1 + 1e-9)) {
      errors.push('El benchmark necesita una correlación con cada posición.')
    }
  }

  const simulations = Math.floor(spec.simulations ?? DEFAULT_SIMULATIONS)
  if (!(simulations >= 1 && simulations <= MAX_SIMULATIONS)) errors.push(`Las simulaciones deben estar entre 1 y ${MAX_SIMULATIONS}.`)
  const rebalance = spec.rebalance ?? 'none'
  if (!['none', 'monthly', 'annual'].includes(rebalance)) errors.push('El rebalanceo debe ser none, monthly o annual.')

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] }

  const filled = {
    capital: spec.capital,
    holdings: spec.holdings.map((h) => ({ symbol: h.symbol, weight: h.weight })),
    contributions: { monthly, annualIncrease: increase },
    horizonMonths: months,
    benchmark,
    risk: { ...risk },
    costs: { ...costs },
    inflation,
    rebalance,
    shocks: [...shocks].sort((a, b) => a.month - b.month),
    simulations,
  }
  const key = fnv1a(canonical(filled))
  // The key doubles as the seed when none is given: the same scenario, the same stream.
  const seed = spec.seed !== undefined && Number.isInteger(spec.seed) ? spec.seed >>> 0 : parseInt(key, 16)
  return { ok: true, scenario: { ...filled, seed, key: fnv1a(`${key}:${seed}`) } }
}

// ─── Running it ─────────────────────────────────────────────────────────────

export type MonthlyBand = { month: number; p10: number; p25: number; p50: number; p75: number; p90: number }

export type ScenarioResult = {
  /** Nominal book value by month, month 0 is the starting capital. */
  nominal: MonthlyBand[]
  /** The same in today's money, deflated by the scenario's inflation. */
  real: MonthlyBand[]
  final: {
    nominal: { p10: number; p50: number; p90: number; mean: number }
    real: { p10: number; p50: number; p90: number }
    /** Capital plus every contribution, before costs. */
    contributed: number
    /** Share of paths that end below what was put in, %. */
    probabilityOfLossPct: number
    /** Median of the costs each path paid over the horizon. */
    medianCostsPaid: number
    /** Tax owed on the median gain if everything were sold at the horizon. */
    medianLiquidationTax: number
  }
  /** Worst peak-to-trough fall of the unit value (contributions excluded), across paths. */
  drawdown: { medianPct: number; p90Pct: number }
  benchmark: {
    symbol: string
    /** Median final value of the same money invested in the benchmark, same contributions. */
    medianFinal: number
    /** Share of paths where the portfolio's unit value ends above the benchmark's, %. */
    probabilityAheadPct: number
  } | null
  model: {
    engineVersion: string
    key: string
    seed: number
    simulations: number
    months: number
    riskSource: string
    costsSource: string
    gross: boolean
  }
}

function band(month: number, sorted: number[]): MonthlyBand {
  return {
    month,
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  }
}

/** GBM inputs for the holdings, with the benchmark appended as one more asset when there is one. */
function gbmInputsFor(scenario: NormalisedScenario): GbmInputs {
  const { risk, benchmark } = scenario
  const n = risk.expectedReturns.length
  const correlation = risk.correlation.map((row) => [...row])
  const mu = [...risk.expectedReturns]
  const sigma = [...risk.volatilities]
  if (benchmark) {
    correlation.forEach((row, i) => row.push(benchmark.correlations[i]))
    correlation.push([...benchmark.correlations, 1])
    mu.push(benchmark.expectedReturn)
    sigma.push(benchmark.volatility)
  }
  return { mu, sigma, cholesky: choleskyDecomposition(correlation.slice(0, n + (benchmark ? 1 : 0))) }
}

/**
 * Run a scenario. Returns the validation errors instead when the spec is not a
 * scenario that can be run.
 */
export function runScenario(spec: ScenarioSpec): ScenarioResult | { errors: string[] } {
  const validation = normaliseScenario(spec)
  if (!validation.ok) return { errors: validation.errors }
  const s = validation.scenario

  const n = s.holdings.length
  const months = s.horizonMonths
  const paths = s.simulations
  const target = s.holdings.map((h) => h.weight)
  const hasBenchmark = s.benchmark !== null
  const custodyMonthly = s.costs.custodyAnnualPct / 100 / MONTHS_PER_YEAR
  const inflationMonthly = Math.pow(1 + s.inflation, 1 / MONTHS_PER_YEAR)
  const shocksByMonth = new Map<number, ScenarioShock[]>()
  for (const shock of s.shocks) shocksByMonth.set(shock.month, [...(shocksByMonth.get(shock.month) ?? []), shock])
  const symbolIndex = new Map(s.holdings.map((h, i) => [h.symbol, i]))

  const contributionFor = (month: number) => s.contributions.monthly * Math.pow(1 + (s.contributions.annualIncrease ?? 0), Math.floor((month - 1) / MONTHS_PER_YEAR))
  let contributed = s.capital
  for (let m = 1; m <= months; m++) contributed += contributionFor(m)

  const valuesByMonth: number[][] = Array.from({ length: months }, () => new Array<number>(paths).fill(0))
  const drawdowns = new Array<number>(paths).fill(0)
  const costsPaid = new Array<number>(paths).fill(0)
  const finalNav = new Array<number>(paths).fill(1)
  const benchmarkFinal = new Array<number>(paths).fill(0)
  const benchmarkNavFinal = new Array<number>(paths).fill(1)

  // Per-path state, reset at the first step of each path.
  const holdings = new Array<number>(n).fill(0)
  const previousRelatives = new Array<number>(n + 1).fill(1)
  let nav = 1
  let peakNav = 1
  let benchmarkValue = 0
  let benchmarkNav = 1

  const invest = (amount: number, sim: number) => {
    if (amount <= 0) return
    const cost = tradeCost(amount, s.costs)
    costsPaid[sim] += cost
    const net = Math.max(0, amount - cost)
    for (let i = 0; i < n; i++) holdings[i] += net * target[i]
  }

  forEachCorrelatedStep(
    { inputs: gbmInputsFor(s), steps: months, stepsPerYear: MONTHS_PER_YEAR, numSimulations: paths, seed: s.seed },
    (sim, step, relatives) => {
      const month = step + 1
      if (step === 0) {
        holdings.fill(0)
        previousRelatives.fill(1)
        costsPaid[sim] = 0
        invest(s.capital, sim)
        nav = 1
        peakNav = 1
        benchmarkValue = s.capital
        benchmarkNav = 1
      }

      // Market move this month, then any shock that lands at its end.
      const before = holdings.reduce((a, b) => a + b, 0)
      for (let i = 0; i < n; i++) holdings[i] *= relatives[i] / previousRelatives[i]
      for (const shock of shocksByMonth.get(month) ?? []) {
        const hit = shock.symbols ? shock.symbols.map((sym) => symbolIndex.get(sym)!) : holdings.map((_, i) => i)
        for (const i of hit) holdings[i] *= 1 + shock.return
      }

      // Custody fee as a monthly drag on what is held.
      let value = holdings.reduce((a, b) => a + b, 0)
      if (custodyMonthly > 0) {
        costsPaid[sim] += value * custodyMonthly
        for (let i = 0; i < n; i++) holdings[i] *= 1 - custodyMonthly
        value *= 1 - custodyMonthly
      }

      // Unit value: the book's growth before this month's contribution.
      if (before > 0) nav *= value / before
      peakNav = Math.max(peakNav, nav)
      drawdowns[sim] = Math.max(drawdowns[sim], peakNav > 0 ? (peakNav - nav) / peakNav : 0)

      if (hasBenchmark) {
        const bRel = relatives[n] / previousRelatives[n]
        benchmarkValue = benchmarkValue * bRel + contributionFor(month)
        benchmarkNav *= bRel
      }

      invest(contributionFor(month), sim)

      if (s.rebalance === 'monthly' || (s.rebalance === 'annual' && month % MONTHS_PER_YEAR === 0)) {
        const total = holdings.reduce((a, b) => a + b, 0)
        let turnover = 0
        for (let i = 0; i < n; i++) turnover += Math.abs(holdings[i] - total * target[i])
        const cost = tradeCost(turnover / 2, s.costs) * 2
        costsPaid[sim] += cost
        const net = Math.max(0, total - cost)
        for (let i = 0; i < n; i++) holdings[i] = net * target[i]
      }

      for (let i = 0; i <= n; i++) previousRelatives[i] = relatives[i] ?? 1
      valuesByMonth[step][sim] = holdings.reduce((a, b) => a + b, 0)

      if (month === months) {
        finalNav[sim] = nav
        benchmarkFinal[sim] = benchmarkValue
        benchmarkNavFinal[sim] = benchmarkNav
      }
    },
  )

  const nominal: MonthlyBand[] = [band(0, [s.capital])]
  const real: MonthlyBand[] = [band(0, [s.capital])]
  for (let m = 0; m < months; m++) {
    const sorted = valuesByMonth[m].slice().sort((a, b) => a - b)
    nominal.push(band(m + 1, sorted))
    const deflator = Math.pow(inflationMonthly, m + 1)
    real.push(band(m + 1, sorted.map((v) => v / deflator)))
  }

  const finals = valuesByMonth[months - 1].slice().sort((a, b) => a - b)
  const deflator = Math.pow(inflationMonthly, months)
  const medianFinal = percentile(finals, 0.5)
  const sortedDrawdowns = drawdowns.slice().sort((a, b) => a - b)

  return {
    nominal,
    real,
    final: {
      nominal: {
        p10: percentile(finals, 0.1),
        p50: medianFinal,
        p90: percentile(finals, 0.9),
        mean: finals.reduce((a, b) => a + b, 0) / finals.length,
      },
      real: { p10: percentile(finals, 0.1) / deflator, p50: medianFinal / deflator, p90: percentile(finals, 0.9) / deflator },
      contributed,
      probabilityOfLossPct: (finals.filter((v) => v < contributed).length / finals.length) * 100,
      medianCostsPaid: percentile(costsPaid.slice().sort((a, b) => a - b), 0.5),
      medianLiquidationTax: Math.max(0, medianFinal - contributed) * (s.costs.capitalGainsTaxPct / 100),
    },
    drawdown: { medianPct: percentile(sortedDrawdowns, 0.5) * 100, p90Pct: percentile(sortedDrawdowns, 0.9) * 100 },
    benchmark: s.benchmark
      ? {
          symbol: s.benchmark.symbol,
          medianFinal: percentile(benchmarkFinal.slice().sort((a, b) => a - b), 0.5),
          probabilityAheadPct: (finalNav.filter((v, i) => v > benchmarkNavFinal[i]).length / paths) * 100,
        }
      : null,
    model: {
      engineVersion: SCENARIO_ENGINE_VERSION,
      key: s.key,
      seed: s.seed,
      simulations: paths,
      months,
      riskSource: s.risk.source,
      costsSource: s.costs.source,
      gross: [s.costs.commissionPct, s.costs.spreadPct, s.costs.custodyAnnualPct].every((v) => v === 0),
    },
  }
}

// ─── Adapters: the same scenario from each consumer's inputs ────────────────

/** Correlation from a covariance matrix, clamped against rounding. */
function correlationOf(cov: number[][]): number[][] {
  const sd = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])))
  return cov.map((row, i) => row.map((v, j) => (i === j ? 1 : sd[i] > 0 && sd[j] > 0 ? Math.max(-1, Math.min(1, v / (sd[i] * sd[j]))) : 0)))
}

/**
 * A risk model estimated from daily history — for the portfolio, optimisation,
 * rebalancing and backtesting, which all start from the holdings' own returns.
 * Uses the Monte Carlo's own estimator, so projections agree with the cone.
 */
export function riskModelFromHistory(returnsMatrix: number[][], source = 'Media y covarianza históricas de los rendimientos diarios'): ScenarioRiskModel {
  const inputs = gbmInputsFromHistory(returnsMatrix)
  const T = returnsMatrix[0]?.length ?? 0
  const means = returnsMatrix.map((r) => r.reduce((a, b) => a + b, 0) / Math.max(1, r.length))
  const cov = returnsMatrix.map((ri, i) =>
    returnsMatrix.map((rj, j) => (T > 1 ? ri.reduce((s, v, t) => s + (v - means[i]) * (rj[t] - means[j]), 0) / (T - 1) : 0)),
  )
  return { expectedReturns: inputs.mu, volatilities: inputs.sigma, correlation: correlationOf(cov), source }
}

/**
 * The advisor's plan as a scenario: one diversified holding with the profile's
 * expected return and volatility, monthly contributions, no rebalancing.
 */
export function scenarioFromPlan(plan: PlanParams, options: { simulations?: number; seed?: number; inflation?: number; costs?: CostModel } = {}): ScenarioSpec {
  return {
    capital: plan.capitalInicial,
    holdings: [{ symbol: 'PLAN', weight: 1 }],
    contributions: { monthly: plan.aportacionMensual },
    horizonMonths: Math.round(plan.años * MONTHS_PER_YEAR),
    risk: {
      expectedReturns: [plan.rendimientoAnual],
      volatilities: [plan.volatilidadAnual],
      correlation: [[1]],
      source: 'Rendimiento y volatilidad del perfil del advisor (docs/FINANCIAL_ASSUMPTIONS.md)',
    },
    inflation: options.inflation,
    costs: options.costs,
    simulations: options.simulations,
    seed: options.seed,
  }
}

/** A portfolio or model allocation as a scenario, from its weights and history. */
export function scenarioFromWeights(params: {
  capital: number
  symbols: string[]
  weights: number[]
  returnsMatrix: number[][]
  horizonMonths: number
  monthlyContribution?: number
  benchmarkReturns?: { symbol: string; returns: number[] } | null
  rebalance?: ScenarioSpec['rebalance']
  costs?: CostModel
  inflation?: number
  shocks?: ScenarioShock[]
  simulations?: number
  seed?: number
  /** One annual expected return for every holding, replacing the historical means; volatility and correlation stay historical. */
  expectedReturnOverride?: number | null
}): ScenarioSpec {
  const total = params.weights.reduce((a, b) => a + b, 0)
  const holdings = params.symbols.map((symbol, i) => ({ symbol, weight: total > 0 ? params.weights[i] / total : 1 / params.symbols.length }))
  const bench = params.benchmarkReturns && params.benchmarkReturns.returns.length === (params.returnsMatrix[0]?.length ?? -1) ? params.benchmarkReturns : null
  const risk = riskModelFromHistory(bench ? [...params.returnsMatrix, bench.returns] : params.returnsMatrix)
  const n = params.symbols.length
  return {
    capital: params.capital,
    holdings,
    contributions: { monthly: params.monthlyContribution ?? 0 },
    horizonMonths: params.horizonMonths,
    risk: {
      expectedReturns:
        params.expectedReturnOverride !== undefined && params.expectedReturnOverride !== null
          ? params.symbols.map(() => params.expectedReturnOverride!)
          : risk.expectedReturns.slice(0, n),
      volatilities: risk.volatilities.slice(0, n),
      correlation: risk.correlation.slice(0, n).map((row) => row.slice(0, n)),
      source:
        params.expectedReturnOverride !== undefined && params.expectedReturnOverride !== null
          ? `Rendimiento esperado indicado (${(params.expectedReturnOverride * 100).toFixed(1)}% anual para cada posición); volatilidad y correlación históricas`
          : risk.source,
    },
    benchmark: bench
      ? { symbol: bench.symbol, expectedReturn: risk.expectedReturns[n], volatility: risk.volatilities[n], correlations: risk.correlation[n].slice(0, n) }
      : null,
    rebalance: params.rebalance,
    costs: params.costs,
    inflation: params.inflation,
    shocks: params.shocks,
    simulations: params.simulations,
    seed: params.seed,
  }
}

// ─── A portfolio scenario from a request ────────────────────────────────────

export const ALLOCATION_PRESETS = ['current', 'equalWeight', 'riskParity', 'minCVaR', 'markowitz'] as const
export type AllocationPreset = (typeof ALLOCATION_PRESETS)[number]

export type PortfolioScenarioRequest = {
  allocation: AllocationPreset
  horizonMonths: number
  monthlyContribution: number
  rebalance: NonNullable<ScenarioSpec['rebalance']>
  /** Annual, as a fraction. */
  inflation: number
  /** Annual custody fee and per-trade commission, in percent. Zero unless given. */
  custodyAnnualPct: number
  commissionPct: number
  /** One optional shock to every holding. */
  shock: ScenarioShock | null
  /** Capital to start from; the book's own value when absent. */
  capital: number | null
  /** Annual expected return for every holding, as a fraction; null keeps the historical means. */
  expectedReturn: number | null
}

/** Paths for a request made from the browser: enough for stable bands, cheap enough per request. */
export const REQUEST_SIMULATIONS = 1000

function numberParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name)
  const value = raw === null || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/**
 * Read a portfolio scenario from query parameters, clamped to what the engine
 * accepts. Percentages arrive as percentages: inflation=4 is 4%.
 */
export function parsePortfolioScenarioRequest(params: URLSearchParams): PortfolioScenarioRequest {
  const allocation = params.get('allocation')
  const rebalance = params.get('rebalance')
  const horizonMonths = Math.round(numberParam(params, 'horizon', 60, 1, 360))
  const shockPct = numberParam(params, 'shock', 0, -95, 0)
  const shockMonth = Math.round(numberParam(params, 'shockMonth', 1, 1, horizonMonths))
  const capital = params.get('capital')
  const capitalValue = capital === null || capital.trim() === '' ? NaN : Number(capital)
  const expected = params.get('expected')
  const expectedValue = expected === null || expected.trim() === '' ? NaN : Number(expected)
  return {
    allocation: (ALLOCATION_PRESETS as readonly string[]).includes(allocation ?? '') ? (allocation as AllocationPreset) : 'current',
    horizonMonths,
    monthlyContribution: numberParam(params, 'monthly', 0, 0, 1e9),
    rebalance: rebalance === 'monthly' || rebalance === 'annual' ? rebalance : 'none',
    inflation: numberParam(params, 'inflation', 0, -5, 50) / 100,
    custodyAnnualPct: numberParam(params, 'custody', 0, 0, 10),
    commissionPct: numberParam(params, 'commission', 0, 0, 10),
    shock: shockPct < 0 ? { month: shockMonth, return: shockPct / 100, label: 'Choque a todas las posiciones' } : null,
    capital: Number.isFinite(capitalValue) && capitalValue >= 0 ? capitalValue : null,
    expectedReturn: Number.isFinite(expectedValue) ? Math.min(50, Math.max(-50, expectedValue)) / 100 : null,
  }
}

export type EstimateReliability = {
  /** Years of daily history behind the estimates. */
  historyYears: number
  /** The book's annualised historical mean return, %. */
  historicalReturnPct: number
  /** Standard error of that mean, in percentage points: σ / √years. */
  standardErrorPct: number
  /** True when the history is too short or too noisy for its mean to anchor a projection. */
  unreliable: boolean
  note: string
}

/** Below this many years, a historical mean says little about the next ones. */
export const MIN_RELIABLE_YEARS = 3

/**
 * How much the historical mean behind a projection can be trusted.
 *
 * The standard error of an annualised mean is σ/√years, the same measure the
 * robust optimisation uses for its ranges. Six months of a rising market can put
 * the mean at 35% a year with a standard error of 25 points — a projection
 * centred there, with no loss in any path, is arithmetic, not evidence.
 */
export function estimateReliability(portfolioDailyReturns: number[], periodsPerYear = TRADING_DAYS_PER_YEAR): EstimateReliability | null {
  const T = portfolioDailyReturns.length
  if (T < 2 || !portfolioDailyReturns.every(Number.isFinite)) return null
  const mean = portfolioDailyReturns.reduce((a, b) => a + b, 0) / T
  const variance = portfolioDailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (T - 1)
  const years = T / periodsPerYear
  const annualMean = mean * periodsPerYear * 100
  const standardError = (Math.sqrt(variance * periodsPerYear) / Math.sqrt(years)) * 100
  const unreliable = years < MIN_RELIABLE_YEARS || standardError > Math.abs(annualMean) / 2
  return {
    historyYears: years,
    historicalReturnPct: annualMean,
    standardErrorPct: standardError,
    unreliable,
    note: unreliable
      ? `La media histórica (${annualMean.toFixed(1)}% anual) sale de ${(years * 12).toFixed(0)} meses de historia y su error estándar es de ±${standardError.toFixed(1)} puntos: el centro de la proyección es muy incierto. Considera indicar un rendimiento esperado.`
      : `La media histórica (${annualMean.toFixed(1)}% anual, ±${standardError.toFixed(1)} puntos de error estándar) sale de ${years.toFixed(1)} años de historia.`,
  }
}
