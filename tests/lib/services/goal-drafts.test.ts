import { describe, it, expect } from 'vitest'
import { goalDraftFromAdvisor, planParamsForGoal, targetDateFor } from '@/lib/services/goal-drafts'
import { buildScenarios, evaluarPlan, aporteParaProbabilidadMeta, type PlanParams } from '@/lib/services/advisor'
import { CreateGoalSchema, CreateProjectionSchema } from '@/lib/schemas/goal'

const today = new Date('2026-09-16T15:00:00Z')

describe('targetDateFor', () => {
  it('counts whole months, not days times 365', () => {
    expect(targetDateFor(new Date('2026-09-16T00:00:00Z'), 10)).toBe('2036-09-16')
    expect(targetDateFor(new Date('2026-09-16T00:00:00Z'), 2.5)).toBe('2029-03-16')
  })

  it('clamps a day that does not exist in the landing month', () => {
    // 31 January plus one month is the end of February, not 3 March.
    expect(targetDateFor(new Date('2026-01-31T00:00:00Z'), 1 / 12)).toBe('2026-02-28')
  })
})

describe('goalDraftFromAdvisor', () => {
  const params: PlanParams = { capitalInicial: 100_000, aportacionMensual: 1_000, años: 10, rendimientoAnual: 0.07, volatilidadAnual: 0.1 }
  const scenarios = buildScenarios({ months: 120, simulations: 500, seed: 11 })
  const outcome = evaluarPlan(params, 1_000_000, scenarios)
  const required = aporteParaProbabilidadMeta(params, 1_000_000, 75, scenarios)

  const draft = goalDraftFromAdvisor({
    name: '  Retiro  ',
    currency: 'MXN',
    riskProfile: 'Moderado',
    params,
    target: 1_000_000,
    outcome,
    requiredContribution: required,
    today,
  })!

  it('saves the plan that was on screen', () => {
    expect(draft.goal).toMatchObject({
      name: 'Retiro',
      target_amount: 1_000_000,
      currency: 'MXN',
      start_date: '2026-09-16',
      target_date: '2036-09-16',
      starting_capital: 100_000,
      monthly_contribution: 1_000,
      risk_profile: 'Moderado',
      expected_annual_return: 0.07,
      expected_annual_volatility: 0.1,
    })
  })

  it('records the answer with the version and seed that produced it', () => {
    expect(draft.projection).toMatchObject({
      model_version: outcome.modelo.version,
      seed: 11,
      simulations: 500,
      horizon_months: 120,
      probability_pct: outcome.probabilidadMetaPct,
      p10_final: outcome.distribucion.p10,
      p50_final: outcome.distribucion.p50,
      p90_final: outcome.distribucion.p90,
      deterministic_final: outcome.proyeccionDeterminista.valorFinal,
      required_contribution: required,
    })
  })

  it('produces records the API schemas accept as they are', () => {
    expect(CreateGoalSchema.safeParse(draft.goal).success).toBe(true)
    expect(CreateProjectionSchema.safeParse(draft.projection).success).toBe(true)
  })

  it('has no goal to save without a target, a horizon or a name', () => {
    const base = { name: 'x', currency: 'MXN' as const, riskProfile: null, params, outcome, requiredContribution: null, today }
    expect(goalDraftFromAdvisor({ ...base, target: 0 })).toBeNull()
    expect(goalDraftFromAdvisor({ ...base, target: 1000, params: { ...params, años: 0 } })).toBeNull()
    expect(goalDraftFromAdvisor({ ...base, target: 1000, name: '   ' })).toBeNull()
  })

  it('never passes a non-finite number on to the database', () => {
    const broken = goalDraftFromAdvisor({
      name: 'x', currency: 'USD', riskProfile: null, params, target: 1000, today,
      outcome: { ...outcome, probabilidadMetaPct: Number.NaN },
      requiredContribution: Number.POSITIVE_INFINITY,
    })!
    expect(broken.projection.probability_pct).toBeNull()
    expect(broken.projection.required_contribution).toBeNull()
  })
})

describe('planParamsForGoal', () => {
  const goal = {
    starting_capital: 50_000,
    monthly_contribution: 2_000,
    start_date: '2024-09-16',
    target_date: '2034-09-16',
    expected_annual_return: 0.07,
    expected_annual_volatility: 0.1,
  }

  it('asks about the time that is left, from the balance that exists now', () => {
    const p = planParamsForGoal(goal, today, 120_000)!
    expect(p.capitalInicial).toBe(120_000)
    expect(p.años).toBeCloseTo(8, 1)
    expect(p.aportacionMensual).toBe(2_000)
  })

  it('falls back to the starting capital when there is no tracked balance', () => {
    expect(planParamsForGoal(goal, today, null)!.capitalInicial).toBe(50_000)
  })

  it('has nothing to recalculate once the target date has passed, or without assumptions', () => {
    expect(planParamsForGoal({ ...goal, target_date: '2026-01-01' }, today, null)).toBeNull()
    expect(planParamsForGoal({ ...goal, expected_annual_return: null }, today, null)).toBeNull()
  })
})

import { projectionForGoal, seedForGoal } from '@/lib/services/goal-drafts'
import * as advisor from '@/lib/services/advisor'

describe('projectionForGoal', () => {
  const goal = {
    id: 'a3c1f0e2-0000-4000-8000-000000000001',
    target_amount: 500_000,
    starting_capital: 50_000,
    monthly_contribution: 3_000,
    start_date: '2024-09-16',
    target_date: '2034-09-16',
    expected_annual_return: 0.07,
    expected_annual_volatility: 0.1,
  }

  it('gives the same goal the same shocks every time it is recalculated', () => {
    expect(seedForGoal(goal.id)).toBe(seedForGoal(goal.id))
    expect(seedForGoal(goal.id)).not.toBe(seedForGoal('a3c1f0e2-0000-4000-8000-000000000002'))
    const a = projectionForGoal(goal, today, 120_000, advisor)!
    const b = projectionForGoal(goal, today, 120_000, advisor)!
    expect(a).toEqual(b)
  })

  it('attributes a change in probability to the balance, not to luck', () => {
    // Same seed, more money today: the probability can only go up.
    const poorer = projectionForGoal(goal, today, 60_000, advisor)!
    const richer = projectionForGoal(goal, today, 200_000, advisor)!
    expect(richer.probability_pct!).toBeGreaterThanOrEqual(poorer.probability_pct!)
  })

  it('writes a record the API accepts', () => {
    expect(CreateProjectionSchema.safeParse(projectionForGoal(goal, today, 120_000, advisor)).success).toBe(true)
  })

  it('has nothing to project after the target date', () => {
    expect(projectionForGoal({ ...goal, target_date: '2026-01-01' }, today, null, advisor)).toBeNull()
  })
})
