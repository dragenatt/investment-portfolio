import { describe, it, expect } from 'vitest'
import {
  buildScenarios,
  analizarSensibilidad,
  evaluarPlan,
  compararEstrategias,
  proyectarFechaMeta,
  verificarConsistencia,
  type PlanParams,
} from '@/lib/services/advisor'

const base: PlanParams = {
  capitalInicial: 50000,
  aportacionMensual: 3000,
  años: 15,
  rendimientoAnual: 0.07,
  volatilidadAnual: 0.1,
}

const META = 1_200_000
// One long scenario set serves every shorter horizon, which is what keeps the
// comparisons honest: they all run on the same shocks.
const scenarios = buildScenarios({ months: 30 * 12, simulations: 400, seed: 2026 })

describe('every simulation surface uses the same monthly step', () => {
  // There are three loops that step a path forward: simulatePath, the
  // uncertainty bands, and proyectarFechaMeta. The volatility fix in model
  // 2.1.0 landed in the first two; this pins that the third cannot drift, which
  // is the failure mode of having the same arithmetic written three times.
  const set = buildScenarios({ months: 240, simulations: 800, seed: 606 })
  const plan: PlanParams = {
    capitalInicial: 50_000,
    aportacionMensual: 4_000,
    años: 20,
    rendimientoAnual: 0.07,
    volatilidadAnual: 0.16,
  }
  // Deliberately well ABOVE the median. Only the wide tail reaches it, so the
  // invariant below is sensitive to the two loops disagreeing about how wide
  // the distribution is — a goal most paths clear either way would not be.
  const META_ALCANZABLE = 3_500_000

  it('never reports fewer paths reaching the goal than finishing above it', () => {
    // A path can touch the goal and fall back, so arrivals must be at least as
    // common as ending above. If the two loops used different volatility this
    // would break, because one cloud would be far wider than the other.
    const fecha = proyectarFechaMeta(plan, META_ALCANZABLE, set)!
    const alFinal = evaluarPlan(plan, META_ALCANZABLE, set).probabilidadMetaPct!
    expect(fecha.probabilidadPct).toBeGreaterThanOrEqual(alFinal - 1e-9)
  })

  it('agrees with the plan when there is no volatility at all', () => {
    const quieto = { ...plan, volatilidadAnual: 0 }
    const fecha = proyectarFechaMeta(quieto, META_ALCANZABLE, set)!
    const alFinal = evaluarPlan(quieto, META_ALCANZABLE, set).probabilidadMetaPct!
    // With no randomness every path is identical: both are 0 or both are 100.
    expect(fecha.probabilidadPct === 0).toBe(alFinal === 0)
  })
})

describe('analizarSensibilidad with a scenario set that only covers the base plan', () => {
  // The advisor page builds exactly `horizonte * 12` months of shocks, so the
  // "+5 years" row has nothing to simulate with. simulateAll clamps to the
  // shocks available, which means that row silently answered the BASE horizon
  // and reported it as the longer one — visible in the exported plan as a
  // 25-year median identical to the 20-year one, to the peso.
  //
  // The existing tests above never saw it because they build a 30-year set for
  // a 15-year plan.
  const exacto = buildScenarios({ months: base.años * 12, simulations: 400, seed: 2026 })

  it('actually simulates the longer horizon instead of repeating the base one', () => {
    const result = analizarSensibilidad(base, META, exacto)
    const [corto, actual, largo] = result.horizonte
    expect(corto.medianaFinal).toBeLessThan(actual.medianaFinal)
    expect(largo.medianaFinal).toBeGreaterThan(actual.medianaFinal)
  })

  it('leaves the base row exactly where it was', () => {
    // Extending the paths must not disturb the months already drawn, or the
    // sensitivity table would contradict the projection it sits under.
    const conMargen = buildScenarios({ months: base.años * 12, simulations: 400, seed: 2026 })
    const base_ = evaluarPlan(base, META, conMargen)
    const result = analizarSensibilidad(base, META, exacto)
    const actual = result.horizonte.find((r) => r.esActual)!
    expect(actual.medianaFinal).toBe(base_.distribucion.p50)
  })

  it('is deterministic across calls', () => {
    expect(analizarSensibilidad(base, META, exacto)).toEqual(
      analizarSensibilidad(base, META, exacto),
    )
  })
})

