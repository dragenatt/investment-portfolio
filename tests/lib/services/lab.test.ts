import { describe, it, expect, afterEach } from 'vitest'
import {
  listExperiments,
  getExperiment,
  runExperiment,
  defaultParams,
  type ExperimentId,
} from '@/lib/services/lab'
import { cornishFisherVaR, parametricVaR } from '@/lib/services/var'

/** The twelve experiments E1 names, in the roadmap's own order. */
const ROADMAP_EXPERIMENTS: ExperimentId[] = [
  'diversification',
  'correlation',
  'volatility',
  'monteCarlo',
  'var',
  'beta',
  'markowitz',
  'riskParity',
  'stressTesting',
  'backtesting',
  'rebalancing',
  'factors',
]

afterEach(() => {
  delete process.env.FEATURE_MARKOWITZ
})

/** Every parameter at its minimum, or at its maximum. */
function extreme(id: ExperimentId, end: 'min' | 'max'): Record<string, number> {
  const params: Record<string, number> = {}
  for (const spec of getExperiment(id)!.params) params[spec.key] = spec[end]
  return params
}

describe('the catalogue', () => {
  it('covers all twelve experiments the roadmap names', () => {
    const ids = listExperiments().map((e) => e.id)
    for (const id of ROADMAP_EXPERIMENTS) expect(ids).toContain(id)
  })

  it('has every one of them runnable, not listed as a gap', () => {
    for (const id of ROADMAP_EXPERIMENTS) {
      const experiment = getExperiment(id)!
      expect(experiment.available, `${id}: ${experiment.unavailableReason}`).toBe(true)
    }
  })

  it('gives every experiment the seven parts the roadmap asks for', () => {
    // 1 objetivo, 2 concepto, 3 parametros, 4 simulacion, 5 resultado,
    // 6 interpretacion, 7 preguntas. 5 and 6 come out of running it.
    for (const experiment of listExperiments()) {
      expect(experiment.title.length).toBeGreaterThan(3)
      expect(experiment.objective.length, experiment.id).toBeGreaterThan(20)
      expect(experiment.concept.length, experiment.id).toBeGreaterThan(40)
      expect(experiment.params.length, experiment.id).toBeGreaterThan(0)
      expect(experiment.simulation.length, experiment.id).toBeGreaterThan(40)
      expect(experiment.questions.length, experiment.id).toBeGreaterThanOrEqual(2)
      for (const question of experiment.questions) {
        expect(question.length).toBeGreaterThan(15)
      }

      const result = runExperiment(experiment.id, defaultParams(experiment.id))!
      expect(result.highlights.length, experiment.id).toBeGreaterThan(0)
      expect(result.interpretation.length, experiment.id).toBeGreaterThan(40)
    }
  })

  it('still lists an experiment switched off by configuration, with the reason', () => {
    process.env.FEATURE_MARKOWITZ = 'false'
    const markowitz = listExperiments().find((e) => e.id === 'markowitz')!
    expect(markowitz.available).toBe(false)
    expect(markowitz.unavailableReason!.length).toBeGreaterThan(10)
    expect(markowitz.run).toBeUndefined()
    expect(runExperiment('markowitz', defaultParams('markowitz'))).toBeNull()
  })

  it('gives every runnable experiment adjustable parameters', () => {
    for (const experiment of listExperiments().filter((e) => e.available)) {
      expect(experiment.params.length).toBeGreaterThan(0)
      for (const spec of experiment.params) {
        expect(spec.min).toBeLessThan(spec.max)
        expect(spec.default).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default).toBeLessThanOrEqual(spec.max)
        expect(spec.step).toBeGreaterThan(0)
      }
    }
  })
})

