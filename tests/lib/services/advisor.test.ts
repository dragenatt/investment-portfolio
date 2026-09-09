import { describe, it, expect } from 'vitest'
import {
  ADVISOR_MODEL_VERSION,
  buildScenarios,
  evaluarPlan,
  probabilidadDeMeta,
  aporteParaProbabilidadMeta,
  auditarCartera,
  type PlanParams,
} from '@/lib/services/advisor'

const base: PlanParams = {
  capitalInicial: 50000,
  aportacionMensual: 1000,
  años: 10,
  rendimientoAnual: 0.07,
  volatilidadAnual: 0.1,
}

const scenarios = buildScenarios({ months: 120, simulations: 400, seed: 42 })

describe('buildScenarios', () => {
  it('produces the same shocks for the same seed', () => {
    const a = buildScenarios({ months: 12, simulations: 10, seed: 7 })
    const b = buildScenarios({ months: 12, simulations: 10, seed: 7 })
    expect(a.shocks).toEqual(b.shocks)
  })

  it('produces different shocks for a different seed', () => {
    const a = buildScenarios({ months: 12, simulations: 10, seed: 7 })
    const b = buildScenarios({ months: 12, simulations: 10, seed: 8 })
    expect(a.shocks).not.toEqual(b.shocks)
  })

  it('has the shape it was asked for', () => {
    const s = buildScenarios({ months: 24, simulations: 5, seed: 1 })
    expect(s.shocks).toHaveLength(5)
    expect(s.shocks[0]).toHaveLength(24)
  })

  it('draws finite standard normals', () => {
    const s = buildScenarios({ months: 60, simulations: 200, seed: 3 })
    const flat = s.shocks.flat()
    expect(flat.every(Number.isFinite)).toBe(true)
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length
    expect(Math.abs(mean)).toBeLessThan(0.1)
  })
})

describe('evaluarPlan — reproducibility and shape (P0-22, P0-23, P0-28)', () => {
  it('gives an identical answer for identical inputs', () => {
    expect(evaluarPlan(base, 500000, scenarios)).toEqual(evaluarPlan(base, 500000, scenarios))
  })

  it('orders the percentiles', () => {
    const { distribucion } = evaluarPlan(base, 500000, scenarios)
    expect(distribucion.p10).toBeLessThanOrEqual(distribucion.p25)
    expect(distribucion.p25).toBeLessThanOrEqual(distribucion.p50)
    expect(distribucion.p50).toBeLessThanOrEqual(distribucion.p75)
    expect(distribucion.p75).toBeLessThanOrEqual(distribucion.p90)
  })

  it('keeps the deterministic projection separate from the simulated ones', () => {
    const result = evaluarPlan(base, 500000, scenarios)
    expect(result.proyeccionDeterminista.valorFinal).toBeGreaterThan(0)
    expect(result.proyeccionDeterminista.valorFinal).not.toBe(result.distribucion.p50)
    expect(result.proyeccionDeterminista.capitalAportado).toBeCloseTo(50000 + 1000 * 120)
  })

  it('records the model version, seed and simulation count with the result', () => {
    const { modelo } = evaluarPlan(base, 500000, scenarios)
    expect(modelo.version).toBe(ADVISOR_MODEL_VERSION)
    expect(modelo.seed).toBe(42)
    expect(modelo.simulaciones).toBe(400)
    expect(modelo.volatilidadAnual).toBe(0.1)
    expect(modelo.rendimientoAnual).toBe(0.07)
  })

  it('reports every monetary figure to the cent', () => {
    const result = evaluarPlan(base, 500000, scenarios)
    const monies = [
      result.proyeccionDeterminista.valorFinal,
      result.proyeccionDeterminista.capitalAportado,
      result.proyeccionDeterminista.ganancia,
      result.distribucion.p10,
      result.distribucion.p50,
      result.distribucion.p90,
      result.distribucion.media,
    ]
    for (const value of monies) {
      expect(Math.round(value * 100) / 100).toBe(value)
    }
  })

  it('never produces a non-finite number', () => {
    const violent = { ...base, volatilidadAnual: 0.9, rendimientoAnual: 0.2 }
    const result = evaluarPlan(violent, 500000, scenarios)
    expect(Number.isFinite(result.distribucion.p10)).toBe(true)
    expect(Number.isFinite(result.distribucion.p90)).toBe(true)
    expect(Number.isFinite(result.probabilidadMetaPct!)).toBe(true)
  })

  it('never lets a simulated year lose more than everything', () => {
    // pow(1 + r, 1/12) with r below -100% is NaN, so the floor is not cosmetic
    const extreme = { ...base, volatilidadAnual: 2.5, rendimientoAnual: -0.5 }
    const result = evaluarPlan(extreme, 500000, scenarios)
    expect(Number.isFinite(result.distribucion.p10)).toBe(true)
    expect(result.distribucion.p10).toBeGreaterThanOrEqual(0)
  })

  it('reports the potential loss against what was actually put in', () => {
    const result = evaluarPlan(base, 500000, scenarios)
    expect(result.perdidaPotencial.escenarioP10).toBe(result.distribucion.p10)
    expect(result.perdidaPotencial.vsAportado).toBeCloseTo(
      result.distribucion.p10 - result.proyeccionDeterminista.capitalAportado,
      2,
    )
  })
})

