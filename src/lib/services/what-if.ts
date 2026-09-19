// "What would happen if..." — pure functions, no I/O.
//
// A transversal tool rather than another engine: it composes the ones that
// already exist (risk attribution, tail risk, the seeded advisor scenarios) so
// that one change can be seen across every dimension at once, instead of the
// reader having to hold four separate screens in their head.
//
// Two rules make the answers trustworthy. Both sides are computed from the SAME
// covariance and the SAME scenario set, so a difference is the change and not a
// different roll of the dice. And nothing here recommends: it reports what moved
// in which direction and leaves the judgement where it belongs.
//
// The Scenario shape here is deliberately the one roadmap P2-9 will need for the
// reusable scenario engine; this is its first consumer, not a parallel one.

import { portfolioVolatility, riskContributions, type RiskContribution } from './risk-attribution'
import { parametricVaR } from './var'
import {
  evaluarPlan,
  probabilidadDeMeta,
  type ScenarioSet,
  type PlanParams,
} from './advisor'

export type ScenarioHolding = { symbol: string; value: number }

export type ScenarioPlan = {
  aportacionMensual: number
  años: number
  meta: number
}

export type Scenario = {
  holdings: ScenarioHolding[]
  /** Annual expected return per holding, ordered as `holdings`. */
  expectedReturns: number[]
  /** Annualised covariance matrix, ordered as `holdings`. */
  cov: number[][]
  riskFreeRate?: number
  /** Optional: a goal to measure the book against. */
  plan?: ScenarioPlan
}

export type WhatIfChange = {
  /** Replace the weights outright. Must cover only held symbols and sum to 1. */
  weights?: Record<string, number>
  /** Drop these holdings and spread their weight over the rest, pro rata. */
  removeSymbols?: string[]
  aportacionMensual?: number
  años?: number
  meta?: number
  capitalInicial?: number
  /** Add this to every holding's expected return, in fractions. */
  expectedReturnShift?: number
  /** Scale the whole covariance matrix. 1.5 means half again as volatile. */
  volatilityMultiplier?: number
}

export type ScenarioSnapshot = {
  totalValue: number
  weights: Record<string, number>
  expectedReturnPct: number
  volatilityPct: number
  sharpe: number | null
  hhi: number
  var95Pct: number
  riskShare: RiskContribution[]
  goalProbabilityPct: number | null
  finalValueMedian: number | null
  finalValueP10: number | null
}

export type WhatIfResult = {
  before: ScenarioSnapshot
  after: ScenarioSnapshot
  delta: {
    expectedReturnPp: number
    volatilityPp: number
    sharpe: number | null
    hhi: number
    var95Pp: number
    goalProbabilityPp: number | null
  }
  changed: boolean
}

const WEIGHT_TOLERANCE = 1e-3

function scaleMatrix(cov: number[][], factor: number): number[][] {
  return cov.map((row) => row.map((v) => v * factor))
}

function snapshot(
  symbols: string[],
  weights: number[],
  expectedReturns: number[],
  cov: number[][],
  totalValue: number,
  riskFreeRate: number,
  plan: (ScenarioPlan & { capitalInicial: number }) | null,
  scenarios: ScenarioSet,
): ScenarioSnapshot | null {
  const sigma = portfolioVolatility(weights, cov)
  if (sigma === null) return null

  const expectedReturn = weights.reduce((sum, w, i) => sum + w * (expectedReturns[i] ?? 0), 0)
  const attribution = riskContributions(symbols, weights, cov)

  const weightMap: Record<string, number> = {}
  symbols.forEach((symbol, i) => {
    weightMap[symbol] = weights[i]
  })

  let goalProbabilityPct: number | null = null
  let finalValueMedian: number | null = null
  let finalValueP10: number | null = null

  if (plan) {
    // The book's own expected return and volatility drive the projection, so a
    // change to the weights shows up in the goal probability too — which is the
    // connection this tool exists to make visible.
    const params: PlanParams = {
      capitalInicial: plan.capitalInicial,
      aportacionMensual: plan.aportacionMensual,
      años: plan.años,
      rendimientoAnual: expectedReturn,
      volatilidadAnual: sigma,
    }
    const outcome = evaluarPlan(params, plan.meta, scenarios)
    goalProbabilityPct = probabilidadDeMeta(params, plan.meta, scenarios)
    finalValueMedian = outcome.distribucion.p50
    finalValueP10 = outcome.distribucion.p10
  }

  return {
    totalValue,
    weights: weightMap,
    expectedReturnPct: expectedReturn * 100,
    volatilityPct: sigma * 100,
    sharpe: sigma > 1e-10 ? (expectedReturn - riskFreeRate) / sigma : null,
    hhi: weights.reduce((sum, w) => sum + w * w, 0),
    // A one-year horizon, so it sits on the same scale as the annualised
    // volatility beside it.
    var95Pct: (parametricVaR(expectedReturn, sigma, 95) ?? 0) * 100,
    riskShare: attribution?.contributions ?? [],
    goalProbabilityPct,
    finalValueMedian,
    finalValueP10,
  }
}

