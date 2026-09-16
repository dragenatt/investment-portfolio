// Turning an advisor analysis into a goal someone can come back to.
//
// The advisor answered "will I get there?" and the answer vanished when the page
// closed: the goals table, its RLS, its CRUD API and its tracking maths all
// existed, and nothing ever wrote a row. This is the bridge — pure, so what gets
// saved is exactly what was on screen and a test can prove it.
//
// Two records, because migration 014 keeps them apart on purpose. The GOAL is
// the plan and will be edited. The PROJECTION is what the model said about that
// plan on this date, with the version and seed that produced it, and is never
// edited — a later recalculation appends a new one beside it.

import type { PlanOutcome, PlanParams } from './advisor'
import type { CreateGoalInput } from '@/lib/schemas/goal'

export type RiskProfileName = 'Conservador' | 'Moderado' | 'Agresivo'

export type ProjectionInput = {
  model_version: string
  seed: number | null
  simulations: number | null
  target_amount: number
  starting_capital: number
  monthly_contribution: number
  horizon_months: number
  expected_annual_return: number | null
  expected_annual_volatility: number | null
  probability_pct: number | null
  deterministic_final: number | null
  p10_final: number | null
  p50_final: number | null
  p90_final: number | null
  required_contribution: number | null
}

export type GoalDraftInput = {
  name: string
  description?: string
  portfolioId?: string | null
  currency: 'MXN' | 'USD' | 'EUR'
  riskProfile: RiskProfileName | null
  params: PlanParams
  target: number
  outcome: PlanOutcome
  requiredContribution: number | null
  /** The day the plan starts. Injected so a test does not depend on the clock. */
  today: Date
}

/** YYYY-MM-DD in UTC. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The date a plan of `years` ends, counted from `start`.
 *
 * Whole months rather than days × 365: a ten-year plan started on 31 January
 * should end in January ten years later, not drift by the leap days in between.
 */
export function targetDateFor(start: Date, years: number): string {
  const months = Math.max(1, Math.round(years * 12))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  end.setUTCMonth(end.getUTCMonth() + months)
  // Keep the day of month, clamped to the length of the landing month.
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay))
  return isoDate(end)
}

/** A finite number, or null. Nothing non-finite may reach the database. */
function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null
}

/**
 * The goal and its first projection, from one advisor run.
 *
 * Returns null when the run had no goal to save: a target of zero is an
 * exploration of growth, not a goal, and the goals table requires a positive
 * target for exactly that reason.
 */
export function goalDraftFromAdvisor(input: GoalDraftInput): { goal: CreateGoalInput; projection: ProjectionInput } | null {
  const { params, outcome } = input
  if (!Number.isFinite(input.target) || input.target <= 0) return null
  if (!Number.isFinite(params.años) || params.años <= 0) return null

  const name = input.name.trim().slice(0, 120)
  if (!name) return null

  const startDate = isoDate(input.today)
  const goal: CreateGoalInput = {
    name,
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 1000) } : {}),
    portfolio_id: input.portfolioId ?? null,
    target_amount: input.target,
    currency: input.currency,
    start_date: startDate,
    target_date: targetDateFor(input.today, params.años),
    starting_capital: Math.max(0, params.capitalInicial),
    monthly_contribution: Math.max(0, params.aportacionMensual),
    ...(input.riskProfile ? { risk_profile: input.riskProfile } : {}),
    expected_annual_return: params.rendimientoAnual,
    expected_annual_volatility: params.volatilidadAnual,
  }

  const projection: ProjectionInput = {
    model_version: outcome.modelo.version,
    seed: finiteOrNull(outcome.modelo.seed),
    simulations: finiteOrNull(outcome.modelo.simulaciones),
    target_amount: input.target,
    starting_capital: goal.starting_capital,
    monthly_contribution: goal.monthly_contribution,
    horizon_months: outcome.modelo.meses,
    expected_annual_return: finiteOrNull(params.rendimientoAnual),
    expected_annual_volatility: finiteOrNull(params.volatilidadAnual),
    probability_pct: finiteOrNull(outcome.probabilidadMetaPct),
    deterministic_final: finiteOrNull(outcome.proyeccionDeterminista.valorFinal),
    p10_final: finiteOrNull(outcome.distribucion.p10),
    p50_final: finiteOrNull(outcome.distribucion.p50),
    p90_final: finiteOrNull(outcome.distribucion.p90),
    required_contribution: finiteOrNull(input.requiredContribution),
  }

  return { goal, projection }
}

