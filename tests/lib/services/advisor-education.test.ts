import { describe, it, expect } from 'vitest'
import {
  explicacionEducativa,
  CONCEPTOS_REQUERIDOS,
  PROCEDENCIA_ETIQUETAS,
  type Educacion,
} from '@/lib/services/advisor-education'
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

// A deliberately different plan, for the invariance tests below.
const otroParams: PlanParams = {
  capitalInicial: 5_000,
  aportacionMensual: 800,
  años: 4,
  rendimientoAnual: 0.03,
  volatilidadAnual: 0.05,
}
const otrosScenarios = buildScenarios({ months: 48, simulations: 500, seed: 7 })
const otroOutcome = evaluarPlan(otroParams, 100_000, otrosScenarios)

const cartera = { CETES: 0.2, Bonos: 0.2, 'ETF S&P500': 0.35, 'ETF Nasdaq': 0.15, FIBRAS: 0.1 }

const get = (e: Educacion, id: string) => e.conceptos.find((c) => c.id === id)!

// ─── coverage ───────────────────────────────────────────────────────────────

describe('explicacionEducativa — what it covers', () => {
  it('explains every concept the roadmap names', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const ids = result.conceptos.map((c) => c.id)
    for (const required of CONCEPTOS_REQUERIDOS) {
      expect(ids).toContain(required)
    }
  })

  it('covers the eleven and nothing extra, in a stable order', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(result.conceptos.map((c) => c.id)).toEqual([...CONCEPTOS_REQUERIDOS])
  })

  it('gives every concept a definition, a reason it matters, and the usual misreading', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    for (const concepto of result.conceptos) {
      expect(concepto.termino.length).toBeGreaterThan(0)
      expect(concepto.definicion.length).toBeGreaterThan(30)
      expect(concepto.porQueImporta.length).toBeGreaterThan(30)
      expect(concepto.errorComun.length).toBeGreaterThan(30)
    }
  })

  it('refuses when there is no outcome to teach against', () => {
    expect(explicacionEducativa(params, null, 3_000_000)).toBeNull()
  })

  it('is deterministic', () => {
    expect(explicacionEducativa(params, outcome, 3_000_000)).toEqual(
      explicacionEducativa(params, outcome, 3_000_000),
    )
  })
})

// ─── the separation the roadmap asks for ────────────────────────────────────

describe('model result kept apart from educational explanation', () => {
  it('does not change a single word of the teaching when the plan changes', () => {
    // This is the whole point of D3. The explanation of what volatility IS
    // cannot depend on the user's volatility, or it stops being education and
    // becomes another way of restating the result.
    const a = explicacionEducativa(params, outcome, 3_000_000)!
    const b = explicacionEducativa(otroParams, otroOutcome, 100_000, { cartera })!

    const teaching = (e: Educacion) =>
      e.conceptos.map((c) => [c.id, c.termino, c.definicion, c.porQueImporta, c.errorComun])

    expect(teaching(a)).toEqual(teaching(b))
  })

  it('does change the plan-specific half when the plan changes', () => {
    const a = explicacionEducativa(params, outcome, 3_000_000)!
    const b = explicacionEducativa(otroParams, otroOutcome, 100_000)!
    expect(get(a, 'horizonte').enTuPlan!.valor).not.toBe(get(b, 'horizonte').enTuPlan!.valor)
    expect(get(a, 'aportacion').enTuPlan!.valor).not.toBe(get(b, 'aportacion').enTuPlan!.valor)
  })

  it('never lets a figure from the plan leak into the teaching text', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    for (const concepto of result.conceptos) {
      const teaching = `${concepto.definicion} ${concepto.porQueImporta} ${concepto.errorComun}`
      expect(teaching).not.toContain('$')
      // 240 months, 20 years, 8%, 15%, 500 simulations, seed 42 — none of them.
      expect(teaching).not.toMatch(/\b(240|3,000,000|50,000|5,000)\b/)
    }
  })

  it('says out loud that this block explains rather than predicts', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(result.aviso.toLowerCase()).toMatch(/educat|explica/)
    expect(result.aviso.toLowerCase()).toMatch(/no cambia|no modifica|no altera/)
  })
})

