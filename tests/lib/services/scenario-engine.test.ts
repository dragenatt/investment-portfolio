import { describe, it, expect } from 'vitest'
import {
  estimateReliability,
  normaliseScenario,
  parsePortfolioScenarioRequest,
  runScenario,
  scenarioFromPlan,
  scenarioFromWeights,
  type ScenarioResult,
  type ScenarioSpec,
} from '@/lib/services/scenario-engine'
import { simulatePortfolioGBM } from '@/lib/services/monte-carlo'
import { DEFAULT_COST_MODEL } from '@/lib/services/costs'
import { mulberry32, standardNormal } from '@/lib/utils/random'

/** A riskless single holding: every path is the same, so results are exact. */
function flat(overrides: Partial<ScenarioSpec> = {}, mu = 0): ScenarioSpec {
  return {
    capital: 1000,
    holdings: [{ symbol: 'A', weight: 1 }],
    horizonMonths: 12,
    risk: { expectedReturns: [mu], volatilities: [0], correlation: [[1]], source: 'prueba' },
    simulations: 5,
    ...overrides,
  }
}

const run = (spec: ScenarioSpec) => {
  const result = runScenario(spec)
  if ('errors' in result) throw new Error(result.errors.join(' | '))
  return result as ScenarioResult
}

describe('reproducibility', () => {
  const risky: ScenarioSpec = {
    capital: 10_000,
    holdings: [
      { symbol: 'A', weight: 0.6 },
      { symbol: 'B', weight: 0.4 },
    ],
    contributions: { monthly: 200 },
    horizonMonths: 60,
    risk: { expectedReturns: [0.08, 0.04], volatilities: [0.2, 0.06], correlation: [[1, 0.3], [0.3, 1]], source: 'prueba' },
    simulations: 400,
  }

  it('gives the same scenario the same result, every time', () => {
    expect(run(risky)).toEqual(run(structuredClone(risky)))
  })

  it('keys a scenario by what it contains, with defaults filled in', () => {
    const explicit = { ...risky, rebalance: 'none' as const, inflation: 0, shocks: [], costs: DEFAULT_COST_MODEL, contributions: { monthly: 200, annualIncrease: 0 } }
    const a = normaliseScenario(risky)
    const b = normaliseScenario(explicit)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.scenario.key).toBe(b.scenario.key)
      expect(a.scenario.seed).toBe(b.scenario.seed)
    }
    const changed = normaliseScenario({ ...risky, horizonMonths: 61 })
    expect(changed.ok && a.ok && changed.scenario.key !== a.scenario.key).toBe(true)
  })

  it('derives the seed from the scenario when none is given, and honours one that is', () => {
    const derived = run(risky)
    const seeded = run({ ...risky, seed: 42 })
    expect(seeded.model.seed).toBe(42)
    expect(seeded.final.nominal.p50).not.toBe(derived.final.nominal.p50)
    expect(run({ ...risky, seed: 42 })).toEqual(seeded)
    expect(derived.model).toMatchObject({ engineVersion: '2.0.0', simulations: 400, months: 60, riskSource: 'prueba', gross: true })
  })

  it('extends every path when the horizon grows, without redrawing a month (2.0.0)', () => {
    // One stream per path: a 5-year run is the first five years of a 10-year one.
    const short = run({ ...risky, seed: 7, horizonMonths: 60 })
    const long = run({ ...risky, seed: 7, horizonMonths: 120 })
    for (let m = 0; m <= 60; m++) expect(long.nominal[m]).toEqual(short.nominal[m])
  })
})