/**
 * Apply one change to a scenario and report both sides.
 *
 * Returns null rather than a best-effort answer when the change does not
 * describe a valid portfolio — weights that miss 100%, a symbol the book does
 * not hold, a covariance matrix that does not match. A what-if built on an
 * impossible book teaches the wrong thing with total confidence.
 */
export function whatIf(
  scenario: Scenario,
  change: WhatIfChange,
  scenarios: ScenarioSet,
): WhatIfResult | null {
  const symbols = scenario.holdings.map((h) => h.symbol)
  const n = symbols.length
  if (n === 0) return null
  if (scenario.cov.length !== n || scenario.cov.some((row) => row.length !== n)) return null
  if (scenario.expectedReturns.length !== n) return null

  const totalValue = scenario.holdings.reduce((sum, h) => sum + (h.value || 0), 0)
  if (totalValue <= 0) return null

  const baseWeights = scenario.holdings.map((h) => h.value / totalValue)
  const riskFreeRate = scenario.riskFreeRate ?? 0

  // ── Work out the "after" weights ─────────────────────────────────────────
  let afterWeights = [...baseWeights]

  if (change.removeSymbols && change.removeSymbols.length > 0) {
    const removed = new Set(change.removeSymbols)
    const kept = symbols.map((s) => !removed.has(s))
    const keptWeight = baseWeights.reduce((sum, w, i) => sum + (kept[i] ? w : 0), 0)
    if (keptWeight <= 0) return null
    // The freed weight is spread pro rata, which is what actually happens when
    // someone sells one holding and leaves the proceeds in the others.
    afterWeights = baseWeights.map((w, i) => (kept[i] ? w / keptWeight : 0))
  }

  if (change.weights) {
    const unknown = Object.keys(change.weights).filter((s) => !symbols.includes(s))
    if (unknown.length > 0) return null

    afterWeights = symbols.map((s) => change.weights![s] ?? 0)
    const total = afterWeights.reduce((a, b) => a + b, 0)
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) return null
    if (afterWeights.some((w) => w < 0 || !Number.isFinite(w))) return null
  }

  // ── Work out the "after" assumptions ─────────────────────────────────────
  const shift = change.expectedReturnShift ?? 0
  if (!Number.isFinite(shift)) return null
  const afterReturns = scenario.expectedReturns.map((r) => r + shift)

  const multiplier = change.volatilityMultiplier ?? 1
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null
  // Variance scales with the square of a volatility multiplier.
  const afterCov = multiplier === 1 ? scenario.cov : scaleMatrix(scenario.cov, multiplier * multiplier)

  // ── Work out the "after" plan ────────────────────────────────────────────
  const basePlan = scenario.plan
    ? { ...scenario.plan, capitalInicial: totalValue }
    : null
  const afterPlan = basePlan
    ? {
        capitalInicial: change.capitalInicial ?? basePlan.capitalInicial,
        aportacionMensual: change.aportacionMensual ?? basePlan.aportacionMensual,
        años: change.años ?? basePlan.años,
        meta: change.meta ?? basePlan.meta,
      }
    : null

  const before = snapshot(
    symbols,
    baseWeights,
    scenario.expectedReturns,
    scenario.cov,
    totalValue,
    riskFreeRate,
    basePlan,
    scenarios,
  )
  const after = snapshot(
    symbols,
    afterWeights,
    afterReturns,
    afterCov,
    change.capitalInicial ?? totalValue,
    riskFreeRate,
    afterPlan,
    scenarios,
  )
  if (!before || !after) return null

  // Compared field by field rather than by serialising: the two plan objects are
  // built in different key orders, so JSON.stringify reported every unchanged
  // scenario as changed.
  const planChanged =
    basePlan !== null &&
    afterPlan !== null &&
    (basePlan.capitalInicial !== afterPlan.capitalInicial ||
      basePlan.aportacionMensual !== afterPlan.aportacionMensual ||
      basePlan.años !== afterPlan.años ||
      basePlan.meta !== afterPlan.meta)

  const weightsChanged = baseWeights.some((w, i) => w !== afterWeights[i])

  const changed = weightsChanged || shift !== 0 || multiplier !== 1 || planChanged

  return {
    before,
    after,
    delta: {
      expectedReturnPp: after.expectedReturnPct - before.expectedReturnPct,
      volatilityPp: after.volatilityPct - before.volatilityPct,
      sharpe:
        before.sharpe === null || after.sharpe === null ? null : after.sharpe - before.sharpe,
      hhi: after.hhi - before.hhi,
      var95Pp: after.var95Pct - before.var95Pct,
      goalProbabilityPp:
        before.goalProbabilityPct === null || after.goalProbabilityPct === null
          ? null
          : after.goalProbabilityPct - before.goalProbabilityPct,
    },
    changed,
  }
}