describe('analizarSensibilidad (P1-4)', () => {
  it('varies the contribution down, flat and up', () => {
    const result = analizarSensibilidad(base, META, scenarios)
    const contributions = result.aportacion.map((r) => r.valor)
    expect(contributions).toEqual([2400, 3000, 3600]) // -20%, actual, +20%
  })

  it('varies the horizon by five years either side', () => {
    const result = analizarSensibilidad(base, META, scenarios)
    expect(result.horizonte.map((r) => r.valor)).toEqual([10, 15, 20])
  })

  it('marks which row is the plan as it stands', () => {
    const result = analizarSensibilidad(base, META, scenarios)
    expect(result.aportacion.filter((r) => r.esActual)).toHaveLength(1)
    expect(result.aportacion.find((r) => r.esActual)!.valor).toBe(3000)
  })

  it('reports the median outcome and the probability for every row', () => {
    const result = analizarSensibilidad(base, META, scenarios)
    for (const row of [...result.aportacion, ...result.horizonte, ...result.capital]) {
      expect(Number.isFinite(row.medianaFinal)).toBe(true)
      expect(row.probabilidadPct).toBeGreaterThanOrEqual(0)
      expect(row.probabilidadPct).toBeLessThanOrEqual(100)
    }
  })

  it('shows more contribution never lowering the probability', () => {
    // Same shocks throughout, so this is a property and not a tendency
    const rows = analizarSensibilidad(base, META, scenarios).aportacion
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].probabilidadPct).toBeGreaterThanOrEqual(rows[i - 1].probabilidadPct)
    }
  })

  it('shows the difference each change makes against the current plan', () => {
    const rows = analizarSensibilidad(base, META, scenarios).aportacion
    const current = rows.find((r) => r.esActual)!
    expect(current.deltaProbabilidadPp).toBe(0)
    expect(rows[2].deltaProbabilidadPp).toBeGreaterThanOrEqual(0)
  })

  it('never proposes a horizon of zero or less', () => {
    const short = { ...base, años: 3 }
    const rows = analizarSensibilidad(short, META, scenarios).horizonte
    expect(rows.every((r) => r.valor >= 1)).toBe(true)
  })

  it('varies the expected return to show what the assumption is worth', () => {
    const result = analizarSensibilidad(base, META, scenarios)
    expect(result.rendimiento).toHaveLength(3)
    expect(result.rendimiento[0].valor).toBeLessThan(result.rendimiento[2].valor)
  })

  it('is deterministic', () => {
    expect(analizarSensibilidad(base, META, scenarios)).toEqual(
      analizarSensibilidad(base, META, scenarios),
    )
  })
})

