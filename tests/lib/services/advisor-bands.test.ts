import { describe, it, expect } from 'vitest'
import {
  buildScenarios,
  evaluarPlan,
  bandasDeIncertidumbre,
  type PlanParams,
} from '@/lib/services/advisor'

const params: PlanParams = {
  capitalInicial: 50_000,
  aportacionMensual: 5_000,
  años: 20,
  rendimientoAnual: 0.07,
  volatilidadAnual: 0.12,
}

const scenarios = buildScenarios({ months: 240, simulations: 500, seed: 99 })
const bandas = bandasDeIncertidumbre(params, scenarios)

describe('bandasDeIncertidumbre', () => {
  it('reports one band per year of the plan', () => {
    expect(bandas).toHaveLength(params.años)
    expect(bandas.map((b) => b.año)).toEqual(
      Array.from({ length: params.años }, (_, i) => i + 1),
    )
  })

  it('keeps the percentiles in order in every year', () => {
    for (const banda of bandas) {
      expect(banda.p10).toBeLessThanOrEqual(banda.p25)
      expect(banda.p25).toBeLessThanOrEqual(banda.p50)
      expect(banda.p50).toBeLessThanOrEqual(banda.p75)
      expect(banda.p75).toBeLessThanOrEqual(banda.p90)
    }
  })

  it('widens as the horizon lengthens', () => {
    // The point of drawing a fan rather than a line: uncertainty compounds too.
    const ancho = (i: number) => bandas[i].p90 - bandas[i].p10
    expect(ancho(bandas.length - 1)).toBeGreaterThan(ancho(0))
  })

  it('ends exactly where the summary percentiles say it does', () => {
    // The right edge of the chart must equal the cards printed above it. If
    // these two ever disagree the page contradicts itself in the same view.
    const outcome = evaluarPlan(params, null, scenarios)
    const ultimo = bandas[bandas.length - 1]
    expect(ultimo.p10).toBe(outcome.distribucion.p10)
    expect(ultimo.p25).toBe(outcome.distribucion.p25)
    expect(ultimo.p50).toBe(outcome.distribucion.p50)
    expect(ultimo.p75).toBe(outcome.distribucion.p75)
    expect(ultimo.p90).toBe(outcome.distribucion.p90)
  })

  it('tracks what has actually been paid in by each year', () => {
    for (const banda of bandas) {
      expect(banda.aportado).toBeCloseTo(
        params.capitalInicial + params.aportacionMensual * banda.año * 12,
        2,
      )
    }
  })

  it('collapses onto a single path when there is no volatility', () => {
    const sinRiesgo = bandasDeIncertidumbre({ ...params, volatilidadAnual: 0 }, scenarios)
    for (const banda of sinRiesgo) {
      expect(banda.p90 - banda.p10).toBeCloseTo(0, 2)
    }
  })

  it('matches the deterministic projection when there is no volatility', () => {
    const sinRiesgo = bandasDeIncertidumbre({ ...params, volatilidadAnual: 0 }, scenarios)
    const outcome = evaluarPlan({ ...params, volatilidadAnual: 0 }, null, scenarios)
    const ultimo = sinRiesgo[sinRiesgo.length - 1]
    expect(ultimo.p50).toBeCloseTo(outcome.proyeccionDeterminista.valorFinal, 0)
  })

  it('never emits an invalid number', () => {
    for (const banda of bandas) {
      for (const valor of [banda.p10, banda.p25, banda.p50, banda.p75, banda.p90, banda.aportado]) {
        expect(Number.isFinite(valor)).toBe(true)
        expect(valor).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('is deterministic', () => {
    expect(bandasDeIncertidumbre(params, scenarios)).toEqual(
      bandasDeIncertidumbre(params, scenarios),
    )
  })

  it('returns nothing for a plan with no years', () => {
    expect(bandasDeIncertidumbre({ ...params, años: 0 }, scenarios)).toEqual([])
  })

  it('stops at the shocks it has rather than inventing months', () => {
    const cortos = buildScenarios({ months: 60, simulations: 200, seed: 1 })
    const limitadas = bandasDeIncertidumbre(params, cortos)
    expect(limitadas).toHaveLength(5)
  })
})

// ─── the shocks must deliver the volatility they claim ──────────────────────

describe('realised volatility matches the assumption', () => {
  /**
   * Standard deviation of the yearly log return of the simulated paths, with no
   * contributions so nothing dilutes the return process.
   *
   * The engine used to draw a fresh ANNUAL return every month and convert it to
   * a monthly rate. Averaging twelve independent annual draws inside one year
   * divides the annual standard deviation by sqrt(12), so a profile documented
   * at 10% delivered 2.7%. Every probability the advisor reported was
   * overconfident and the uncertainty fan D7 draws was three and a half times
   * too narrow.
   */
  function volatilidadRealizada(volatilidadAnual: number): number {
    const sinAportes: PlanParams = {
      capitalInicial: 1,
      aportacionMensual: 0,
      años: 1,
      rendimientoAnual: 0.07,
      volatilidadAnual,
    }
    const muchas = buildScenarios({ months: 12, simulations: 4_000, seed: 4321 })
    const finales = bandasDeIncertidumbre(sinAportes, muchas)
    // One year of bands gives the cross-section directly; rebuild the spread
    // from the percentiles of the log return.
    const banda = finales[0]
    // P10 and P90 of a normal sit at -+1.2816 sd.
    return (Math.log(banda.p90) - Math.log(banda.p10)) / (2 * 1.2816)
  }

  it.each([0.05, 0.1, 0.16])('delivers about %s of annual volatility', (sigma) => {
    const realizada = volatilidadRealizada(sigma)
    // Within 15% of the stated figure. Sampling noise on 4,000 paths plus the
    // percentile estimate is worth a few points; a factor of 3.5 is not.
    expect(realizada).toBeGreaterThan(sigma * 0.85)
    expect(realizada).toBeLessThan(sigma * 1.15)
  })

  it('still collapses to the deterministic path at zero volatility', () => {
    const quieto: PlanParams = {
      capitalInicial: 10_000,
      aportacionMensual: 0,
      años: 5,
      rendimientoAnual: 0.07,
      volatilidadAnual: 0,
    }
    const set = buildScenarios({ months: 60, simulations: 100, seed: 5 })
    const outcome = evaluarPlan(quieto, null, set)
    expect(outcome.distribucion.p50).toBeCloseTo(outcome.proyeccionDeterminista.valorFinal, 0)
    expect(outcome.distribucion.p90 - outcome.distribucion.p10).toBeCloseTo(0, 2)
  })

  it('shows volatility drag: more volatility, lower median, same mean return', () => {
    // The geometric mean falls below the arithmetic one as spread grows. This
    // is a real property of compounding, and a model that misses it makes risk
    // look free.
    const set = buildScenarios({ months: 240, simulations: 2_000, seed: 88 })
    const base: PlanParams = {
      capitalInicial: 100_000,
      aportacionMensual: 0,
      años: 20,
      rendimientoAnual: 0.07,
      volatilidadAnual: 0.05,
    }
    const tranquilo = evaluarPlan(base, null, set).distribucion.p50
    const agitado = evaluarPlan({ ...base, volatilidadAnual: 0.25 }, null, set).distribucion.p50
    expect(agitado).toBeLessThan(tranquilo)
  })
})
