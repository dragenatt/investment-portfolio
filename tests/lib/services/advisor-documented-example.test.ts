import { describe, it, expect } from 'vitest'
import {
  buildScenarios,
  evaluarPlan,
  aporteParaProbabilidadMeta,
  analizarSensibilidad,
  proyectarFechaMeta,
  bandasDeIncertidumbre,
  ADVISOR_MODEL_VERSION,
  type PlanParams,
} from '@/lib/services/advisor'
import {
  obtenerPerfilFinal,
  RENDIMIENTOS,
  VOLATILIDADES,
  CARTERAS,
} from '@/lib/utils/investment-profile'

/**
 * The worked example in docs/ADVISOR_FINANCIAL_MODEL.md.
 *
 * That document exists so the model can be reproduced without reading the code,
 * which only works while its figures are still the figures. This pins them.
 *
 * A failure here is not necessarily a bug: it means the model moved. Either the
 * change was unintended, or the version needs bumping and the document needs
 * regenerating. Both are things somebody should look at, which is the point.
 */

const perfil = obtenerPerfilFinal({
  edad: 30,
  ingresos: 40_000,
  riesgo: 5,
  horizonte: 20,
  experiencia: 2,
  estabilidad: 3,
  reaccion: 3,
  porcentajeInversion: 20,
})

const params: PlanParams = {
  capitalInicial: 50_000,
  aportacionMensual: 4_000,
  años: 20,
  rendimientoAnual: RENDIMIENTOS[perfil.nivel],
  volatilidadAnual: VOLATILIDADES[perfil.nivel],
}

const META = 2_500_000
const scenarios = buildScenarios({ months: 240, simulations: 1_000, seed: 20260912 })
const plan = evaluarPlan(params, META, scenarios)

/** Documented to the peso, so compare at the peso. */
const pesos = (value: number) => Math.round(value)

describe('the documented worked example — sections 1 to 4', () => {
  it('lands on the profile the document says', () => {
    expect(perfil).toEqual({ nivel: 1, nombre: 'Moderado' })
  })

  it('uses the documented allocation', () => {
    expect(CARTERAS[perfil.nivel]).toEqual({
      CETES: 0.2,
      Bonos: 0.2,
      'ETF S&P500': 0.35,
      'ETF Nasdaq': 0.15,
      FIBRAS: 0.1,
    })
  })

  it('uses the documented assumptions', () => {
    expect(params.rendimientoAnual).toBe(0.07)
    expect(params.volatilidadAnual).toBe(0.1)
  })

  it('converts the annual rate as documented', () => {
    expect(Math.pow(1.07, 1 / 12) - 1).toBeCloseTo(0.0056541454, 10)
  })

  it('converts the volatility by the square root of time as documented', () => {
    expect(0.1 / Math.sqrt(12)).toBeCloseTo(0.0288675135, 10)
  })
})

describe('the documented worked example — section 5, deterministic', () => {
  it('matches the documented figures', () => {
    const d = plan.proyeccionDeterminista
    expect(pesos(d.capitalAportado)).toBe(1_010_000)
    expect(pesos(d.valorFinal)).toBe(2_223_630)
    expect(pesos(d.ganancia)).toBe(1_213_630)
    expect(d.rentabilidadTotalPct).toBeCloseTo(120.16, 1)
  })
})

describe('the documented worked example — section 7, distribution', () => {
  it('matches the documented percentiles', () => {
    expect(pesos(plan.distribucion.p10)).toBe(1_463_182)
    expect(pesos(plan.distribucion.p25)).toBe(1_736_403)
    expect(pesos(plan.distribucion.p50)).toBe(2_132_887)
    expect(pesos(plan.distribucion.p75)).toBe(2_633_738)
    expect(pesos(plan.distribucion.p90)).toBe(3_156_418)
  })

  it('puts the median below the deterministic value, as the document explains', () => {
    // Volatility drag. If this ever inverts, section 5's explanation is wrong.
    expect(plan.distribucion.p50).toBeLessThan(plan.proyeccionDeterminista.valorFinal)
  })

  it('matches the documented bands over time', () => {
    const bandas = bandasDeIncertidumbre(params, scenarios)
    const año = (n: number) => bandas[n - 1]
    expect(pesos(año(1).p50)).toBe(102_209)
    expect(pesos(año(5).p50)).toBe(353_935)
    expect(pesos(año(10).p50)).toBe(765_346)
    expect(pesos(año(20).p50)).toBe(2_132_887)
    expect(pesos(año(20).aportado)).toBe(1_010_000)
  })
})

describe('the documented worked example — sections 9 to 11', () => {
  it('matches the documented probability', () => {
    expect(plan.probabilidadMetaPct).toBeCloseTo(29.8, 2)
  })

  it('matches the documented required contribution', () => {
    expect(aporteParaProbabilidadMeta(params, META, 75, scenarios)).toBeCloseTo(5_911.55, 2)
  })

  it('matches the documented sensitivity rows', () => {
    const s = analizarSensibilidad(params, META, scenarios)
    expect(s.rendimiento.map((r) => Number(r.probabilidadPct.toFixed(1)))).toEqual([9.6, 29.8, 59.7])
    expect(s.horizonte.map((r) => Number(r.probabilidadPct.toFixed(1)))).toEqual([1, 29.8, 75.9])
    expect(s.aportacion.map((r) => Number(r.probabilidadPct.toFixed(1)))).toEqual([12.1, 29.8, 51.2])
  })
})

describe('the documented worked example — section 12, goal date', () => {
  const fecha = proyectarFechaMeta(params, META, scenarios, {
    desde: new Date('2026-09-01T00:00:00Z'),
  })!

  it('matches the documented arrival figures', () => {
    expect(fecha.probabilidadPct).toBeCloseTo(33.6, 1)
    expect(fecha.simulacionesQueNoLlegan).toBe(664)
    expect(fecha.mesP25).toBe(230)
  })

  it('reports no median date, because fewer than half the paths arrive', () => {
    expect(fecha.mesMediana).toBeNull()
    expect(fecha.fechaMediana).toBeNull()
  })

  it('never reports fewer arrivals than finishes above, as the document states', () => {
    expect(fecha.probabilidadPct).toBeGreaterThanOrEqual(plan.probabilidadMetaPct!)
  })
})

describe('the documented model version', () => {
  it('is the one the document names', () => {
    // If this fails the document's header is stale, whatever else still passes.
    expect(ADVISOR_MODEL_VERSION).toBe('3.0.0')
  })
})