describe('mechanics, on paths with no randomness', () => {
  it('compounds the drift continuously', () => {
    const result = run(flat({}, 0.12))
    expect(result.final.nominal.p10).toBeCloseTo(1000 * Math.exp(0.12), 6)
    expect(result.final.nominal.p90).toBeCloseTo(1000 * Math.exp(0.12), 6)
    expect(result.nominal).toHaveLength(13)
    expect(result.nominal[0].p50).toBe(1000)
  })

  it('adds contributions, raising them each year', () => {
    const result = run(flat({ horizonMonths: 24, contributions: { monthly: 100, annualIncrease: 0.1 } }))
    expect(result.final.contributed).toBeCloseTo(1000 + 12 * 100 + 12 * 110, 9)
    expect(result.final.nominal.p50).toBeCloseTo(result.final.contributed, 9)
    expect(result.final.probabilityOfLossPct).toBe(0)
  })

  it('charges custody monthly and commissions on money going in, and says the figures are no longer gross', () => {
    const custody = run(flat({ costs: { ...DEFAULT_COST_MODEL, custodyAnnualPct: 1.2, source: 'prueba' } }))
    expect(custody.final.nominal.p50).toBeCloseTo(1000 * Math.pow(1 - 0.012 / 12, 12), 6)
    expect(custody.model.gross).toBe(false)
    expect(custody.final.probabilityOfLossPct).toBe(100)

    const commission = run(flat({ costs: { ...DEFAULT_COST_MODEL, commissionPct: 1, source: 'prueba' } }))
    expect(commission.final.nominal.p50).toBeCloseTo(990, 6)
    expect(commission.final.medianCostsPaid).toBeCloseTo(10, 6)
  })

  it('deflates by inflation and estimates the tax on a liquidation', () => {
    const result = run(flat({ inflation: 0.05, costs: { ...DEFAULT_COST_MODEL, capitalGainsTaxPct: 10, source: 'prueba' } }, 0.1))
    expect(result.final.real.p50).toBeCloseTo(result.final.nominal.p50 / 1.05, 6)
    expect(result.final.medianLiquidationTax).toBeCloseTo((1000 * Math.exp(0.1) - 1000) * 0.1, 6)
  })

  it('applies a shock at the end of its month, to all holdings or the ones named', () => {
    const all = run(flat({ shocks: [{ month: 6, return: -0.3 }] }))
    expect(all.nominal[5].p50).toBeCloseTo(1000, 9)
    expect(all.nominal[6].p50).toBeCloseTo(700, 9)
    expect(all.drawdown.medianPct).toBeCloseTo(30, 9)

    const two: ScenarioSpec = {
      ...flat({ shocks: [{ month: 1, return: -0.5, symbols: ['B'] }] }),
      holdings: [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }],
      risk: { expectedReturns: [0, 0], volatilities: [0, 0], correlation: [[1, 0], [0, 1]], source: 'prueba' },
    }
    expect(run(two).final.nominal.p50).toBeCloseTo(750, 9)
  })

  it('rebalancing sells the winner, so buy-and-hold ends higher when one holding only rises', () => {
    const base: ScenarioSpec = {
      ...flat({ horizonMonths: 36 }),
      holdings: [{ symbol: 'UP', weight: 0.5 }, { symbol: 'FLAT', weight: 0.5 }],
      risk: { expectedReturns: [0.2, 0], volatilities: [0, 0], correlation: [[1, 0], [0, 1]], source: 'prueba' },
    }
    const hold = run({ ...base, rebalance: 'none' })
    const monthly = run({ ...base, rebalance: 'monthly' })
    const annual = run({ ...base, rebalance: 'annual' })
    expect(hold.final.nominal.p50).toBeCloseTo(500 * Math.exp(0.6) + 500, 6)
    expect(monthly.final.nominal.p50).toBeLessThan(annual.final.nominal.p50)
    expect(annual.final.nominal.p50).toBeLessThan(hold.final.nominal.p50)
  })

  it('tracks a benchmark with the same contributions', () => {
    const result = run(flat({ benchmark: { symbol: 'IDX', expectedReturn: 0.05, volatility: 0, correlations: [0] } }, 0.1))
    expect(result.benchmark!.medianFinal).toBeCloseTo(1000 * Math.exp(0.05), 6)
    expect(result.benchmark!.probabilityAheadPct).toBe(100)
  })
})

