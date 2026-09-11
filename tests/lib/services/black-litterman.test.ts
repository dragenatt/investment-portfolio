import { describe, it, expect } from 'vitest'
import {
  impliedEquilibriumReturns,
  blackLitterman,
  compareBlackLittermanVsMarkowitz,
  BLACK_LITTERMAN_CAVEAT,
  type View,
} from '@/lib/services/black-litterman'

/** Diagonal covariance from a list of volatilities. */
const diagCov = (vols: number[]) =>
  vols.map((v, i) => vols.map((w, j) => (i === j ? v * w : 0)))

function uniformCov(n: number, vol: number, correlation: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? vol * vol : vol * vol * correlation)),
  )
}

const symbols = ['A', 'B', 'C']
const cov = diagCov([0.15, 0.2, 0.25])
const marketWeights = [0.5, 0.3, 0.2]

describe('impliedEquilibriumReturns', () => {
  it('backs out the returns the market weights already imply', () => {
    // Reverse optimisation: instead of guessing returns and deriving weights,
    // take the weights the market actually holds and ask what returns would
    // make them optimal. No forecast required, which is the whole appeal.
    const implied = impliedEquilibriumReturns(cov, marketWeights, 2.5)!
    expect(implied).toHaveLength(3)
    for (const value of implied) expect(Number.isFinite(value)).toBe(true)
  })

  it('implies a higher return for the riskier asset at equal weight', () => {
    const equal = [1 / 3, 1 / 3, 1 / 3]
    const implied = impliedEquilibriumReturns(diagCov([0.1, 0.3, 0.5]), equal, 2.5)!
    expect(implied[2]).toBeGreaterThan(implied[1])
    expect(implied[1]).toBeGreaterThan(implied[0])
  })

  it('scales with risk aversion', () => {
    const timid = impliedEquilibriumReturns(cov, marketWeights, 5)!
    const bold = impliedEquilibriumReturns(cov, marketWeights, 2.5)!
    expect(timid[0] / bold[0]).toBeCloseTo(2, 8)
  })

  it('refuses weights that do not sum to 1', () => {
    expect(impliedEquilibriumReturns(cov, [0.5, 0.3, 0.1], 2.5)).toBeNull()
  })

  it('refuses mismatched dimensions', () => {
    expect(impliedEquilibriumReturns(cov, [0.5, 0.5], 2.5)).toBeNull()
  })

  it('refuses a non-positive risk aversion', () => {
    expect(impliedEquilibriumReturns(cov, marketWeights, 0)).toBeNull()
  })
})

describe('blackLitterman', () => {
  const equilibrium = impliedEquilibriumReturns(cov, marketWeights, 2.5)!

  it('returns the equilibrium untouched when there are no views', () => {
    // No opinion means no change. This is the property that makes the model
    // safe to ship: a user who says nothing gets the market's own answer.
    const result = blackLitterman(symbols, cov, equilibrium, [])!
    for (let i = 0; i < symbols.length; i++) {
      expect(result.posteriorReturns[i]).toBeCloseTo(equilibrium[i], 8)
    }
  })

  it('moves a return toward a view about that asset', () => {
    const bullish: View[] = [{ symbols: ['A'], weights: [1], expectedReturn: 0.5, confidence: 0.9 }]
    const result = blackLitterman(symbols, cov, equilibrium, bullish)!
    expect(result.posteriorReturns[0]).toBeGreaterThan(equilibrium[0])
  })

  it('moves further when the view is held with more confidence', () => {
    const view = (confidence: number): View[] => [
      { symbols: ['A'], weights: [1], expectedReturn: 0.5, confidence },
    ]
    const timid = blackLitterman(symbols, cov, equilibrium, view(0.1))!
    const certain = blackLitterman(symbols, cov, equilibrium, view(0.95))!

    const timidShift = timid.posteriorReturns[0] - equilibrium[0]
    const certainShift = certain.posteriorReturns[0] - equilibrium[0]
    expect(certainShift).toBeGreaterThan(timidShift)
  })

  it('barely moves at all on a view held with almost no confidence', () => {
    const doubtful: View[] = [
      { symbols: ['A'], weights: [1], expectedReturn: 2, confidence: 0.01 },
    ]
    const result = blackLitterman(symbols, cov, equilibrium, doubtful)!
    expect(Math.abs(result.posteriorReturns[0] - equilibrium[0])).toBeLessThan(0.2)
  })

  it('supports a relative view: A will beat B', () => {
    // The classic Black-Litterman view is not "A returns 8%" but "A beats B by
    // 3 points", which is a thing people can actually hold an opinion about.
    const relative: View[] = [
      { symbols: ['A', 'B'], weights: [1, -1], expectedReturn: 0.03, confidence: 0.8 },
    ]
    const result = blackLitterman(symbols, cov, equilibrium, relative)!
    const shiftA = result.posteriorReturns[0] - equilibrium[0]
    const shiftB = result.posteriorReturns[1] - equilibrium[1]
    expect(shiftA).toBeGreaterThan(shiftB)
  })

  it('leaves an asset no view touches close to where it started', () => {
    const aboutA: View[] = [{ symbols: ['A'], weights: [1], expectedReturn: 0.5, confidence: 0.9 }]
    const result = blackLitterman(symbols, cov, equilibrium, aboutA)!
    // C is uncorrelated with A here, so it should barely budge
    expect(result.posteriorReturns[2]).toBeCloseTo(equilibrium[2], 6)
  })

  it('spreads a view onto a correlated asset, which is the point of the model', () => {
    // With correlation, an opinion about one asset is partly an opinion about
    // its neighbours. A naive override would not do this.
    const correlated = uniformCov(3, 0.2, 0.8)
    const eq = impliedEquilibriumReturns(correlated, marketWeights, 2.5)!
    const aboutA: View[] = [{ symbols: ['A'], weights: [1], expectedReturn: 0.5, confidence: 0.9 }]
    const result = blackLitterman(symbols, correlated, eq, aboutA)!
    expect(result.posteriorReturns[1]).toBeGreaterThan(eq[1])
  })

  it('never emits a non-finite return', () => {
    const views: View[] = [
      { symbols: ['A', 'B'], weights: [1, -1], expectedReturn: 0.03, confidence: 0.5 },
      { symbols: ['C'], weights: [1], expectedReturn: 0.12, confidence: 0.4 },
    ]
    const result = blackLitterman(symbols, cov, equilibrium, views)!
    for (const value of result.posteriorReturns) expect(Number.isFinite(value)).toBe(true)
  })

  it('refuses a view about an unknown symbol', () => {
    const bad: View[] = [{ symbols: ['ZZZ'], weights: [1], expectedReturn: 0.1, confidence: 0.5 }]
    expect(blackLitterman(symbols, cov, equilibrium, bad)).toBeNull()
  })

  it('refuses a confidence outside zero and one', () => {
    const bad: View[] = [{ symbols: ['A'], weights: [1], expectedReturn: 0.1, confidence: 1.5 }]
    expect(blackLitterman(symbols, cov, equilibrium, bad)).toBeNull()
  })

  it('refuses a view whose symbols and weights do not line up', () => {
    const bad: View[] = [{ symbols: ['A', 'B'], weights: [1], expectedReturn: 0.1, confidence: 0.5 }]
    expect(blackLitterman(symbols, cov, equilibrium, bad)).toBeNull()
  })

  it('is deterministic', () => {
    const views: View[] = [{ symbols: ['A'], weights: [1], expectedReturn: 0.2, confidence: 0.6 }]
    expect(blackLitterman(symbols, cov, equilibrium, views)).toEqual(
      blackLitterman(symbols, cov, equilibrium, views),
    )
  })
})