describe('probabilidadDeMeta', () => {
  it('is a probability', () => {
    const p = probabilidadDeMeta(base, 500000, scenarios)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(100)
  })

  it('is certain for a goal already covered by the starting capital', () => {
    expect(probabilidadDeMeta(base, 1, scenarios)).toBe(100)
  })

  it('is hopeless for an absurd goal', () => {
    expect(probabilidadDeMeta(base, 1e12, scenarios)).toBe(0)
  })

  it('never falls when the contribution rises — the same shocks, more money', () => {
    // Monotonicity only holds because both runs reuse one scenario set. With
    // fresh randomness each call this can and did go backwards.
    let previous = -1
    for (const aportacionMensual of [500, 1000, 1500, 2000, 3000, 5000]) {
      const p = probabilidadDeMeta({ ...base, aportacionMensual }, 500000, scenarios)
      expect(p).toBeGreaterThanOrEqual(previous)
      previous = p
    }
  })

  it('never falls when the horizon lengthens at a positive expected return', () => {
    let previous = -1
    for (const años of [5, 10, 15, 20]) {
      const s = buildScenarios({ months: años * 12, simulations: 400, seed: 42 })
      const p = probabilidadDeMeta({ ...base, años }, 300000, s)
      expect(p).toBeGreaterThanOrEqual(previous)
      previous = p
    }
  })
})

describe('aporteParaProbabilidadMeta (P0-21)', () => {
  it('finds a contribution that actually reaches the target probability', () => {
    const aporte = aporteParaProbabilidadMeta(base, 800000, 75, scenarios)
    expect(aporte).not.toBeNull()
    const achieved = probabilidadDeMeta({ ...base, aportacionMensual: aporte! }, 800000, scenarios)
    expect(achieved).toBeGreaterThanOrEqual(75)
  })

  it('does not recommend more when the current contribution already suffices', () => {
    // The circular-recommendation regression from the roadmap
    const generous = { ...base, aportacionMensual: 20000 }
    const aporte = aporteParaProbabilidadMeta(generous, 800000, 75, scenarios)
    expect(aporte).not.toBeNull()
    expect(aporte!).toBeLessThanOrEqual(generous.aportacionMensual)
  })

  it('closes the loop: recommend, then feed the recommendation back in', () => {
    // $1,000 -> recommends X -> the user enters X -> the model must agree that X is enough
    const start = { ...base, aportacionMensual: 1000 }
    const recommended = aporteParaProbabilidadMeta(start, 800000, 75, scenarios)!
    expect(recommended).toBeGreaterThan(1000)

    const afterFollowing = { ...start, aportacionMensual: recommended }
    const probability = probabilidadDeMeta(afterFollowing, 800000, scenarios)
    expect(probability).toBeGreaterThanOrEqual(75)

    // And asking again must not move the goalposts
    const again = aporteParaProbabilidadMeta(afterFollowing, 800000, 75, scenarios)!
    expect(again).toBeLessThanOrEqual(recommended + 0.01)
  })

  it('needs less for a smaller goal', () => {
    const small = aporteParaProbabilidadMeta(base, 400000, 75, scenarios)!
    const large = aporteParaProbabilidadMeta(base, 900000, 75, scenarios)!
    expect(small).toBeLessThanOrEqual(large)
  })

  it('returns zero when the goal is already met with no contributions', () => {
    expect(aporteParaProbabilidadMeta(base, 1000, 75, scenarios)).toBe(0)
  })

  it('says it cannot be done rather than returning an absurd number', () => {
    expect(aporteParaProbabilidadMeta(base, 1e15, 95, scenarios)).toBeNull()
  })

  it('rejects a target probability outside 0-100', () => {
    expect(aporteParaProbabilidadMeta(base, 500000, 150, scenarios)).toBeNull()
    expect(aporteParaProbabilidadMeta(base, 500000, -5, scenarios)).toBeNull()
  })

  it('returns a contribution rounded to the cent', () => {
    const aporte = aporteParaProbabilidadMeta(base, 800000, 75, scenarios)!
    expect(Math.round(aporte * 100) / 100).toBe(aporte)
  })
})

