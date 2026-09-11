import { describe, it, expect } from 'vitest'
import {
  worstCaseReturns,
  midpointReturns,
  compareRobustVsClassic,
  weightSensitivity,
  ROBUST_CAVEAT,
  type ReturnRange,
} from '@/lib/services/robust-optimizer'

/** Diagonal covariance from a list of volatilities. */
const diagCov = (vols: number[]) =>
  vols.map((v, i) => vols.map((w, j) => (i === j ? v * w : 0)))

const range = (symbol: string, low: number, high: number): ReturnRange => ({ symbol, low, high })

describe('worstCaseReturns and midpointReturns', () => {
  const ranges = [range('A', 0.08, 0.12), range('B', 0.04, 0.06)]

  it('takes the low end of every range as the worst case', () => {
    // For long-only weights the worst point of a box is exactly its lower
    // corner, because every weight is non-negative. No search needed.
    expect(worstCaseReturns(ranges)).toEqual([0.08, 0.04])
  })

  it('takes the middle as the classic point estimate', () => {
    expect(midpointReturns(ranges)).toEqual([0.1, 0.05])
  })

  it('handles a range with no width, which is a point estimate', () => {
    expect(worstCaseReturns([range('A', 0.1, 0.1)])).toEqual([0.1])
    expect(midpointReturns([range('A', 0.1, 0.1)])).toEqual([0.1])
  })

  it('returns null when a range is inverted', () => {
    expect(worstCaseReturns([range('A', 0.12, 0.08)])).toBeNull()
    expect(midpointReturns([range('A', 0.12, 0.08)])).toBeNull()
  })

  it('returns null for a non-finite bound', () => {
    expect(worstCaseReturns([range('A', Number.NaN, 0.1)])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(worstCaseReturns([])).toBeNull()
  })
})

describe('compareRobustVsClassic', () => {
  const symbols = ['SURE', 'UNSURE']
  // Identical volatility and identical midpoint return: the ONLY difference
  // between the two assets is how confident we are about the estimate.
  const cov = diagCov([0.2, 0.2])
  const ranges = [range('SURE', 0.09, 0.11), range('UNSURE', 0.02, 0.18)]

  it('gives less weight to the asset whose estimate is less certain', () => {
    // Same expected return at the midpoint, same risk. Classic mean-variance
    // cannot tell them apart; the robust version can, and that is the point.
    const result = compareRobustVsClassic(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    const robust = Object.fromEntries(result.robust.weights.map((w) => [w.symbol, w.weight]))
    expect(robust.SURE).toBeGreaterThan(robust.UNSURE)
  })

  it('leaves the classic answer indifferent between them', () => {
    const result = compareRobustVsClassic(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    const classic = Object.fromEntries(result.classic.weights.map((w) => [w.symbol, w.weight]))
    expect(classic.SURE).toBeCloseTo(classic.UNSURE, 3)
  })

  it('reports how far each weight moved, in percentage points', () => {
    const result = compareRobustVsClassic(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    for (const shift of result.weightShifts) {
      expect(shift.deltaPp).toBeCloseTo((shift.robustWeight - shift.classicWeight) * 100, 8)
    }
  })

  it('produces two real portfolios: non-negative weights summing to 100%', () => {
    const result = compareRobustVsClassic(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    for (const point of [result.classic, result.robust]) {
      expect(point.weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 8)
      for (const w of point.weights) expect(w.weight).toBeGreaterThanOrEqual(-1e-12)
    }
  })

  it('agrees with the classic answer when every range is a point', () => {
    // No uncertainty means nothing to be robust against.
    const certain = [range('SURE', 0.1, 0.1), range('UNSURE', 0.1, 0.1)]
    const result = compareRobustVsClassic(symbols, cov, certain, { riskFreeRate: 0.03 })!
    for (const shift of result.weightShifts) {
      expect(Math.abs(shift.deltaPp)).toBeLessThan(0.5)
    }
  })

  it('explains what robust optimisation actually did', () => {
    const result = compareRobustVsClassic(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    expect(result.summary.length).toBeGreaterThan(80)
    expect(result.caveat).toBe(ROBUST_CAVEAT)
  })

  it('refuses ranges that do not match the symbols', () => {
    expect(
      compareRobustVsClassic(symbols, cov, [range('SURE', 0.09, 0.11)], { riskFreeRate: 0.03 }),
    ).toBeNull()
  })

  it('refuses an inverted range', () => {
    expect(
      compareRobustVsClassic(symbols, cov, [range('SURE', 0.11, 0.09), range('UNSURE', 0.02, 0.18)], {
        riskFreeRate: 0.03,
      }),
    ).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { riskFreeRate: 0.03 }
    expect(compareRobustVsClassic(symbols, cov, ranges, opts)).toEqual(
      compareRobustVsClassic(symbols, cov, ranges, opts),
    )
  })
})

describe('weightSensitivity', () => {
  const symbols = ['A', 'B', 'C']
  const cov = diagCov([0.15, 0.2, 0.25])

  it('shows a wider swing for the asset with the wider range', () => {
    const ranges = [range('A', 0.099, 0.101), range('B', 0.02, 0.18), range('C', 0.09, 0.11)]
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    const by = Object.fromEntries(result.perAsset.map((a) => [a.symbol, a.spreadPp]))
    expect(by.B).toBeGreaterThan(by.A)
  })

  it('reports no swing at all when nothing is uncertain', () => {
    const certain = symbols.map((s) => range(s, 0.1, 0.1))
    const result = weightSensitivity(symbols, cov, certain, { riskFreeRate: 0.03 })!
    for (const asset of result.perAsset) {
      expect(asset.spreadPp).toBeLessThan(0.5)
    }
  })

  it('brackets the midpoint weight between the extremes it found', () => {
    const ranges = [range('A', 0.08, 0.12), range('B', 0.04, 0.16), range('C', 0.09, 0.11)]
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    for (const asset of result.perAsset) {
      expect(asset.midpointWeight).toBeGreaterThanOrEqual(asset.minWeight - 1e-9)
      expect(asset.midpointWeight).toBeLessThanOrEqual(asset.maxWeight + 1e-9)
    }
  })

  it('names the asset whose weight is least stable', () => {
    const ranges = [range('A', 0.099, 0.101), range('B', 0.02, 0.18), range('C', 0.09, 0.11)]
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    expect(result.mostSensitive).toBe('B')
  })

  it('keeps every sampled weight a real weight', () => {
    const ranges = [range('A', 0.08, 0.12), range('B', 0.04, 0.16), range('C', 0.09, 0.11)]
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    for (const asset of result.perAsset) {
      expect(asset.minWeight).toBeGreaterThanOrEqual(-1e-12)
      expect(asset.maxWeight).toBeLessThanOrEqual(1 + 1e-9)
      expect(Number.isFinite(asset.spreadPp)).toBe(true)
    }
  })

  it('says how many combinations it tried', () => {
    const ranges = symbols.map((s) => range(s, 0.08, 0.12))
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    // Three assets, each at its low or high: eight corners of the box
    expect(result.samples).toBe(8)
  })

  it('caps the sampling rather than exploding on a large book', () => {
    // 2^20 corners is not a plan. It must stay bounded and still answer.
    const many = Array.from({ length: 20 }, (_, i) => `S${i}`)
    const bigCov = diagCov(Array(20).fill(0.2))
    const bigRanges = many.map((s) => range(s, 0.05, 0.15))
    const result = weightSensitivity(many, bigCov, bigRanges, { riskFreeRate: 0.03 })!
    expect(result.samples).toBeLessThanOrEqual(256)
    expect(result.perAsset).toHaveLength(20)
  })

  it('explains the finding rather than only measuring it', () => {
    const ranges = [range('A', 0.099, 0.101), range('B', 0.02, 0.18), range('C', 0.09, 0.11)]
    const result = weightSensitivity(symbols, cov, ranges, { riskFreeRate: 0.03 })!
    expect(result.summary.length).toBeGreaterThan(80)
  })

  it('refuses mismatched inputs', () => {
    expect(weightSensitivity(symbols, cov, [range('A', 0.08, 0.12)], { riskFreeRate: 0.03 })).toBeNull()
  })

  it('is deterministic', () => {
    const ranges = [range('A', 0.08, 0.12), range('B', 0.04, 0.16), range('C', 0.09, 0.11)]
    const opts = { riskFreeRate: 0.03 }
    expect(weightSensitivity(symbols, cov, ranges, opts)).toEqual(
      weightSensitivity(symbols, cov, ranges, opts),
    )
  })
})
