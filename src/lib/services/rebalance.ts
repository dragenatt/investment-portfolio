// Rebalancing — pure functions, no I/O.
//
// Four ways to decide a portfolio has wandered, because they disagree on
// purpose and a reader should see which one fired:
//
//   deviation — any holding is more than N points off its target
//   band      — any holding has left its own tolerance band
//   calendar  — a fixed period has elapsed, drift or no drift
//   risk      — the weights still look right but the risk behind them moved
//
// The last one is the interesting case. A holding can sit exactly on its 30%
// target while its volatility doubles, and no weight-based rule will ever
// notice. See risk-attribution.ts for where the risk shares come from.
//
// Nothing here executes anything. A plan is a proposal.

import { allocateMoney, roundMoney, subtractMoney } from '@/lib/utils/money'
import { riskContributions, type RiskContribution } from './risk-attribution'
import { parametricVaR } from './var'
import { validateWeights } from './validation'
import { scenarioFromEstimates, scenarioMoments, type ScenarioSpec } from './scenario-engine'

export type Holding = { symbol: string; value: number }
export type TargetWeight = { symbol: string; targetWeight: number }

export type RebalanceMode = 'deviation' | 'band' | 'calendar' | 'always'
export type RebalanceTrigger = 'deviation' | 'band' | 'calendar' | 'risk' | 'none'
export type CalendarFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export type RebalanceAction = {
  symbol: string
  targetWeight: number
  currentWeight: number
  /** Current minus target, in percentage points. Positive means overweight. */
  deviationPp: number
  targetValue: number
  currentValue: number
  /** Positive to buy, negative to sell. */
  tradeValue: number
  action: 'buy' | 'sell' | 'hold'
}

export type RebalancePlan = {
  actions: RebalanceAction[]
  totalValue: number
  triggered: boolean
  trigger: RebalanceTrigger
  /** Share of the book that changes hands, as a percentage. */
  turnoverPct: number
  reason: string
}

export type PlanOptions = {
  mode: RebalanceMode
  /** For 'deviation': drift in percentage points that triggers a rebalance. */
  thresholdPp?: number
  /** For 'band': half-width of the tolerance band, in percentage points. */
  bandPp?: number
}

const HOLD_EPSILON = 0.005 // half a cent — below this a trade is not worth naming

function emptyPlan(reason: string, totalValue = 0): RebalancePlan {
  return { actions: [], totalValue, triggered: false, trigger: 'none', turnoverPct: 0, reason }
}

/**
 * Work out what it would take to bring a book back to its target weights.
 *
 * Target values are split with allocateMoney rather than multiplied one at a
 * time, so the targets add back up to the book exactly and the trades net to
 * zero — a rebalance moves money between holdings, it does not create or
 * destroy any, and a plan whose trades do not net out is a plan that quietly
 * asks the user for a deposit.
 */