describe('with randomness', () => {
  it('orders the bands and keeps every figure finite', () => {
    const result = run({
      capital: 5000,
      holdings: [{ symbol: 'A', weight: 1 }],
      contributions: { monthly: 100 },
      horizonMonths: 120,
      risk: { expectedReturns: [0.07], volatilities: [0.18], correlation: [[1]], source: 'prueba' },
      simulations: 500,
      inflation: 0.04,
    })
    for (const b of [...result.nominal, ...result.real]) {
      expect(b.p10).toBeLessThanOrEqual(b.p25)
      expect(b.p25).toBeLessThanOrEqual(b.p50)
      expect(b.p50).toBeLessThanOrEqual(b.p75)
      expect(b.p75).toBeLessThanOrEqual(b.p90)
    }
    const numbers: number[] = []
    JSON.stringify(result, (_, v) => (typeof v === 'number' && numbers.push(v), v))
    expect(numbers.every(Number.isFinite)).toBe(true)
    expect(result.drawdown.p90Pct).toBeGreaterThanOrEqual(result.drawdown.medianPct)
  })

  it('agrees with the portfolio Monte Carlo cone it shares a generator with', () => {
    const random = mulberry32(3)
    const history = [0.01, 0.015].map((sd) => Array.from({ length: 500 }, () => 0.0004 + standardNormal(random) * sd))
    const spec = scenarioFromWeights({ capital: 1, symbols: ['X', 'Y'], weights: [0.7, 0.3], returnsMatrix: history, horizonMonths: 12, simulations: 4000, seed: 11 })
    const engine = run(spec)
    const cone = simulatePortfolioGBM({ assets: history.map((h, i) => ({ symbol: ['X', 'Y'][i], weight: [0.7, 0.3][i], historicalReturns: h })), weeks: 52, numSimulations: 4000, seed: 11 })
    const coneMedian = cone.finalValueDistribution[Math.floor(cone.finalValueDistribution.length / 2)]
    // Monthly and weekly steps of the same process, different draws: the medians agree to within a couple of percent.
    expect(Math.abs(engine.final.nominal.p50 / coneMedian - 1)).toBeLessThan(0.02)
  })
})

describe('validation', () => {
  it('refuses a scenario that cannot be run, and says why', () => {
    const bad = runScenario({
      capital: -1,
      holdings: [{ symbol: 'A', weight: 0.7 }, { symbol: 'A', weight: 0.2 }],
      horizonMonths: 0,
      risk: { expectedReturns: [0.1], volatilities: [-0.1], correlation: [[1]], source: '' },
      shocks: [{ month: 99, return: -1.5, symbols: ['Z'] }],
      simulations: 0,
    })
    expect('errors' in bad).toBe(true)
    const errors = (bad as { errors: string[] }).errors.join(' ')
    for (const fragment of ['capital', 'sumar 100%', 'una sola vez', 'horizonte', 'modelo de riesgo', 'choque', 'simulaciones']) {
      expect(errors).toContain(fragment)
    }
  })

  it('refuses a correlation matrix that is not one', () => {
    const result = runScenario({
      ...flat(),
      holdings: [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }],
      risk: { expectedReturns: [0, 0], volatilities: [0.1, 0.1], correlation: [[1, 0.5], [0.2, 1]], source: 'prueba' },
    })
    expect((result as { errors: string[] }).errors[0]).toContain('simétrica')
  })
})