/**
 * The advisor inputs that reproduce a saved goal, for a recalculation.
 *
 * Months remaining rather than the original horizon: recalculating a ten-year
 * goal two years in asks about the eight years left, from today's balance.
 */
export function planParamsForGoal(goal: {
  starting_capital: number
  monthly_contribution: number
  start_date: string
  target_date: string
  expected_annual_return: number | null
  expected_annual_volatility: number | null
}, today: Date, currentValue: number | null): PlanParams | null {
  const end = Date.parse(`${goal.target_date}T00:00:00Z`)
  if (!Number.isFinite(end)) return null
  const monthsLeft = Math.round((end - today.getTime()) / (365.25 / 12) / 86_400_000)
  if (monthsLeft < 1) return null
  if (goal.expected_annual_return === null || goal.expected_annual_volatility === null) return null

  return {
    capitalInicial: currentValue !== null && Number.isFinite(currentValue) ? Math.max(0, currentValue) : goal.starting_capital,
    aportacionMensual: goal.monthly_contribution,
    años: monthsLeft / 12,
    rendimientoAnual: goal.expected_annual_return,
    volatilidadAnual: goal.expected_annual_volatility,
  }
}

/** Simulations per recalculation: the same count the advisor runs. */
export const RECALCULATION_SIMULATIONS = 1000
/** The probability a recalculation solves the required contribution for. */
export const RECALCULATION_TARGET_PCT = 75

/**
 * A stable seed per goal.
 *
 * Every recalculation of the same goal draws the same shocks, so when the
 * probability moves between two projections it moved because the balance, the
 * contribution or the time left changed — not because a different set of coin
 * flips came up. That is common random numbers across runs, the thing P0-23
 * asks for, applied to the one place where runs are compared over time.
 */
export function seedForGoal(goalId: string): number {
  let hash = 2166136261
  for (let i = 0; i < goalId.length; i++) {
    hash ^= goalId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * A fresh projection for a saved goal, from where it stands today.
 *
 * Null when there is nothing to project: the target date has passed, or the
 * goal was saved without the return assumptions a projection needs.
 */
export function projectionForGoal(
  goal: Parameters<typeof planParamsForGoal>[0] & { id: string; target_amount: number },
  today: Date,
  currentValue: number | null,
  engine: {
    buildScenarios: typeof import('./advisor').buildScenarios
    evaluarPlan: typeof import('./advisor').evaluarPlan
    aporteParaProbabilidadMeta: typeof import('./advisor').aporteParaProbabilidadMeta
  },
): ProjectionInput | null {
  const params = planParamsForGoal(goal, today, currentValue)
  if (!params) return null

  const target = Number(goal.target_amount)
  const scenarios = engine.buildScenarios({
    months: Math.round(params.años * 12),
    simulations: RECALCULATION_SIMULATIONS,
    seed: seedForGoal(goal.id),
  })
  const outcome = engine.evaluarPlan(params, target, scenarios)
  const required = engine.aporteParaProbabilidadMeta(params, target, RECALCULATION_TARGET_PCT, scenarios)

  return {
    model_version: outcome.modelo.version,
    seed: finiteOrNull(outcome.modelo.seed),
    simulations: finiteOrNull(outcome.modelo.simulaciones),
    target_amount: target,
    starting_capital: params.capitalInicial,
    monthly_contribution: params.aportacionMensual,
    horizon_months: Math.max(1, outcome.modelo.meses),
    expected_annual_return: finiteOrNull(params.rendimientoAnual),
    expected_annual_volatility: finiteOrNull(params.volatilidadAnual),
    probability_pct: finiteOrNull(outcome.probabilidadMetaPct),
    deterministic_final: finiteOrNull(outcome.proyeccionDeterminista.valorFinal),
    p10_final: finiteOrNull(outcome.distribucion.p10),
    p50_final: finiteOrNull(outcome.distribucion.p50),
    p90_final: finiteOrNull(outcome.distribucion.p90),
    required_contribution: finiteOrNull(required),
  }
}