export function planRebalance(
  holdings: Holding[],
  targets: TargetWeight[],
  options: PlanOptions,
): RebalancePlan {
  const totalValue = holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0)

  // Reasons are what the rebalance panel shows, so they are written for the
  // reader, in Spanish — the validation module's own messages are diagnostics.
  const weightCheck = validateWeights(targets.map((t) => t.targetWeight))
  if (!weightCheck.valid) {
    const total = targets.reduce((sum, t) => sum + (Number.isFinite(t.targetWeight) ? t.targetWeight : 0), 0)
    const negative = targets.some((t) => t.targetWeight < 0)
    return emptyPlan(
      negative
        ? 'No se puede planear el rebalanceo: un peso objetivo es negativo, lo que exigiría vender en corto.'
        : `No se puede planear el rebalanceo: los pesos objetivo suman ${(total * 100).toFixed(1)}% en lugar de 100%.`,
      totalValue,
    )
  }

  if (totalValue <= 0) {
    return emptyPlan('Este portafolio todavía no tiene nada que rebalancear.', totalValue)
  }

  const valueBySymbol = new Map(holdings.map((h) => [h.symbol, h.value]))
  const targetBySymbol = new Map(targets.map((t) => [t.symbol, t.targetWeight]))
  // A holding with no target is an exit, and a target with no holding is a new
  // buy; both belong in the plan.
  const symbols = [...new Set([...targetBySymbol.keys(), ...valueBySymbol.keys()])]

  const targetValues = allocateMoney(
    totalValue,
    symbols.map((s) => targetBySymbol.get(s) ?? 0),
  )

  const actions: RebalanceAction[] = symbols.map((symbol, i) => {
    const currentValue = valueBySymbol.get(symbol) ?? 0
    const targetWeight = targetBySymbol.get(symbol) ?? 0
    const targetValue = targetValues[i]
    const tradeValue = subtractMoney(targetValue, currentValue)
    return {
      symbol,
      targetWeight,
      currentWeight: currentValue / totalValue,
      deviationPp: (currentValue / totalValue - targetWeight) * 100,
      targetValue,
      currentValue,
      tradeValue,
      action: tradeValue > HOLD_EPSILON ? 'buy' : tradeValue < -HOLD_EPSILON ? 'sell' : 'hold',
    }
  })

  actions.sort((a, b) => Math.abs(b.deviationPp) - Math.abs(a.deviationPp))

  const worst = actions[0]
  const worstDrift = worst ? Math.abs(worst.deviationPp) : 0

  const bought = actions.filter((a) => a.tradeValue > 0).reduce((s, a) => s + a.tradeValue, 0)
  const turnoverPct = (roundMoney(bought) / totalValue) * 100

  let triggered = false
  let trigger: RebalanceTrigger = 'none'
  let reason: string

  switch (options.mode) {
    case 'band': {
      const band = options.bandPp ?? 5
      triggered = worstDrift > band
      trigger = triggered ? 'band' : 'none'
      const low = ((worst?.targetWeight ?? 0) * 100 - band).toFixed(0)
      const high = ((worst?.targetWeight ?? 0) * 100 + band).toFixed(0)
      reason = triggered
        ? `${worst.symbol} está en ${(worst.currentWeight * 100).toFixed(1)}%, fuera de su banda de ${low}%-${high}%.`
        : `Todas las posiciones siguen dentro de su banda de ±${band} puntos; no hace falta mover nada.`
      break
    }
    case 'calendar':
      // The caller decides whether the date has come round; if it is asking for
      // a plan at all, the schedule has fired.
      triggered = true
      trigger = 'calendar'
      reason = 'Toca el rebalanceo programado. Estas operaciones devuelven los pesos objetivo.'
      break
    case 'always':
      triggered = true
      trigger = 'deviation'
      reason = 'Rebalanceo a los pesos objetivo, tal como se pidió.'
      break
    case 'deviation':
    default: {
      const threshold = options.thresholdPp ?? 5
      triggered = worstDrift > threshold
      trigger = triggered ? 'deviation' : 'none'
      reason = triggered
        ? `${worst.symbol} se desvió ${worst.deviationPp > 0 ? '+' : ''}${worst.deviationPp.toFixed(1)} puntos de su objetivo de ${(worst.targetWeight * 100).toFixed(0)}%.`
        : `El mayor desvío es de ${worstDrift.toFixed(1)} puntos, dentro del umbral de ${threshold} puntos.`
    }
  }

  return { actions, totalValue, triggered, trigger, turnoverPct, reason }
}

/**
 * The weights today's quantities had when a window began: current weights with
 * each holding's price growth over the window taken back out.
 *
 * Rebalancing to these undoes exactly what prices did since then. They are NOT
 * the weights the owner held at the time — positions opened later did not exist
 * yet — so anything showing them should speak of undoing price drift, not of
 * going back to a past portfolio. Null when a growth factor is missing or
 * nonsensical, rather than a vector that silently mis-scales one holding.
 */
export function driftTargets(currentWeights: number[], growth: number[]): number[] | null {
  if (currentWeights.length === 0 || growth.length !== currentWeights.length) return null
  if (!growth.every((g) => Number.isFinite(g) && g > 0)) return null
  if (!currentWeights.every((w) => Number.isFinite(w) && w >= 0)) return null
  const raw = currentWeights.map((w, i) => w / growth[i])
  const total = raw.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  return raw.map((w) => w / total)
}

const FREQUENCY_DAYS: Record<CalendarFrequency, number> = {
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
}

/**
 * Whether a calendar schedule has come round.
 *
 * No previous rebalance means the first one is due. An unparseable date means
 * not due — firing on every request because a stored value is malformed would
 * be worse than waiting for someone to notice.
 */
export function isCalendarDue(
  lastRebalance: string | null | undefined,
  frequency: CalendarFrequency,
  asOf: Date = new Date(),
): boolean {
  if (!lastRebalance) return true
  const last = Date.parse(lastRebalance)
  if (!Number.isFinite(last)) return false
  const elapsedDays = (asOf.getTime() - last) / 86_400_000
  return elapsedDays >= FREQUENCY_DAYS[frequency]
}

export type RiskShare = { symbol: string; weight: number; percentOfRisk: number }

export type RiskDrift = {
  triggered: boolean
  offenders: Array<{ symbol: string; weightPct: number; percentOfRisk: number; gapPp: number }>
  reason: string
}