/**
 * The change in words.
 *
 * States what moved and in which direction, and stops there. Naming a winner
 * would be answering a question about the reader's preferences that the model
 * has no access to.
 */
export function describeWhatIf(result: WhatIfResult): string {
  if (!result.changed) {
    return 'Este escenario no cambia nada respecto al portafolio actual, así que ninguna métrica se mueve.'
  }

  const { delta } = result

  const risk =
    Math.abs(delta.volatilityPp) < 0.01
      ? 'deja el riesgo prácticamente igual'
      : delta.volatilityPp < 0
        ? `baja la volatilidad ${Math.abs(delta.volatilityPp).toFixed(2)} puntos`
        : `sube la volatilidad ${delta.volatilityPp.toFixed(2)} puntos`

  const ret =
    Math.abs(delta.expectedReturnPp) < 0.01
      ? 'sin mover el rendimiento esperado'
      : delta.expectedReturnPp < 0
        ? `y cede ${Math.abs(delta.expectedReturnPp).toFixed(2)} puntos de rendimiento esperado`
        : `y suma ${delta.expectedReturnPp.toFixed(2)} puntos de rendimiento esperado`

  const goal =
    delta.goalProbabilityPp === null
      ? ''
      : Math.abs(delta.goalProbabilityPp) < 0.5
        ? ' La probabilidad de alcanzar tu meta no se mueve de forma apreciable.'
        : delta.goalProbabilityPp > 0
          ? ` La probabilidad de alcanzar tu meta sube ${delta.goalProbabilityPp.toFixed(1)} puntos.`
          : ` La probabilidad de alcanzar tu meta baja ${Math.abs(delta.goalProbabilityPp).toFixed(1)} puntos.`

  const concentration =
    Math.abs(delta.hhi) < 0.005
      ? ''
      : delta.hhi < 0
        ? ` También reparte mejor el portafolio (HHI ${delta.hhi.toFixed(3)}).`
        : ` También lo concentra más (HHI +${delta.hhi.toFixed(3)}).`

  return `Este cambio ${risk} ${ret}.${goal}${concentration} Nada de esto se ha ejecutado.`
}