describe('adapters', () => {
  it('turns an advisor plan into a runnable one-holding scenario', () => {
    const spec = scenarioFromPlan({ capitalInicial: 50_000, aportacionMensual: 2_000, años: 10, rendimientoAnual: 0.07, volatilidadAnual: 0.1 }, { simulations: 200 })
    const result = run(spec)
    expect(result.model.months).toBe(120)
    expect(result.final.contributed).toBe(50_000 + 120 * 2_000)
    expect(result.model.riskSource).toContain('advisor')
  })

  it('builds the risk model and the benchmark from history for an allocation', () => {
    const random = mulberry32(8)
    const series = (sd: number) => Array.from({ length: 250 }, () => standardNormal(random) * sd)
    const market = series(0.01)
    const spec = scenarioFromWeights({
      capital: 1000,
      symbols: ['A', 'B'],
      weights: [3, 1],
      returnsMatrix: [market.map((m, t) => m + series(0.005)[t]), series(0.004)],
      benchmarkReturns: { symbol: 'SPY', returns: market },
      horizonMonths: 24,
      rebalance: 'annual',
      simulations: 100,
    })
    expect(spec.holdings.map((h) => h.weight)).toEqual([0.75, 0.25])
    expect(spec.benchmark!.correlations[0]).toBeGreaterThan(0.5)
    expect(normaliseScenario(spec).ok).toBe(true)
    expect(run(spec).benchmark).not.toBeNull()
  })
})

describe('parsePortfolioScenarioRequest', () => {
  it('reads the form, clamps it, and turns percentages into fractions', () => {
    const r = parsePortfolioScenarioRequest(new URLSearchParams('allocation=riskParity&expected=7&horizon=999&monthly=-5&rebalance=annual&inflation=4&custody=0.5&commission=20&shock=-30&shockMonth=24&capital=10000'))
    expect(r).toEqual({
      allocation: 'riskParity',
      horizonMonths: 360,
      monthlyContribution: 0,
      rebalance: 'annual',
      inflation: 0.04,
      custodyAnnualPct: 0.5,
      commissionPct: 10,
      shock: { month: 24, return: -0.3, label: 'Choque a todas las posiciones' },
      capital: 10000,
      expectedReturn: 0.07,
    })
  })

  it('falls back to the book as it is: current weights, historical means, no shock', () => {
    const r = parsePortfolioScenarioRequest(new URLSearchParams('allocation=bogus&expected=&shock=0'))
    expect(r).toMatchObject({ allocation: 'current', horizonMonths: 60, rebalance: 'none', shock: null, capital: null, expectedReturn: null })
  })
})

describe('estimateReliability', () => {
  it('flags a short, noisy history whose mean cannot anchor a projection', () => {
    const random = mulberry32(21)
    const sixMonths = Array.from({ length: 126 }, () => 0.0014 + standardNormal(random) * 0.012)
    const r = estimateReliability(sixMonths)!
    expect(r.historyYears).toBeCloseTo(0.5, 6)
    expect(r.standardErrorPct).toBeCloseTo((Math.sqrt(252) * 0.012 / Math.sqrt(0.5)) * 100, -1)
    expect(r.unreliable).toBe(true)
    expect(r.note).toContain('Considera indicar un rendimiento esperado')
  })

  it('accepts a long history with a clear mean', () => {
    const random = mulberry32(22)
    const decade = Array.from({ length: 2520 }, () => 0.0006 + standardNormal(random) * 0.004)
    expect(estimateReliability(decade)!.unreliable).toBe(false)
  })

  it('replaces the historical means when an expected return is given, and says so in the risk source', () => {
    const random = mulberry32(23)
    const history = [0.01, 0.02].map((sd) => Array.from({ length: 200 }, () => 0.002 + standardNormal(random) * sd))
    const spec = scenarioFromWeights({ capital: 1, symbols: ['A', 'B'], weights: [0.5, 0.5], returnsMatrix: history, horizonMonths: 12, expectedReturnOverride: 0.06 })
    expect(spec.risk.expectedReturns).toEqual([0.06, 0.06])
    expect(spec.risk.source).toContain('6.0% anual')
    expect(spec.risk.volatilities[1]).toBeGreaterThan(spec.risk.volatilities[0])
  })
})