/**
 * The case no weight-based rule catches: the money is where it should be, but
 * the risk is not.
 *
 * A holding sitting exactly on its 30% target can be carrying 62% of the book's
 * volatility after a jump in its own volatility or in how it correlates with
 * everything else. Rebalancing on weight alone would report nothing to do.
 */
export function detectRiskDrift(
  shares: RiskShare[],
  options: { thresholdPp?: number } = {},
): RiskDrift {
  const threshold = options.thresholdPp ?? 20
  const offenders = shares
    .map((s) => ({
      symbol: s.symbol,
      weightPct: s.weight * 100,
      percentOfRisk: s.percentOfRisk,
      gapPp: s.percentOfRisk - s.weight * 100,
    }))
    .filter((s) => s.gapPp > threshold)
    .sort((a, b) => b.gapPp - a.gapPp)

  if (offenders.length === 0) {
    return {
      triggered: false,
      offenders: [],
      reason: 'Cada posición aporta más o menos el riesgo que corresponde a su tamaño.',
    }
  }

  const worst = offenders[0]
  return {
    triggered: true,
    offenders,
    reason:
      `${worst.symbol} es ${worst.weightPct.toFixed(0)}% del dinero pero ${worst.percentOfRisk.toFixed(0)}% del riesgo. ` +
      'Su peso puede estar en objetivo: lo que cambió es su volatilidad o cómo se mueve con el resto del portafolio.',
  }
}


// ─── Rebalance simulator (P1-10) ────────────────────────────────────────────
//
// Executing a rebalance is easy. Knowing whether it is worth executing is not,
// because every rebalance is a trade: pulling weight out of what has run means
// less risk AND less expected return, and a reader who only sees the risk fall
// is being shown half the transaction.
//
// Nothing here executes anything.

export type PortfolioSnapshot = {
  weights: Record<string, number>
  expectedReturnPct: number
  volatilityPct: number
  sharpe: number | null
  /** Herfindahl index of the weights: 1 is everything in one holding. */
  hhi: number
  var95Pct: number
  /**
   * Beta against the portfolio's benchmark: the weighted sum of each holding's
   * own beta. Null when the caller had no benchmark series to measure against.
   */
  beta: number | null
  riskShare: RiskContribution[]
}

export type RebalanceSimulation = {
  before: PortfolioSnapshot
  after: PortfolioSnapshot
  /**
   * The two books as scenario-engine scenarios (4.9): what was compared is
   * exactly what a projection would run.
   */
  scenarios: { before: ScenarioSpec; after: ScenarioSpec }
  delta: {
    expectedReturnPp: number
    volatilityPp: number
    sharpe: number | null
    hhi: number
    var95Pp: number
    beta: number | null
  }
  plan: RebalancePlan
  summary: string
}

export type SimulationInputs = {
  /**
   * Annualised covariance matrix, ordered to match the `targets` array the
   * caller passes in — NOT the plan's action order, which is sorted by drift.
   */
  cov: number[][]
  /** Annual expected return per asset, as fractions, same ordering as `cov`. */
  expectedReturns: number[]
  riskFreeRate?: number
  /**
   * Each holding's beta against the benchmark, same ordering as `cov`. P1-10
   * lists beta among the before/after figures; a portfolio's beta is linear in
   * its weights, so it needs nothing more than these.
   */
  assetBetas?: number[] | null
}

/**
 * A book at given weights as a scenario of the scenario engine (4.9). The
 * rebalance panel used to carry its own tuple of weights, covariance and
 * expected returns; the engine's scenario is now the one definition of a book.
 */
function bookScenario(symbols: string[], weights: number[], inputs: SimulationInputs): ScenarioSpec {
  return scenarioFromEstimates({
    capital: 1,
    symbols,
    weights,
    cov: inputs.cov,
    expectedReturns: inputs.expectedReturns,
    source: 'Estimaciones servidas al panel de rebalanceo',
  })
}

function snapshot(
  symbols: string[],
  weights: number[],
  inputs: SimulationInputs,
): PortfolioSnapshot | null {
  // The engine reads the scenario's moments; the numbers are the ones the
  // panel always showed (a test pins them against the direct formulas).
  const moments = scenarioMoments(bookScenario(symbols, weights, inputs))
  if (!moments) return null
  const sigma = moments.volatility
  const expectedReturn = moments.expectedReturn
  const riskFreeRate = inputs.riskFreeRate ?? 0
  const attribution = riskContributions(symbols, weights, moments.cov)

  const weightMap: Record<string, number> = {}
  symbols.forEach((symbol, i) => {
    weightMap[symbol] = weights[i]
  })

  return {
    weights: weightMap,
    expectedReturnPct: expectedReturn * 100,
    volatilityPct: sigma * 100,
    sharpe: sigma > 1e-10 ? (expectedReturn - riskFreeRate) / sigma : null,
    hhi: weights.reduce((sum, w) => sum + w * w, 0),
    // A one-year horizon, so the figure is comparable with the annualised
    // volatility beside it rather than a daily number in disguise.
    var95Pct: (parametricVaR(expectedReturn, sigma, 95) ?? 0) * 100,
    beta:
      inputs.assetBetas && inputs.assetBetas.length === weights.length && inputs.assetBetas.every(Number.isFinite)
        ? weights.reduce((sum, w, i) => sum + w * inputs.assetBetas![i], 0)
        : null,
    riskShare: attribution?.contributions ?? [],
  }
}