describe('compararEstrategias (P1-5)', () => {
  const options = [
    { aportacionMensual: 1500, años: 20 },
    { aportacionMensual: 2500, años: 15 },
    { aportacionMensual: 4000, años: 10 },
  ]

  it('scores every option against the same goal and the same shocks', () => {
    const result = compararEstrategias(base, META, options, scenarios)
    expect(result.opciones).toHaveLength(3)
    for (const option of result.opciones) {
      expect(option.probabilidadPct).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(option.valorEsperado)).toBe(true)
      expect(Number.isFinite(option.mediana)).toBe(true)
      expect(Number.isFinite(option.downsideP10)).toBe(true)
    }
  })

  it('reports total contributed so the cost of each path is visible', () => {
    const result = compararEstrategias(base, META, options, scenarios)
    expect(result.opciones[0].totalAportado).toBeCloseTo(1500 * 240, 0)
    expect(result.opciones[2].totalAportado).toBeCloseTo(4000 * 120, 0)
  })

  it('measures the saving effort against income when one is given', () => {
    const result = compararEstrategias({ ...base }, META, options, scenarios, { ingresoMensual: 20000 })
    expect(result.opciones[0].esfuerzoAhorroPct).toBeCloseTo(7.5, 1)
    expect(result.opciones[2].esfuerzoAhorroPct).toBeCloseTo(20, 1)
  })

  it('leaves the saving effort null when income is unknown', () => {
    const result = compararEstrategias(base, META, options, scenarios)
    expect(result.opciones[0].esfuerzoAhorroPct).toBeNull()
  })

  it('simulates an option longer than the scenario set for its whole horizon', () => {
    // Scored on a 10-year set, a 25-year option used to stop at year ten: same
    // growth as the 10-year option, fifteen more years of contributions.
    const short = buildScenarios({ months: 10 * 12, simulations: 400, seed: 7 })
    const result = compararEstrategias(base, META, [
      { aportacionMensual: 3000, años: 10 },
      { aportacionMensual: 3000, años: 25 },
    ], short)
    expect(result.opciones[1].mediana).toBeGreaterThan(result.opciones[0].mediana * 2)
  })

  it('reproduces the plan itself when an option matches it', () => {
    // Lengthening the set must not move the months already drawn.
    const plan = { aportacionMensual: base.aportacionMensual, años: base.años }
    const alone = compararEstrategias(base, META, [plan], scenarios)
    const beside = compararEstrategias(base, META, [plan, { aportacionMensual: 1000, años: 40 }], scenarios)
    expect(beside.opciones[0].mediana).toBe(alone.opciones[0].mediana)
    expect(beside.opciones[0].probabilidadPct).toBe(alone.opciones[0].probabilidadPct)
  })

  it('does not crown a winner', () => {
    const result = compararEstrategias(base, META, options, scenarios) as Record<string, unknown>
    expect(result.mejor).toBeUndefined()
    expect(result.recomendada).toBeUndefined()
  })

  it('says what each option trades away instead', () => {
    const result = compararEstrategias(base, META, options, scenarios)
    expect(result.nota.length).toBeGreaterThan(40)
    for (const option of result.opciones) {
      expect(option.resumen.length).toBeGreaterThan(20)
    }
  })

  it('handles an empty option list', () => {
    expect(compararEstrategias(base, META, [], scenarios).opciones).toEqual([])
  })
})

describe('proyectarFechaMeta (P1-6)', () => {
  // META is deliberately out of reach for most paths (the deterministic outcome
  // is ~1.07M against a 1.2M goal), so a median arrival correctly does not
  // exist. These cases need a goal most paths DO reach.
  const ALCANZABLE = 800_000

  it('reports the median month the goal is first met', () => {
    const result = proyectarFechaMeta(base, ALCANZABLE, scenarios)!
    expect(result.mesMediana).toBeGreaterThan(0)
    expect(result.mesP25).toBeLessThanOrEqual(result.mesMediana!)
    expect(result.mesMediana!).toBeLessThanOrEqual(result.mesP75!)
  })

  it('counts the simulations that never get there', () => {
    const result = proyectarFechaMeta(base, META, scenarios)!
    expect(result.simulacionesQueNoLlegan).toBeGreaterThanOrEqual(0)
    expect(result.simulacionesQueNoLlegan).toBeLessThanOrEqual(scenarios.simulations)
    expect(result.probabilidadPct).toBeCloseTo(
      ((scenarios.simulations - result.simulacionesQueNoLlegan) / scenarios.simulations) * 100,
      6,
    )
  })

  it('reports the first month the goal is met, not the last', () => {
    // A path that crosses the goal and falls back still counts from the crossing
    const easy = proyectarFechaMeta(base, 60000, scenarios)!
    expect(easy.mesMediana).toBeLessThan(24)
  })

  it('returns dates a reader can act on, not just month counts', () => {
    const result = proyectarFechaMeta(base, ALCANZABLE, scenarios, { desde: new Date('2026-01-15') })!
    expect(result.fechaMediana).toMatch(/^\d{4}-\d{2}$/)
    expect(result.fechaP25).toMatch(/^\d{4}-\d{2}$/)
  })

  it('has no median date when most paths fall short — including this plan own goal', () => {
    // The deterministic outcome lands near 1.07M, so META at 1.2M is missed by
    // more than half the scenarios and there is no central date to report.
    expect(proyectarFechaMeta(base, META, scenarios)!.mesMediana).toBeNull()
  })

  it('says plainly when almost nothing reaches the goal', () => {
    const result = proyectarFechaMeta(base, 5e9, scenarios)!
    expect(result.mesMediana).toBeNull()
    expect(result.fechaMediana).toBeNull()
    expect(result.advertencia).toMatch(/no/i)
  })

  it('never presents a single date as a promise', () => {
    const result = proyectarFechaMeta(base, ALCANZABLE, scenarios)!
    expect(result.advertencia.length).toBeGreaterThan(30)
    expect(result.advertencia).not.toMatch(/garantiz/i)
  })

  it('is deterministic', () => {
    expect(proyectarFechaMeta(base, META, scenarios)).toEqual(
      proyectarFechaMeta(base, META, scenarios),
    )
  })
})

