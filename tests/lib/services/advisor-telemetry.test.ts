import { describe, it, expect, vi } from 'vitest'
import {
  revisarResultado,
  construirDiagnostico,
  registrarDiagnostico,
  UMBRAL_LENTO_MS,
  type DiagnosticoAdvisor,
} from '@/lib/services/advisor-telemetry'
import {
  buildScenarios,
  evaluarPlan,
  type PlanParams,
  type PlanOutcome,
} from '@/lib/services/advisor'
import { etapasIniciales } from '@/lib/services/advisor-progress'

const params: PlanParams = {
  capitalInicial: 50_000,
  aportacionMensual: 5_000,
  años: 20,
  rendimientoAnual: 0.07,
  volatilidadAnual: 0.1,
}

const scenarios = buildScenarios({ months: 240, simulations: 500, seed: 4242 })
const outcome = evaluarPlan(params, 3_000_000, scenarios)

const cartera = { CETES: 0.2, Bonos: 0.2, 'ETF S&P500': 0.35, 'ETF Nasdaq': 0.15, FIBRAS: 0.1 }

const codigos = (o: PlanOutcome, extra = {}) =>
  revisarResultado(o, { cartera, duracionMs: 100, ...extra }).map((h) => h.codigo)

// ─── a healthy run ──────────────────────────────────────────────────────────

describe('revisarResultado on a sound plan', () => {
  it('finds nothing wrong', () => {
    expect(revisarResultado(outcome, { cartera, duracionMs: 100 })).toEqual([])
  })
})

// ─── the seven the roadmap names ────────────────────────────────────────────

describe('detects an invalid probability', () => {
  it('catches one above 100', () => {
    const roto = { ...outcome, probabilidadMetaPct: 140 }
    expect(codigos(roto)).toContain('probabilidad-invalida')
  })

  it('catches a negative one', () => {
    expect(codigos({ ...outcome, probabilidadMetaPct: -3 })).toContain('probabilidad-invalida')
  })

  it('accepts a missing one, which is how "no goal" is said', () => {
    expect(codigos({ ...outcome, probabilidadMetaPct: null })).toEqual([])
  })
})

describe('detects an impossible return', () => {
  it('catches a total return below a total loss', () => {
    const roto = {
      ...outcome,
      proyeccionDeterminista: { ...outcome.proyeccionDeterminista, rentabilidadTotalPct: -150 },
    }
    expect(codigos(roto)).toContain('retorno-imposible')
  })

  it('catches a volatility that must be a unit error', () => {
    const roto = { ...outcome, modelo: { ...outcome.modelo, volatilidadAnual: 900 } }
    expect(codigos(roto)).toContain('volatilidad-implausible')
  })
})

describe('detects broken weights', () => {
  it('catches a portfolio that does not sum to 100%', () => {
    expect(codigos(outcome, { cartera: { A: 0.5, B: 0.2 } })).toContain('pesos-invalidos')
  })

  it('catches a negative weight', () => {
    expect(codigos(outcome, { cartera: { A: 1.2, B: -0.2 } })).toContain('pesos-invalidos')
  })

  it('does not complain when no portfolio was supplied', () => {
    expect(revisarResultado(outcome, { duracionMs: 100 })).toEqual([])
  })
})

describe('detects NaN and Infinity anywhere in the result', () => {
  it('catches a NaN buried in the distribution', () => {
    const roto = { ...outcome, distribucion: { ...outcome.distribucion, p50: Number.NaN } }
    expect(codigos(roto)).toContain('numero-invalido')
  })

  it('catches an Infinity in the deterministic projection', () => {
    const roto = {
      ...outcome,
      proyeccionDeterminista: {
        ...outcome.proyeccionDeterminista,
        valorFinal: Number.POSITIVE_INFINITY,
      },
    }
    expect(codigos(roto)).toContain('numero-invalido')
  })

  it('reports where it found it, so it can be chased', () => {
    const roto = { ...outcome, distribucion: { ...outcome.distribucion, p50: Number.NaN } }
    const hallazgo = revisarResultado(roto, { duracionMs: 100 }).find(
      (h) => h.codigo === 'numero-invalido',
    )!
    expect(hallazgo.ruta).toContain('p50')
  })
})

describe('detects an empty Monte Carlo', () => {
  it('catches a run with no simulations at all', () => {
    const roto = { ...outcome, modelo: { ...outcome.modelo, simulaciones: 0 } }
    expect(codigos(roto)).toContain('monte-carlo-vacio')
  })

  it('catches a run with no months', () => {
    expect(codigos({ ...outcome, modelo: { ...outcome.modelo, meses: 0 } })).toContain(
      'monte-carlo-vacio',
    )
  })

  it('catches a distribution that collapsed despite real volatility', () => {
    // Every path landing on the same number means the shocks never applied.
    const plano = 1_000_000
    const roto = {
      ...outcome,
      distribucion: {
        ...outcome.distribucion,
        p10: plano,
        p25: plano,
        p50: plano,
        p75: plano,
        p90: plano,
      },
    }
    expect(codigos(roto)).toContain('distribucion-degenerada')
  })

  it('allows a flat distribution when volatility really is zero', () => {
    const sinRiesgo = evaluarPlan({ ...params, volatilidadAnual: 0 }, null, scenarios)
    expect(codigos(sinRiesgo)).not.toContain('distribucion-degenerada')
  })
})