describe('running experiments', () => {
  it('runs every available experiment on its defaults', () => {
    for (const experiment of listExperiments().filter((e) => e.available)) {
      const result = runExperiment(experiment.id, defaultParams(experiment.id))!
      expect(result).not.toBeNull()
      expect(result.series.length).toBeGreaterThan(0)
      expect(result.highlights.length).toBeGreaterThan(0)
      expect(result.interpretation.length).toBeGreaterThan(50)
    }
  })

  it('never emits a non-finite number in any series', () => {
    for (const experiment of listExperiments().filter((e) => e.available)) {
      const result = runExperiment(experiment.id, defaultParams(experiment.id))!
      for (const row of result.series) {
        for (const value of Object.values(row)) {
          expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  })

  it('never emits a non-finite number at either end of every slider', () => {
    // The roadmap rule: no NaN or Infinity may reach the interface. A lesson is
    // exactly where someone drags every slider to the wall to see what breaks.
    for (const id of ROADMAP_EXPERIMENTS) {
      for (const end of ['min', 'max'] as const) {
        const result = runExperiment(id, extreme(id, end))!
        expect(result, `${id} @ ${end}`).not.toBeNull()
        for (const row of result.series) {
          for (const [key, value] of Object.entries(row)) {
            expect(Number.isFinite(value), `${id} @ ${end}: ${key}=${value}`).toBe(true)
          }
        }
      }
    }
  })

  it('never writes NaN or Infinity into the text either', () => {
    for (const id of ROADMAP_EXPERIMENTS) {
      for (const params of [extreme(id, 'min'), defaultParams(id), extreme(id, 'max')]) {
        const result = runExperiment(id, params)!
        const text = [result.interpretation, ...result.highlights.map((h) => h.value)].join(' ')
        expect(text, id).not.toMatch(/NaN|Infinity|undefined|null/)
      }
    }
  })

  it('describes a chart whose keys actually exist in the series', () => {
    for (const id of ROADMAP_EXPERIMENTS) {
      const result = runExperiment(id, defaultParams(id))!
      expect(result.series.length, id).toBeGreaterThan(0)
      const row = result.series[0]
      expect(row, `${id}: x=${result.chart.x}`).toHaveProperty(result.chart.x)
      expect(result.chart.series.length, id).toBeGreaterThan(0)
      for (const serie of result.chart.series) {
        expect(row, `${id}: ${serie.key}`).toHaveProperty(serie.key)
        expect(serie.label.length).toBeGreaterThan(2)
      }
      if (result.chart.xCategories) {
        expect(result.chart.xCategories.length).toBe(result.series.length)
      }
    }
  })

  it('puts a currency symbol on money, as the advisor does', () => {
    // The Monte Carlo experiment printed "1879771" with no symbol, the same
    // defect fixed in the advisor prose in D1/D2/D4.
    const result = runExperiment('monteCarlo', defaultParams('monteCarlo'))!
    const aportado = result.highlights.find((h) => /aportado/i.test(h.label))!
    expect(aportado.value).toContain('$')
    expect(result.interpretation).toContain('$')
  })

  it('refuses to run an experiment that is switched off', () => {
    process.env.FEATURE_MARKOWITZ = 'off'
    expect(runExperiment('markowitz')).toBeNull()
  })

  it('clamps a parameter outside its range instead of breaking', () => {
    const result = runExperiment('diversification', {
      assets: 9999,
      volatility: -50,
      correlation: 7,
    })!
    expect(result.series.length).toBeLessThanOrEqual(30)
    expect(result.series.every((r) => Number.isFinite(r.portfolioVolatility))).toBe(true)
  })

  it('falls back to the default for a parameter that is not a number', () => {
    const result = runExperiment('drawdown', { maxDrawdown: Number.NaN })!
    expect(result.highlights[0].value).toBe('40%')
  })

  it('is deterministic', () => {
    for (const id of ['diversification', 'monteCarlo', 'var'] as ExperimentId[]) {
      expect(runExperiment(id, defaultParams(id))).toEqual(runExperiment(id, defaultParams(id)))
    }
  })
})

describe('the lessons themselves', () => {
  it('diversification stops helping once everything moves together', () => {
    const independent = runExperiment('diversification', {
      assets: 20,
      volatility: 20,
      correlation: 0,
    })!
    const lockstep = runExperiment('diversification', {
      assets: 20,
      volatility: 20,
      correlation: 1,
    })!
    const lastIndependent = independent.series[independent.series.length - 1]
    const lastLockstep = lockstep.series[lockstep.series.length - 1]

    expect(lastIndependent.portfolioVolatility).toBeLessThan(lastLockstep.portfolioVolatility)
    // With correlation 1 the curve is flat at the single-asset volatility
    expect(lastLockstep.portfolioVolatility).toBeCloseTo(20, 4)
    expect(lockstep.interpretation).toMatch(/plana|no reduce/i)
  })

  it('N uncorrelated assets give sigma over the root of N', () => {
    const result = runExperiment('diversification', { assets: 4, volatility: 20, correlation: 0 })!
    const last = result.series[result.series.length - 1]
    expect(last.portfolioVolatility).toBeCloseTo(10, 4) // 20 / sqrt(4)
  })

  it('correlation alone moves the risk between two extremes', () => {
    const result = runExperiment('correlation', defaultParams('correlation'))!
    const atMinusOne = result.series[0].portfolioVolatility
    const atPlusOne = result.series[result.series.length - 1].portfolioVolatility
    expect(atMinusOne).toBeLessThan(atPlusOne)
    // At +1 there is no diversification: risk equals the weighted average
    expect(atPlusOne).toBeCloseTo(result.series[0].weightedAverage, 4)
  })

  it('the drawdown curve is convex, not a straight line', () => {
    const result = runExperiment('drawdown', { maxDrawdown: 50 })!
    const at20 = result.series.find((r) => r.fall === 20)!.recoveryNeeded
    const at40 = result.series.find((r) => r.fall === 40)!.recoveryNeeded
    // Doubling the fall more than doubles the recovery needed
    expect(at40).toBeGreaterThan(at20 * 2)
  })

  it('beta multiplies losses as readily as gains', () => {
    const up = runExperiment('beta', { beta: 1.5, marketMove: 20 })!
    const down = runExperiment('beta', { beta: 1.5, marketMove: -20 })!
    expect(up.highlights[1].value).toBe('30.0%')
    expect(down.highlights[1].value).toBe('-30.0%')
  })

  it('Monte Carlo shows a range far wider than the single deterministic figure', () => {
    const result = runExperiment('monteCarlo', defaultParams('monteCarlo'))!
    const p10 = result.series.find((r) => r.percentile === 10)!.value
    const p90 = result.series.find((r) => r.percentile === 90)!.value
    expect(p90).toBeGreaterThan(p10)
    expect(result.interpretation).toMatch(/abanico|rango|entre/i)
  })

  it('fat tails make the normal VaR understate the loss', () => {
    const thin = runExperiment('var', { volatility: 1.2, skew: 0, kurtosis: 0 })!
    const fat = runExperiment('var', { volatility: 1.2, skew: -1, kurtosis: 6 })!
    const thinAt99 = thin.series.find((s) => s.confidence === 99)!
    const fatAt99 = fat.series.find((s) => s.confidence === 99)!

    // With no skew or kurtosis the two models agree
    expect(thinAt99.adjustedVaR).toBeCloseTo(thinAt99.normalVaR, 4)
    // With fat tails the adjusted figure is larger
    expect(fatAt99.adjustedVaR).toBeGreaterThan(fatAt99.normalVaR)
  })
})

describe('the new lessons', () => {
  it('VaR reuses the Cornish-Fisher engine instead of a second copy of the formula', () => {
    const params = { volatility: 1.5, skew: -0.8, kurtosis: 4 }
    const result = runExperiment('var', params)!
    for (const row of result.series) {
      const expected = cornishFisherVaR(0, 0.015, -0.8, 4, row.confidence)! * 100
      expect(row.adjustedVaR).toBeCloseTo(expected, 10)
      expect(row.normalVaR).toBeCloseTo(parametricVaR(0, 0.015, row.confidence)! * 100, 10)
    }
  })

  it('volatility: the same average return compounds to less when it swings more', () => {
    const result = runExperiment('volatility', {
      meanReturn: 8,
      lowVolatility: 10,
      highVolatility: 40,
      years: 20,
    })!
    const last = result.series[result.series.length - 1]
    expect(last.noVolatility).toBeGreaterThan(last.lowVolatility)
    expect(last.lowVolatility).toBeGreaterThan(last.highVolatility)
    // With no volatility the path is plain compounding.
    expect(last.noVolatility).toBeCloseTo(100 * 1.08 ** 20, 6)
    // Alternating +/-sigma around mu compounds at sqrt((1+mu)^2 - sigma^2) - 1 a year.
    expect(last.highVolatility).toBeCloseTo(100 * (1.08 ** 2 - 0.4 ** 2) ** 10, 6)
  })

  it('volatility: every path averages exactly the stated return', () => {
    // Otherwise the lesson would be comparing different averages, not different swings.
    const result = runExperiment('volatility', defaultParams('volatility'))!
    const params = defaultParams('volatility')
    for (const key of ['lowVolatility', 'highVolatility'] as const) {
      let previous = 100
      const yearly: number[] = []
      for (const row of result.series.slice(1)) {
        yearly.push(row[key] / previous - 1)
        previous = row[key]
      }
      const mean = yearly.reduce((a, b) => a + b, 0) / yearly.length
      expect(mean).toBeCloseTo(params.meanReturn / 100, 10)
    }
  })

  it('risk parity: equal money is not equal risk', () => {
    const result = runExperiment('riskParity', {
      equityVolatility: 18,
      bondVolatility: 5,
      commodityVolatility: 22,
      correlation: 0.2,
    })!
    const equity = result.series.find((r) => r.asset === 0)!
    const bonds = result.series.find((r) => r.asset === 1)!
    // One third of the money each, but bonds carry far less than a third of the risk.
    expect(bonds.equalMoney).toBeCloseTo(100 / 3, 6)
    expect(bonds.equalRisk).toBeLessThan(15)
    // Risk parity evens the risk out...
    for (const row of result.series) expect(row.parityRisk).toBeCloseTo(100 / 3, 1)
    // ...by putting more money in the calm asset than the volatile one.
    expect(bonds.parityMoney).toBeGreaterThan(equity.parityMoney)
    const money = result.series.reduce((sum, r) => sum + r.parityMoney, 0)
    expect(money).toBeCloseTo(100, 6)
  })

  it('backtesting: runs one test per path, deterministically', () => {
    const params = { ...defaultParams('backtesting'), paths: 12 }
    const a = runExperiment('backtesting', params)!
    expect(a.series).toHaveLength(12)
    expect(a).toEqual(runExperiment('backtesting', params))
  })

  it('backtesting: some random prices make a rule look like skill', () => {
    // There is nothing to predict in a random walk, so any path where the rule
    // wins is luck. The lesson only works if some paths win and some lose.
    const result = runExperiment('backtesting', { ...defaultParams('backtesting'), drift: 0 })!
    const wins = result.series.filter((r) => r.versusBuyAndHold > 0).length
    expect(wins).toBeGreaterThan(0)
    expect(wins).toBeLessThan(result.series.length)
    expect(result.interpretation).toMatch(/suerte|aleatori/i)
  })

  it('factors: more history narrows the band around the estimated alpha', () => {
    const result = runExperiment('factors', { ...defaultParams('factors'), years: 20 })!
    const width = (row: Record<string, number>) => row.alphaUpper - row.alphaLower
    const first = result.series[0]
    const last = result.series[result.series.length - 1]
    expect(width(last)).toBeLessThan(width(first) / 2)
    // Every band is a real band.
    for (const row of result.series) expect(row.alphaUpper).toBeGreaterThan(row.alphaLower)
  })

  it('factors: recovers the true market beta once there is enough history', () => {
    const result = runExperiment('factors', {
      ...defaultParams('factors'),
      marketBeta: 1.3,
      years: 20,
    })!
    const beta = result.highlights.find((h) => /beta/i.test(h.label))!
    expect(Number.parseFloat(beta.value)).toBeCloseTo(1.3, 1)
  })

  it('stress testing: correlations that jump in a crisis raise the risk', () => {
    const result = runExperiment('stressTesting', {
      assets: 10,
      volatility: 18,
      calmCorrelation: 0.2,
      crisisCorrelation: 0.8,
      crisisMultiplier: 1,
    })!
    const calm = result.series.find((r) => Math.abs(r.correlation - 0.2) < 1e-9)!
    const crisis = result.series.find((r) => Math.abs(r.correlation - 0.8) < 1e-9)!
    expect(crisis.calmVolatility).toBeGreaterThan(calm.calmVolatility)
  })

  it('stress testing: a crisis identical to the calm changes nothing', () => {
    const result = runExperiment('stressTesting', {
      assets: 10,
      volatility: 18,
      calmCorrelation: 0.4,
      crisisCorrelation: 0.4,
      crisisMultiplier: 1,
    })!
    const calm = result.highlights.find((h) => /calma/i.test(h.label))!
    const crisis = result.highlights.find((h) => /crisis/i.test(h.label))!
    expect(crisis.value).toBe(calm.value)
  })

  it('stress testing: cites where the crisis-correlation claim comes from', () => {
    // No financial claim without a documented source.
    expect(getExperiment('stressTesting')!.concept).toMatch(/Longin/)
  })
})

describe('getExperiment', () => {
  it('finds one by id', () => {
    expect(getExperiment('beta')!.title).toMatch(/beta/i)
  })

  it('returns null for an id it does not know', () => {
    expect(getExperiment('nonsense' as ExperimentId)).toBeNull()
  })
})