// ─── provenance ─────────────────────────────────────────────────────────────

describe('every figure labelled by where it came from', () => {
  it('uses only provenance labels it can name', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000, { cartera })!
    for (const concepto of result.conceptos) {
      if (!concepto.enTuPlan) continue
      expect(PROCEDENCIA_ETIQUETAS[concepto.enTuPlan.procedencia]).toBeTruthy()
    }
  })

  it('calls the expected return and the volatility assumptions, not observations', () => {
    // They come from the profile's model portfolio in investment-profile.ts.
    // Nothing measured them on this user's holdings.
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'rendimiento-esperado').enTuPlan!.procedencia).toBe('supuesto')
    expect(get(result, 'volatilidad').enTuPlan!.procedencia).toBe('supuesto')
  })

  it('calls the percentiles, the probability and the compounding model results', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'percentiles').enTuPlan!.procedencia).toBe('resultado')
    expect(get(result, 'probabilidad').enTuPlan!.procedencia).toBe('resultado')
    expect(get(result, 'interes-compuesto').enTuPlan!.procedencia).toBe('resultado')
    expect(get(result, 'monte-carlo').enTuPlan!.procedencia).toBe('resultado')
    expect(get(result, 'riesgo').enTuPlan!.procedencia).toBe('resultado')
  })

  it('calls the horizon and the contribution things the user supplied', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'horizonte').enTuPlan!.procedencia).toBe('dato')
    expect(get(result, 'aportacion').enTuPlan!.procedencia).toBe('dato')
  })
})

// ─── the plan-specific figures ──────────────────────────────────────────────

describe('what each concept says about this particular plan', () => {
  it('quotes the horizon in years', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'horizonte').enTuPlan!.valor).toContain('20')
  })

  it('quotes the contribution with its currency symbol', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'aportacion').enTuPlan!.valor).toContain('$')
  })

  it('shows all five percentiles the roadmap lists', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const valor = get(result, 'percentiles').enTuPlan!.valor
    for (const p of ['P10', 'P25', 'P50', 'P75', 'P90']) {
      expect(valor).toContain(p)
    }
  })

  it('reports the trajectories and the seed, so the run can be reproduced', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const valor = get(result, 'monte-carlo').enTuPlan!.valor
    expect(valor).toContain('500')
    expect(valor).toContain('42')
  })

  it('separates the money paid in from the money compounding produced', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const valor = get(result, 'interes-compuesto').enTuPlan!.valor
    expect(valor).toContain('$')
    // Both halves named, not just the flattering one.
    expect(valor.match(/\$/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('says which side of what was paid in the bad scenario lands on', () => {
    // Found by reading the rendered card: "terminas con $1,879,771, $869,771
    // frente a lo aportado" reads equally like a gain and like a shortfall, and
    // on the risk concept the sign is the entire meaning.
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const valor = get(result, 'riesgo').enTuPlan!.valor
    expect(valor).toMatch(/por (encima|debajo) de lo aportado/)
  })

  it('calls a shortfall a shortfall', () => {
    // A plan that cannot recover what goes into it.
    const malo: PlanParams = { ...params, rendimientoAnual: -0.05, volatilidadAnual: 0.3 }
    const salida = evaluarPlan(malo, null, scenarios)!
    expect(salida.perdidaPotencial.vsAportado).toBeLessThan(0)
    const result = explicacionEducativa(malo, salida, null)!
    expect(get(result, 'riesgo').enTuPlan!.valor).toContain('por debajo de lo aportado')
  })

  it('never prints a bare minus sign next to the side it already named', () => {
    const malo: PlanParams = { ...params, rendimientoAnual: -0.05, volatilidadAnual: 0.3 }
    const salida = evaluarPlan(malo, null, scenarios)!
    const valor = get(explicacionEducativa(malo, salida, null)!, 'riesgo').enTuPlan!.valor
    expect(valor).not.toContain('-$')
  })

  it('says there is no probability to report when there is no goal', () => {
    const sinMeta = evaluarPlan(params, null, scenarios)
    const result = explicacionEducativa(params, sinMeta, null)!
    expect(get(result, 'probabilidad').enTuPlan!.procedencia).toBe('no-aplica')
    expect(get(result, 'probabilidad').enTuPlan!.valor.toLowerCase()).toMatch(/meta/)
  })
})

// ─── the two inputs that may be absent ──────────────────────────────────────

describe('risk-free rate', () => {
  it('says plainly that this projection does not use one', () => {
    // The advisor projects a single return path. It never discounts against a
    // risk-free rate, and pretending otherwise would be a made-up input.
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    const tasa = get(result, 'tasa-libre')
    expect(tasa.enTuPlan!.procedencia).toBe('no-aplica')
    expect(tasa.enTuPlan!.valor.toLowerCase()).toMatch(/no (entra|se usa|participa)/)
  })

  it('reports an observed rate when the caller has one, and cites it', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000, {
      tasaLibre: { anualPct: 9.75, fuente: 'CETES 28 dias (Banxico)' },
    })!
    const tasa = get(result, 'tasa-libre')
    expect(tasa.enTuPlan!.procedencia).toBe('dato')
    expect(tasa.enTuPlan!.valor).toContain('9.75')
    expect(tasa.enTuPlan!.valor).toContain('CETES')
  })

  it('refuses a non-finite rate rather than printing it', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000, {
      tasaLibre: { anualPct: Number.NaN, fuente: 'roto' },
    })!
    expect(get(result, 'tasa-libre').enTuPlan!.procedencia).toBe('no-aplica')
  })
})