/**
 * Show what a rebalance would do before anyone does it.
 *
 * The `before` side is the book as it stands; the `after` side is the same
 * covariance and the same expected returns at the target weights. Holding those
 * two inputs fixed is the point — it isolates the effect of the weights, which
 * is the only thing a rebalance actually changes.
 */
export function simulateRebalance(
  holdings: Holding[],
  targets: TargetWeight[],
  inputs: SimulationInputs,
): RebalanceSimulation | null {
  const plan = planRebalance(holdings, targets, { mode: 'always' })
  if (plan.actions.length === 0) return null

  // The ordering here is the caller's `targets` array, deliberately NOT the
  // plan's actions: those are sorted by drift, and a caller has no way to
  // predict that order when it builds the covariance matrix. Aligning the two
  // positionally silently transposed the matrix — before and after came out
  // swapped, which is exactly the kind of bug a simulation must not have.
  const symbols = targets.map((t) => t.symbol)
  if (inputs.cov.length !== symbols.length) return null
  if (inputs.cov.some((row) => row.length !== symbols.length)) return null
  if (inputs.expectedReturns.length !== symbols.length) return null

  const actionBySymbol = new Map(plan.actions.map((a) => [a.symbol, a]))
  // A holding with no target has no covariance row, so it cannot be modelled.
  if (symbols.some((symbol) => !actionBySymbol.has(symbol))) return null
  if (plan.actions.length !== symbols.length) return null

  const currentWeights = symbols.map((s) => actionBySymbol.get(s)!.currentWeight)
  const targetWeights = symbols.map((s) => actionBySymbol.get(s)!.targetWeight)

  const before = snapshot(symbols, currentWeights, inputs)
  const after = snapshot(symbols, targetWeights, inputs)
  if (!before || !after) return null

  const delta = {
    expectedReturnPp: after.expectedReturnPct - before.expectedReturnPct,
    volatilityPp: after.volatilityPct - before.volatilityPct,
    sharpe:
      before.sharpe === null || after.sharpe === null ? null : after.sharpe - before.sharpe,
    hhi: after.hhi - before.hhi,
    var95Pp: after.var95Pct - before.var95Pct,
    beta: before.beta === null || after.beta === null ? null : after.beta - before.beta,
  }

  return {
    before,
    after,
    scenarios: { before: bookScenario(symbols, currentWeights, inputs), after: bookScenario(symbols, targetWeights, inputs) },
    delta,
    plan,
    summary: summariseSimulation(delta, plan),
  }
}

function summariseSimulation(
  delta: RebalanceSimulation['delta'],
  plan: RebalancePlan,
): string {
  const risk =
    delta.volatilityPp < 0
      ? 'baja la volatilidad ' + Math.abs(delta.volatilityPp).toFixed(2) + ' puntos'
      : 'sube la volatilidad ' + delta.volatilityPp.toFixed(2) + ' puntos'

  const ret =
    delta.expectedReturnPp < 0
      ? 'y cede ' + Math.abs(delta.expectedReturnPp).toFixed(2) + ' puntos de rendimiento esperado'
      : 'y suma ' + delta.expectedReturnPp.toFixed(2) + ' puntos de rendimiento esperado'

  const sharpe =
    delta.sharpe === null
      ? ''
      : delta.sharpe > 0
        ? ' El Sharpe mejora ' + delta.sharpe.toFixed(3) + ', así que el intercambio sale a favor bajo estos supuestos.'
        : ' El Sharpe empeora ' + Math.abs(delta.sharpe).toFixed(3) + ', así que estás pagando más rendimiento del que ahorras en riesgo.'

  const concentration =
    delta.hhi < 0
      ? ' La concentración cae de ' + (delta.hhi < 0 ? '' : '') + 'forma medible (HHI ' + delta.hhi.toFixed(3) + ').'
      : ''

  return (
    'Mover ' +
    plan.turnoverPct.toFixed(1) +
    '% del portafolio ' +
    risk +
    ' ' +
    ret +
    '.' +
    sharpe +
    concentration +
    ' Ninguna operación se ha ejecutado: esto es una simulación.'
  )
}
