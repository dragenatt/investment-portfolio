import { describe, it, expect } from 'vitest'
import {
  explicarRecomendacion,
  viabilidadAportacion,
  invertirVsAhorrar,
  AFFORDABILITY_BANDS,
} from '@/lib/services/advisor-explain'
import { buildScenarios, evaluarPlan, type PlanParams } from '@/lib/services/advisor'

const params: PlanParams = {
  capitalInicial: 50_000,
  aportacionMensual: 5_000,
  años: 20,
  rendimientoAnual: 0.08,
  volatilidadAnual: 0.15,
}

const scenarios = buildScenarios({ months: 240, simulations: 500, seed: 42 })
const outcome = evaluarPlan(params, 3_000_000, scenarios)

// ─── D1 — why did I get this recommendation ─────────────────────────────────

describe('explicarRecomendacion', () => {
  it('covers every factor the roadmap names', () => {
    const result = explicarRecomendacion(params, outcome, 3_000_000)!
    const ids = result.factores.map((f) => f.id)
    expect(ids).toContain('horizonte')
    expect(ids).toContain('riesgo')
    expect(ids).toContain('aportacion')
    expect(ids).toContain('probabilidad')
  })

  it('quotes the user own numbers, not generic prose', () => {
    // "Your horizon is 20 years", not "a long horizon favours equities".
    const result = explicarRecomendacion(params, outcome, 3_000_000)!
    const horizonte = result.factores.find((f) => f.id === 'horizonte')!
    expect(horizonte.valor).toContain('20')
    const aportacion = result.factores.find((f) => f.id === 'aportacion')!
    expect(aportacion.valor).toMatch(/5[.,]?000/)
  })

  it('changes what it says when the horizon changes', () => {
    const corto = explicarRecomendacion({ ...params, años: 2 }, outcome, 3_000_000)!
    const largo = explicarRecomendacion({ ...params, años: 30 }, outcome, 3_000_000)!
    const de = (r: typeof corto) => r.factores.find((f) => f.id === 'horizonte')!.porque
    expect(de(corto)).not.toBe(de(largo))
  })

  it('says every factor both what it is and why it matters', () => {
    const result = explicarRecomendacion(params, outcome, 3_000_000)!
    for (const factor of result.factores) {
      expect(factor.valor.length).toBeGreaterThan(0)
      expect(factor.porque.length).toBeGreaterThan(30)
    }
  })

  it('reports the model version, so an old explanation can be told apart', () => {
    const result = explicarRecomendacion(params, outcome, 3_000_000)!
    expect(result.modelo.version).toBe(outcome!.modelo.version)
  })

  it('works without a goal, reporting probability as not applicable', () => {
    const result = explicarRecomendacion(params, outcome, null)!
    const prob = result.factores.find((f) => f.id === 'probabilidad')!
    expect(prob.valor.toLowerCase()).toMatch(/n\/d|sin meta/)
  })

  it('refuses when there is no outcome to explain', () => {
    expect(explicarRecomendacion(params, null, 3_000_000)).toBeNull()
  })
})

// ─── D2 — can the user actually afford this ─────────────────────────────────

describe('viabilidadAportacion', () => {
  it('reports the contribution as a share of income', () => {
    const result = viabilidadAportacion(5_000, 25_000)!
    expect(result.porcentajeDelIngreso).toBeCloseTo(20, 6)
  })

  it('does not warn at a share most people manage', () => {
    expect(viabilidadAportacion(2_500, 25_000)!.nivel).toBe('comodo')
  })

  it('warns when the contribution eats most of the income', () => {
    const result = viabilidadAportacion(20_000, 25_000)!
    expect(result.nivel).toBe('inviable')
    expect(result.advertencia).not.toBeNull()
  })

  it('never hides the mathematical answer', () => {
    // The roadmap is explicit: never conceal the figure the maths produced,
    // however unaffordable it is.
    const result = viabilidadAportacion(40_000, 25_000)!
    expect(result.aportacionMatematica).toBe(40_000)
  })

  it('offers the four ways out rather than one rule', () => {
    const result = viabilidadAportacion(20_000, 25_000)!
    const text = result.alternativas.join(' ').toLowerCase()
    expect(text).toMatch(/plazo/)
    expect(text).toMatch(/meta/)
    expect(text).toMatch(/ingreso/)
    expect(text).toMatch(/estrategia/)
  })

  it('offers no alternatives when the plan is comfortable', () => {
    expect(viabilidadAportacion(2_000, 25_000)!.alternativas).toEqual([])
  })

  it('imposes no universal rule, and says so', () => {
    // A 30% savings rate is heroic for one household and trivial for another.
    const result = viabilidadAportacion(7_500, 25_000)!
    expect(result.nota.toLowerCase()).toMatch(/no hay|depende|regla/)
  })

  it('declines to judge when income is unknown', () => {
    const result = viabilidadAportacion(5_000, null)!
    expect(result.nivel).toBe('desconocido')
    expect(result.porcentajeDelIngreso).toBeNull()
    expect(result.aportacionMatematica).toBe(5_000)
  })

  it('refuses a non-positive income rather than dividing by it', () => {
    expect(viabilidadAportacion(5_000, 0)!.nivel).toBe('desconocido')
    expect(viabilidadAportacion(5_000, -100)!.nivel).toBe('desconocido')
  })

  it('has bands that run in order and cover everything', () => {
    for (let i = 1; i < AFFORDABILITY_BANDS.length; i++) {
      expect(AFFORDABILITY_BANDS[i].upTo).toBeGreaterThan(AFFORDABILITY_BANDS[i - 1].upTo)
    }
    expect(AFFORDABILITY_BANDS[AFFORDABILITY_BANDS.length - 1].upTo).toBe(Infinity)
  })

  it('never emits a non-finite percentage', () => {
    const result = viabilidadAportacion(5_000, 25_000)!
    expect(Number.isFinite(result.porcentajeDelIngreso!)).toBe(true)
  })
})

