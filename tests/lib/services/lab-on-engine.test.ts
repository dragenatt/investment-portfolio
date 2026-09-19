import { describe, it, expect } from 'vitest'
import { runExperiment, defaultParams } from '@/lib/services/lab'
import { buildScenarios, evaluarPlan } from '@/lib/services/advisor'

// 4.9 (2/4) — the lab on the scenario engine.
//
// The Monte Carlo lesson said it used "the same engine as the advisor" and did,
// by importing the advisor's private generator; the backtesting and factor
// lessons each drew from their own mulberry32 streams. They now run the
// engine: the Monte Carlo lesson calls runScenario, the other two draw from the
// engine's generator. The lesson's figures are the advisor's figures.

describe('the Monte Carlo lesson is the advisor\'s projection', () => {
  it('reports the same percentiles and the same calculator figure for the same plan', () => {
    const params = defaultParams('monteCarlo')
    const result = runExperiment('monteCarlo', params)!
    const plan = {
      capitalInicial: params.capital,
      aportacionMensual: params.monthly,
      años: params.years,
      rendimientoAnual: params.expectedReturn / 100,
      volatilidadAnual: params.volatility / 100,
    }
    const advisor = evaluarPlan(plan, null, buildScenarios({ months: plan.años * 12, simulations: 600, seed: 4242 }))
    const at = (p: number) => result.series.find((r) => r.percentile === p)!.value
    // The advisor rounds money to the cent; the engine does not.
    expect(at(10)).toBeCloseTo(advisor.distribucion.p10, 1)
    expect(at(25)).toBeCloseTo(advisor.distribucion.p25, 1)
    expect(at(50)).toBeCloseTo(advisor.distribucion.p50, 1)
    expect(at(75)).toBeCloseTo(advisor.distribucion.p75, 1)
    expect(at(90)).toBeCloseTo(advisor.distribucion.p90, 1)
    expect(result.chart.referenceY!.value).toBeCloseTo(advisor.proyeccionDeterminista.valorFinal, 1)
  })
})

describe('the backtesting lesson draws its prices from the engine\'s generator', () => {
  it('gives a path the same prices however many paths are drawn', () => {
    // Per-path streams: adding paths appends, it does not reshuffle.
    const few = runExperiment('backtesting', { ...defaultParams('backtesting'), paths: 5 })!
    const many = runExperiment('backtesting', { ...defaultParams('backtesting'), paths: 20 })!
    const key = (r: Record<string, number>) => `${r.strategyReturn.toFixed(8)}|${r.buyAndHoldReturn.toFixed(8)}`
    const inMany = new Set(many.series.map(key))
    for (const row of few.series) expect(inMany.has(key(row))).toBe(true)
  })
})