describe('property: more never means less (P0-26)', () => {
  it('raising the contribution never lowers the median outcome', () => {
    let previous = -1
    for (const aportacionMensual of [0, 500, 1000, 2000, 4000]) {
      const { distribucion } = evaluarPlan({ ...base, aportacionMensual }, 500000, scenarios)
      expect(distribucion.p50).toBeGreaterThanOrEqual(previous)
      previous = distribucion.p50
    }
  })

  it('raising the starting capital never lowers the median outcome', () => {
    let previous = -1
    for (const capitalInicial of [0, 10000, 50000, 200000]) {
      const { distribucion } = evaluarPlan({ ...base, capitalInicial }, 500000, scenarios)
      expect(distribucion.p50).toBeGreaterThanOrEqual(previous)
      previous = distribucion.p50
    }
  })

  it('comparing two plans uses the same shocks', () => {
    // Same scenario set, one input changed: the difference is the input, not luck
    const a = evaluarPlan({ ...base, aportacionMensual: 1000 }, 500000, scenarios)
    const b = evaluarPlan({ ...base, aportacionMensual: 1000 }, 500000, scenarios)
    expect(a.distribucion).toEqual(b.distribucion)
  })
})

describe('auditarCartera (P0-25)', () => {
  const cartera = { CETES: 0.2, Bonos: 0.2, 'ETF S&P500': 0.35, 'ETF Nasdaq': 0.15, FIBRAS: 0.1 }

  it('passes a well-formed allocation', () => {
    const audit = auditarCartera(cartera, 100000, 5000)
    expect(audit.valid).toBe(true)
    expect(audit.problems).toEqual([])
  })

  it('splits the capital so the parts add back up exactly', () => {
    const audit = auditarCartera(cartera, 100000, 5000)
    const capital = audit.asignaciones.reduce((s, a) => s + a.capital, 0)
    const monthly = audit.asignaciones.reduce((s, a) => s + a.aportacionMensual, 0)
    expect(capital).toBe(100000)
    expect(monthly).toBe(5000)
  })

  it('rejects weights that do not sum to 100%', () => {
    const audit = auditarCartera({ A: 0.5, B: 0.3 }, 100000, 5000)
    expect(audit.valid).toBe(false)
    expect(audit.problems.join(' ')).toMatch(/100%|sum/i)
  })

  it('rejects a negative weight', () => {
    const audit = auditarCartera({ A: 1.4, B: -0.4 }, 100000, 5000)
    expect(audit.valid).toBe(false)
    expect(audit.problems.join(' ')).toMatch(/negative/i)
  })

  it('rejects an empty allocation', () => {
    expect(auditarCartera({}, 100000, 5000).valid).toBe(false)
  })

  it('rejects negative money', () => {
    expect(auditarCartera(cartera, -100, 5000).valid).toBe(false)
    expect(auditarCartera(cartera, 100000, -1).valid).toBe(false)
  })
})