describe('verificarConsistencia (P1-7)', () => {
  it('passes a coherent result', () => {
    const report = verificarConsistencia({
      probabilidadPct: 82,
      aporteActual: 3000,
      aporteSugerido: 2500,
      objetivoPct: 75,
      valorFinalMediana: 1_300_000,
      meta: META,
      pesos: [0.4, 0.35, 0.25],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(true)
    expect(report.problems).toEqual([])
  })

  it('catches a suggested contribution below the current one at a low probability', () => {
    // The circular-advice signature: "you are unlikely to make it, contribute less"
    const report = verificarConsistencia({
      probabilidadPct: 30,
      aporteActual: 3000,
      aporteSugerido: 2000,
      objetivoPct: 75,
      valorFinalMediana: 400_000,
      meta: META,
      pesos: [1],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(false)
    expect(report.problems.join(' ')).toMatch(/aporte|contribution/i)
  })

  it('catches a probability that contradicts the median outcome', () => {
    // A median far above the goal cannot coexist with a low probability
    const report = verificarConsistencia({
      probabilidadPct: 12,
      aporteActual: 3000,
      aporteSugerido: 8000,
      objetivoPct: 75,
      valorFinalMediana: META * 3,
      meta: META,
      pesos: [1],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(false)
    expect(report.problems.join(' ')).toMatch(/mediana|median/i)
  })

  it('catches weights that do not sum to 100%', () => {
    const report = verificarConsistencia({
      probabilidadPct: 80,
      aporteActual: 3000,
      aporteSugerido: 2500,
      objetivoPct: 75,
      valorFinalMediana: 1_300_000,
      meta: META,
      pesos: [0.4, 0.4],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(false)
    expect(report.problems.join(' ')).toMatch(/100%|sum/i)
  })

  it('catches an impossible probability', () => {
    const report = verificarConsistencia({
      probabilidadPct: 140,
      aporteActual: 3000,
      aporteSugerido: 2500,
      objetivoPct: 75,
      valorFinalMediana: 1_300_000,
      meta: META,
      pesos: [1],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(false)
  })

  it('catches an implausible expected return', () => {
    const report = verificarConsistencia({
      probabilidadPct: 80,
      aporteActual: 3000,
      aporteSugerido: 2500,
      objetivoPct: 75,
      valorFinalMediana: 1_300_000,
      meta: META,
      pesos: [1],
      rendimientoAnual: 3.5,
    })
    expect(report.consistent).toBe(false)
  })

  it('catches a non-finite figure anywhere in the result', () => {
    const report = verificarConsistencia({
      probabilidadPct: 80,
      aporteActual: 3000,
      aporteSugerido: 2500,
      objetivoPct: 75,
      valorFinalMediana: Number.NaN,
      meta: META,
      pesos: [1],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(false)
  })

  it('reports every problem at once', () => {
    const report = verificarConsistencia({
      probabilidadPct: 140,
      aporteActual: 3000,
      aporteSugerido: 2000,
      objetivoPct: 75,
      valorFinalMediana: Number.NaN,
      meta: META,
      pesos: [0.3],
      rendimientoAnual: 9,
    })
    expect(report.problems.length).toBeGreaterThanOrEqual(3)
  })

  it('tolerates a missing suggested contribution', () => {
    const report = verificarConsistencia({
      probabilidadPct: 20,
      aporteActual: 3000,
      aporteSugerido: null,
      objetivoPct: 75,
      valorFinalMediana: 400_000,
      meta: META,
      pesos: [1],
      rendimientoAnual: 0.07,
    })
    expect(report.consistent).toBe(true)
  })
})