describe('detects percentiles out of order', () => {
  it('catches a median below the tenth percentile', () => {
    const roto = { ...outcome, distribucion: { ...outcome.distribucion, p50: 1 } }
    expect(codigos(roto)).toContain('percentiles-desordenados')
  })
})

describe('detects abnormal timing', () => {
  it('flags a run slower than the threshold', () => {
    expect(codigos(outcome, { duracionMs: UMBRAL_LENTO_MS + 1 })).toContain('tiempo-anormal')
  })

  it('says nothing about a normal one', () => {
    expect(codigos(outcome, { duracionMs: UMBRAL_LENTO_MS - 1 })).not.toContain('tiempo-anormal')
  })

  it('flags a negative duration, which means the clock was misread', () => {
    expect(codigos(outcome, { duracionMs: -5 })).toContain('tiempo-anormal')
  })
})

// ─── the record ─────────────────────────────────────────────────────────────

describe('construirDiagnostico', () => {
  const etapas = etapasIniciales().map((e, i) => ({ ...e, estado: 'lista' as const, ms: i * 10 }))
  const diagnostico = construirDiagnostico({ outcome, cartera, etapas })

  it('records the version, the simulation count and the horizon', () => {
    expect(diagnostico.version).toBe(outcome.modelo.version)
    expect(diagnostico.simulaciones).toBe(outcome.modelo.simulaciones)
    expect(diagnostico.meses).toBe(outcome.modelo.meses)
  })

  it('records the total duration as the sum of the stages', () => {
    expect(diagnostico.duracionMs).toBe(0 + 10 + 20 + 30 + 40)
  })

  it('keeps each stage with its own timing', () => {
    expect(diagnostico.etapas).toHaveLength(5)
    expect(diagnostico.etapas.every((e) => typeof e.ms === 'number')).toBe(true)
  })

  it('is ok when nothing was found', () => {
    expect(diagnostico.ok).toBe(true)
    expect(diagnostico.hallazgos).toEqual([])
  })

  it('is not ok when something was', () => {
    const roto = construirDiagnostico({
      outcome: { ...outcome, probabilidadMetaPct: 400 },
      cartera,
      etapas,
    })
    expect(roto.ok).toBe(false)
  })

  it('records a stage that failed', () => {
    const conFallo = etapas.map((e) =>
      e.id === 'simulando' ? { ...e, estado: 'fallida' as const } : e,
    )
    const d = construirDiagnostico({ outcome, cartera, etapas: conFallo })
    expect(d.hallazgos.map((h) => h.codigo)).toContain('etapa-fallida')
    expect(d.ok).toBe(false)
  })
})

// ─── the privacy requirement ────────────────────────────────────────────────

describe('what the record must never contain', () => {
  // "No registrar informacion financiera sensible innecesaria." The strongest
  // form of that: put distinctive amounts into the plan and prove none of them
  // survives anywhere in the serialised record.
  const distintivo: PlanParams = {
    capitalInicial: 987_654,
    aportacionMensual: 13_579,
    años: 20,
    rendimientoAnual: 0.07,
    volatilidadAnual: 0.1,
  }
  const conMontos = evaluarPlan(distintivo, 24_681_012, scenarios)
  const etapas = etapasIniciales().map((e) => ({ ...e, estado: 'lista' as const, ms: 5 }))
  const serializado = JSON.stringify(
    construirDiagnostico({ outcome: conMontos, cartera, etapas }),
  )

  it.each([
    ['capital', '987654'],
    ['contribution', '13579'],
    ['goal', '24681012'],
  ])('does not carry the %s', (_, monto) => {
    expect(serializado).not.toContain(monto)
  })

  it('does not carry any projected value either', () => {
    expect(serializado).not.toContain(String(Math.round(conMontos.distribucion.p50)))
    expect(serializado).not.toContain(String(Math.round(conMontos.proyeccionDeterminista.valorFinal)))
  })

  it('still carries what is needed to interpret a run', () => {
    const d: DiagnosticoAdvisor = JSON.parse(serializado)
    expect(d.version).toBeTruthy()
    expect(d.simulaciones).toBeGreaterThan(0)
    expect(typeof d.duracionMs).toBe('number')
  })
})

// ─── the one side effect ────────────────────────────────────────────────────

describe('registrarDiagnostico', () => {
  it('says nothing when the run was clean', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const etapas = etapasIniciales().map((e) => ({ ...e, estado: 'lista' as const, ms: 1 }))
    registrarDiagnostico(construirDiagnostico({ outcome, cartera, etapas }))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns once when something was found', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const etapas = etapasIniciales().map((e) => ({ ...e, estado: 'lista' as const, ms: 1 }))
    registrarDiagnostico(
      construirDiagnostico({
        outcome: { ...outcome, probabilidadMetaPct: 400 },
        cartera,
        etapas,
      }),
    )
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