describe('compareBlackLittermanVsMarkowitz', () => {
  const views: View[] = [
    { symbols: ['A', 'B'], weights: [1, -1], expectedReturn: 0.04, confidence: 0.7 },
  ]

  it('returns both portfolios and the equilibrium they started from', () => {
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, {
      riskFreeRate: 0.03,
    })!
    expect(result.equilibriumReturns).toHaveLength(3)
    expect(result.markowitz.weights).toHaveLength(3)
    expect(result.blackLitterman.weights).toHaveLength(3)
  })

  it('produces two real portfolios', () => {
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, {
      riskFreeRate: 0.03,
    })!
    for (const point of [result.markowitz, result.blackLitterman]) {
      expect(point.weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 8)
      for (const w of point.weights) expect(w.weight).toBeGreaterThanOrEqual(-1e-12)
    }
  })

  it('tilts toward the asset the view favours', () => {
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, {
      riskFreeRate: 0.03,
    })!
    const shift = result.weightShifts.find((s) => s.symbol === 'A')!
    expect(shift.deltaPp).toBeGreaterThan(0)
  })

  it('stays at the market portfolio when there are no views', () => {
    // No opinion, no deviation. The user who says nothing holds the market.
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, [], {
      riskFreeRate: 0.03,
    })!
    for (const w of result.blackLitterman.weights) {
      const market = marketWeights[symbols.indexOf(w.symbol)]
      expect(w.weight).toBeCloseTo(market, 2)
    }
  })

  it('round-trips: equilibrium returns rebuild the market weights', () => {
    // The defining property, and the reason the model is safe to ship. The
    // first version optimised max-Sharpe instead of utility and this came back
    // at 1.6% where the market held 50% — a different objective throws the
    // whole guarantee away.
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, [], {
      riskFreeRate: 0.03,
    })!
    for (const w of result.markowitz.weights) {
      expect(w.weight).toBeCloseTo(marketWeights[symbols.indexOf(w.symbol)], 3)
    }
  })

  it('explains in words how the views moved the weights', () => {
    const result = compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, {
      riskFreeRate: 0.03,
    })!
    expect(result.summary.length).toBeGreaterThan(80)
    expect(result.caveat).toBe(BLACK_LITTERMAN_CAVEAT)
  })

  it('refuses market weights that do not sum to 1', () => {
    expect(
      compareBlackLittermanVsMarkowitz(symbols, cov, [0.5, 0.3, 0.1], views, {
        riskFreeRate: 0.03,
      }),
    ).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { riskFreeRate: 0.03 }
    expect(compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, opts)).toEqual(
      compareBlackLittermanVsMarkowitz(symbols, cov, marketWeights, views, opts),
    )
  })
})