// ─── D4 — investing versus just saving ──────────────────────────────────────

describe('invertirVsAhorrar', () => {
  it('has both paths pay in exactly the same money', () => {
    // If the contributions differ the comparison is meaningless.
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.ahorro.aportado).toBeCloseTo(result.inversion.aportado, 2)
  })

  it('grows the saved pile by nothing at all', () => {
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.ahorro.valorFinal).toBeCloseTo(result.ahorro.aportado, 2)
    expect(result.ahorro.crecimiento).toBeCloseTo(0, 6)
  })

  it('reports the gap between the two', () => {
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.diferencia).toBeCloseTo(
      result.inversion.valorFinal - result.ahorro.valorFinal,
      2,
    )
  })

  it('separates the money paid in from the money compounding produced', () => {
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.inversion.crecimiento).toBeCloseTo(
      result.inversion.valorFinal - result.inversion.aportado,
      2,
    )
  })

  it('shows the pessimistic case too, not only the median', () => {
    // The whole difference between saving and investing is that one of them
    // can go wrong. Showing only the median hides exactly that.
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.inversionPesimista).not.toBeNull()
    expect(result.inversionPesimista!.valorFinal).toBeLessThan(result.inversion.valorFinal)
  })

  it('says plainly that investing adds risk and the return is an estimate', () => {
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.advertencia.toLowerCase()).toMatch(/riesgo/)
    expect(result.advertencia.toLowerCase()).toMatch(/estimaci|supuesto/)
  })

  it('admits when the pessimistic case loses to plain saving', () => {
    const malo = evaluarPlan(
      { ...params, rendimientoAnual: 0.01, volatilidadAnual: 0.35 },
      null,
      scenarios,
    )
    const result = invertirVsAhorrar(
      { ...params, rendimientoAnual: 0.01, volatilidadAnual: 0.35 },
      malo,
    )!
    if (result.inversionPesimista!.valorFinal < result.ahorro.valorFinal) {
      expect(result.resumen.toLowerCase()).toMatch(/peor|por debajo|menos que/)
    }
  })

  it('never emits a non-finite number', () => {
    const result = invertirVsAhorrar(params, outcome)!
    for (const value of [
      result.ahorro.valorFinal,
      result.inversion.valorFinal,
      result.diferencia,
    ]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('refuses when there is no outcome', () => {
    expect(invertirVsAhorrar(params, null)).toBeNull()
  })

  it('is deterministic', () => {
    expect(invertirVsAhorrar(params, outcome)).toEqual(invertirVsAhorrar(params, outcome))
  })
})

describe('money formatting in prose', () => {
  it('puts a currency symbol on figures inside the text', () => {
    // Found by reading the rendered page: the explanation said "termina en
    // 1,879,771" while the card beside it said "$17,189". Ambiguous on its own
    // and worse sitting next to percentages in the same sentence.
    const result = explicarRecomendacion(params, outcome, 3_000_000)!
    const aportacion = result.factores.find((f) => f.id === 'aportacion')!
    expect(aportacion.valor).toContain('$')
    expect(aportacion.porque).toContain('$')
  })

  it('does the same in the savings comparison', () => {
    const result = invertirVsAhorrar(params, outcome)!
    expect(result.resumen).toContain('$')
  })

  it('does the same in the affordability warning', () => {
    const result = viabilidadAportacion(20_000, 25_000)!
    expect(result.advertencia).toContain('$')
  })
})