describe('diversification', () => {
  it('counts the asset classes in the model portfolio and names the largest', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000, { cartera })!
    const valor = get(result, 'diversificacion').enTuPlan!.valor
    expect(valor).toContain('5')
    expect(valor).toContain('35')
    expect(get(result, 'diversificacion').enTuPlan!.procedencia).toBe('supuesto')
  })

  it('invents nothing when no portfolio was supplied', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000)!
    expect(get(result, 'diversificacion').enTuPlan!.procedencia).toBe('no-aplica')
  })

  it('ignores an empty portfolio rather than dividing by nothing', () => {
    const result = explicacionEducativa(params, outcome, 3_000_000, { cartera: {} })!
    expect(get(result, 'diversificacion').enTuPlan!.procedencia).toBe('no-aplica')
  })
})

// ─── nothing invalid reaches the interface ──────────────────────────────────

describe('validity', () => {
  it('never prints NaN or Infinity', () => {
    for (const opciones of [
      undefined,
      { cartera },
      { tasaLibre: { anualPct: 9.75, fuente: 'CETES' } },
    ]) {
      const result = explicacionEducativa(params, outcome, 3_000_000, opciones)!
      for (const concepto of result.conceptos) {
        const text = `${concepto.definicion} ${concepto.porQueImporta} ${concepto.errorComun} ${concepto.enTuPlan?.valor ?? ''}`
        expect(text).not.toMatch(/NaN|Infinity|undefined|null/)
      }
    }
  })

  it('survives a zero-contribution, zero-capital plan', () => {
    const vacio: PlanParams = { ...params, capitalInicial: 0, aportacionMensual: 0 }
    const salida = evaluarPlan(vacio, 1_000, scenarios)
    const result = explicacionEducativa(vacio, salida, 1_000)!
    expect(result.conceptos).toHaveLength(CONCEPTOS_REQUERIDOS.length)
    for (const concepto of result.conceptos) {
      expect(concepto.enTuPlan?.valor ?? '').not.toMatch(/NaN|Infinity/)
    }
  })
})
