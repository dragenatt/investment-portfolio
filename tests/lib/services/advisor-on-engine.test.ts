import { describe, it, expect } from 'vitest'
import { buildScenarios, evaluarPlan, compararEstrategias, type PlanParams } from '@/lib/services/advisor'
import { runScenario, scenarioFromPlan, planDrift, planMonthFactor } from '@/lib/services/scenario-engine'

// 4.9 — the advisor on the scenario engine.
//
// The app had two Monte Carlo engines: the advisor's own generator and
// arithmetic monthly step, and the engine's correlated GBM that every other
// projection used. The same plan got two answers depending on the screen.
// Since model 3.0.0 the advisor steps the engine's draws with the engine's
// factor; these pin that the two cannot drift apart again.

const plans: PlanParams[] = [
  { capitalInicial: 50_000, aportacionMensual: 4_000, años: 20, rendimientoAnual: 0.07, volatilidadAnual: 0.1 },
  { capitalInicial: 0, aportacionMensual: 1_500, años: 10, rendimientoAnual: 0.1, volatilidadAnual: 0.16 },
  { capitalInicial: 200_000, aportacionMensual: 0, años: 5, rendimientoAnual: 0.04, volatilidadAnual: 0.03 },
]

describe('a plan gets one answer, whichever door it comes in by', () => {
  for (const plan of plans) {
    it(`${plan.años} years at ${plan.rendimientoAnual * 100}% / ${plan.volatilidadAnual * 100}%`, () => {
      const seed = 991
      const simulations = 500
      const advisor = evaluarPlan(plan, null, buildScenarios({ months: plan.años * 12, simulations, seed })).distribucion
      const engine = runScenario(scenarioFromPlan(plan, { seed, simulations }))
      if ('errors' in engine) throw new Error(engine.errors.join(' '))
      // Money is rounded to the cent on the advisor side; the engine is not.
      expect(advisor.p10).toBeCloseTo(engine.final.nominal.p10, 1)
      expect(advisor.p50).toBeCloseTo(engine.final.nominal.p50, 1)
      expect(advisor.p90).toBeCloseTo(engine.final.nominal.p90, 1)
      expect(advisor.media).toBeCloseTo(engine.final.nominal.mean, 1)
    })
  }
})

describe('the plan\'s stated return is its mean growth', () => {
  it('turns an effective annual return into the engine\'s continuous drift', () => {
    expect(Math.exp(planDrift(0.07))).toBeCloseTo(1.07, 12)
  })

  it('with no volatility, a year of months compounds to exactly 1 + r', () => {
    let growth = 1
    for (let m = 0; m < 12; m++) growth *= planMonthFactor(0.07, 0, 0)
    expect(growth).toBeCloseTo(1.07, 12)
  })

  it('never goes below zero, however large the shock', () => {
    expect(planMonthFactor(0.07, 0.5, -40)).toBeGreaterThan(0)
  })
})

describe('longer horizons extend the same paths', () => {
  it('a set drawn for more months starts with the months of the shorter one', () => {
    const short = buildScenarios({ months: 60, simulations: 50, seed: 3 })
    const long = buildScenarios({ months: 120, simulations: 50, seed: 3 })
    short.shocks.forEach((path, i) => expect(long.shocks[i].slice(0, 60)).toEqual(path))
  })

  it('so comparing horizons compares horizons, not luck', () => {
    // The plan's own option is reproduced exactly next to a longer one.
    const base = plans[0]
    const scenarios = buildScenarios({ months: 240, simulations: 300, seed: 5 })
    const plan = { aportacionMensual: base.aportacionMensual, años: base.años }
    const alone = compararEstrategias(base, 2_500_000, [plan], scenarios)
    const beside = compararEstrategias(base, 2_500_000, [plan, { aportacionMensual: base.aportacionMensual, años: 30 }], scenarios)
    expect(beside.opciones[0].mediana).toBe(alone.opciones[0].mediana)
  })
})
