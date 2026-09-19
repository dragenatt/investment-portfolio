import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  advisorScenarios,
  aporteParaProbabilidadMeta,
  buildScenarios,
  evaluarPlan,
  ADVISOR_SEED,
  ADVISOR_SIMULATIONS,
  type PlanParams,
} from '@/lib/services/advisor'
import { RENDIMIENTOS, VOLATILIDADES, type PerfilNivel } from '@/lib/utils/investment-profile'

// 5.1 (P0-23) — two advisor runs that are compared share their draws. Before,
// the seed was hashed from capital, contribution, horizon, goal and profile, so
// $1,000 and $2,000 a month were scored on different luck. Synthetic plans only.

const META = 400_000
const OBJETIVO = 75

/** One advisor run, the way the page makes it. */
function run(aportacionMensual: number, horizonte = 15, nivel: PerfilNivel = 1) {
  const params: PlanParams = {
    capitalInicial: 10_000,
    aportacionMensual,
    años: horizonte,
    rendimientoAnual: RENDIMIENTOS[nivel],
    volatilidadAnual: VOLATILIDADES[nivel],
  }
  const scenarios = advisorScenarios(horizonte)
  return {
    scenarios,
    plan: evaluarPlan(params, META, scenarios),
    aporteNec: aporteParaProbabilidadMeta(params, META, OBJETIVO, scenarios),
  }
}

describe('comparing $1,000 with $2,000 a month', () => {
  const mil = run(1_000)
  const dosMil = run(2_000)

  it('scores both runs on the same underlying shocks', () => {
    expect(dosMil.scenarios.shocks).toEqual(mil.scenarios.shocks)
    expect(mil.plan.modelo.seed).toBe(ADVISOR_SEED)
    expect(dosMil.plan.modelo.seed).toBe(ADVISOR_SEED)
    expect(mil.plan.modelo.simulaciones).toBe(ADVISOR_SIMULATIONS)
  })

  it('so the larger contribution is better on every percentile, not just on average', () => {
    // Path by path the $2,000 plan ends higher, so every order statistic is
    // higher too. On different draws that holds only in expectation.
    const a = mil.plan.distribucion
    const b = dosMil.plan.distribucion
    for (const k of ['min', 'p10', 'p25', 'p50', 'p75', 'p90', 'max'] as const) {
      expect(b[k]).toBeGreaterThan(a[k])
    }
    expect(dosMil.plan.probabilidadMetaPct!).toBeGreaterThanOrEqual(mil.plan.probabilidadMetaPct!)
  })
})

describe('the draws depend on nothing the user varies', () => {
  it('uses the same paths for any profile', () => {
    expect(run(1_000, 15, 0).scenarios.shocks).toEqual(run(1_000, 15, 2).scenarios.shocks)
  })

  it('extends the same paths for a longer horizon', () => {
    const quince = advisorScenarios(15)
    const veinte = advisorScenarios(20)
    expect(veinte.seed).toBe(quince.seed)
    veinte.shocks.forEach((path, i) => expect(path.slice(0, 180)).toEqual(quince.shocks[i]))
  })

  it('is the draw of the documented example', () => {
    expect(advisorScenarios(20)).toEqual(buildScenarios({ months: 240, simulations: 1000, seed: 20260912 }))
  })
})

describe('the recommendation holds across runs (P0-21)', () => {
  it('reaches the target when the recommended contribution is entered in a new run', () => {
    const first = run(1_000)
    expect(first.plan.probabilidadMetaPct!).toBeLessThan(OBJETIVO)
    const recomendada = first.aporteNec!
    expect(recomendada).toBeGreaterThan(1_000)

    // The user types the recommended amount and runs the advisor again. On the
    // same draws the model agrees, and does not ask for more.
    const second = run(recomendada)
    expect(second.plan.probabilidadMetaPct!).toBeGreaterThanOrEqual(OBJETIVO)
    expect(Math.abs(second.aporteNec! - recomendada)).toBeLessThanOrEqual(0.02)
  })
})

describe('the advisor page', () => {
  it('asks for the advisor draw instead of seeding its own', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/(app)/advisor/page.tsx'), 'utf8')
    expect(page).toContain('advisorScenarios(horizonte)')
    expect(page).not.toMatch(/\bseed\s*:/)
    expect(page).not.toMatch(/\bbuildScenarios\(/)
  })
})
