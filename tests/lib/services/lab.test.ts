import { describe, it, expect } from 'vitest'
import {
  listExperiments,
  getExperiment,
  runExperiment,
  defaultParams,
  type ExperimentId,
} from '@/lib/services/lab'

describe('the catalogue', () => {
  it('covers the experiments the roadmap names', () => {
    const ids = listExperiments().map((e) => e.id)
    for (const id of [
      'diversification',
      'correlation',
      'riskReturn',
      'monteCarlo',
      'var',
      'beta',
      'drawdown',
      'rebalancing',
      'markowitz',
      'stressTesting',
    ] as ExperimentId[]) {
      expect(ids).toContain(id)
    }
  })

  it('gives every experiment the parts the roadmap asks for', () => {
    for (const experiment of listExperiments()) {
      expect(experiment.title.length).toBeGreaterThan(3)
      expect(experiment.objective.length).toBeGreaterThan(20)
      expect(experiment.concept.length).toBeGreaterThan(40)
      expect(experiment.questions.length).toBeGreaterThanOrEqual(2)
      for (const question of experiment.questions) {
        expect(question.length).toBeGreaterThan(15)
      }
    }
  })

  it('lists the experiments whose engine is missing rather than hiding them', () => {
    const unavailable = listExperiments().filter((e) => !e.available)
    expect(unavailable.map((e) => e.id)).toContain('markowitz')
    for (const experiment of unavailable) {
      expect(experiment.unavailableReason!.length).toBeGreaterThan(30)
      expect(experiment.run).toBeUndefined()
    }
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

  it('refuses to run an experiment whose engine is missing', () => {
    expect(runExperiment('markowitz')).toBeNull()
    expect(runExperiment('stressTesting')).toBeNull()
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

describe('getExperiment', () => {
  it('finds one by id', () => {
    expect(getExperiment('beta')!.title).toMatch(/beta/i)
  })

  it('returns null for an id it does not know', () => {
    expect(getExperiment('nonsense' as ExperimentId)).toBeNull()
  })
})
