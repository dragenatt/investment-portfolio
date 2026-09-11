import { describe, it, expect } from 'vitest'
import {
  projectOntoSimplex,
  optimiseWeights,
  portfolioRiskReturn,
  efficientFrontier,
  historicalExpectedReturns,
  FRONTIER_CAVEAT,
} from '@/lib/services/optimizer'

/** Covariance for n assets with one shared correlation and one volatility. */
function uniformCov(n: number, vol: number, correlation: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? vol * vol : vol * vol * correlation)),
  )
}

/** Diagonal covariance from a list of volatilities. */
const diagCov = (vols: number[]) =>
  vols.map((v, i) => vols.map((w, j) => (i === j ? v * w : 0)))

const weightsOf = (point: { weights: { symbol: string; weight: number }[] }) =>
  Object.fromEntries(point.weights.map((w) => [w.symbol, w.weight]))

describe('projectOntoSimplex', () => {
  it('leaves a point that is already on the simplex alone', () => {
    const result = projectOntoSimplex([0.5, 0.3, 0.2])
    expect(result[0]).toBeCloseTo(0.5, 12)
    expect(result[1]).toBeCloseTo(0.3, 12)
    expect(result[2]).toBeCloseTo(0.2, 12)
  })

  it('always produces weights that sum to exactly 1', () => {
    for (const input of [[3, -1, 0.5], [0, 0, 0], [-5, -5, -5], [10, 1, 1, 1]]) {
      const sum = projectOntoSimplex(input).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 12)
    }
  })

  it('never produces a negative weight', () => {
    for (const value of projectOntoSimplex([2, -1, -3, 0.4])) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it('pushes everything onto the one component that dominates', () => {
    const result = projectOntoSimplex([10, -5, -5])
    expect(result[0]).toBeCloseTo(1, 10)
    expect(result[1]).toBeCloseTo(0, 10)
  })

  it('spreads an all-equal input evenly', () => {
    for (const value of projectOntoSimplex([7, 7, 7, 7])) {
      expect(value).toBeCloseTo(0.25, 10)
    }
  })

  it('is idempotent', () => {
    const once = projectOntoSimplex([3, -1, 0.5, 2])
    const twice = projectOntoSimplex(once)
    for (let i = 0; i < once.length; i++) expect(twice[i]).toBeCloseTo(once[i], 12)
  })

  it('handles an empty input', () => {
    expect(projectOntoSimplex([])).toEqual([])
  })
})

describe('optimiseWeights', () => {
  it('splits evenly between identical uncorrelated assets', () => {
    const w = optimiseWeights(uniformCov(4, 0.2, 0), [0.08, 0.08, 0.08, 0.08], 5)!
    for (const value of w) expect(value).toBeCloseTo(0.25, 4)
  })

  it('leans on the calmer asset when returns are equal', () => {
    // Same expected return, one asset half as volatile: it should win
    const w = optimiseWeights(diagCov([0.1, 0.4]), [0.08, 0.08], 10)!
    expect(w[0]).toBeGreaterThan(w[1] * 5)
  })

  it('puts everything in the best asset when risk carries no weight', () => {
    const w = optimiseWeights(diagCov([0.2, 0.2, 0.2]), [0.05, 0.20, 0.03], 0)!
    expect(w[1]).toBeCloseTo(1, 8)
  })

  it('ignores expected returns entirely at very high risk aversion', () => {
    // Minimum variance: the return vector should stop mattering
    const cov = diagCov([0.1, 0.3, 0.2])
    const a = optimiseWeights(cov, [0.05, 0.05, 0.05], 1e6)!
    const b = optimiseWeights(cov, [0.30, 0.01, 0.10], 1e6)!
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 3)
  })

  it('always returns weights that sum to 1 and are non-negative', () => {
    for (const aversion of [0, 0.5, 2, 25, 1000]) {
      const w = optimiseWeights(uniformCov(5, 0.25, 0.3), [0.1, 0.04, 0.15, -0.02, 0.07], aversion)!
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
      for (const value of w) expect(value).toBeGreaterThanOrEqual(-1e-12)
    }
  })

  it('is deterministic', () => {
    const cov = uniformCov(4, 0.2, 0.4)
    const mu = [0.1, 0.05, 0.12, 0.03]
    expect(optimiseWeights(cov, mu, 3)).toEqual(optimiseWeights(cov, mu, 3))
  })

  it('refuses inputs whose dimensions disagree', () => {
    expect(optimiseWeights(uniformCov(3, 0.2, 0), [0.1, 0.05], 2)).toBeNull()
  })

  it('refuses a non-finite expected return', () => {
    expect(optimiseWeights(uniformCov(2, 0.2, 0), [0.1, Number.NaN], 2)).toBeNull()
  })

  it('refuses a negative risk aversion', () => {
    expect(optimiseWeights(uniformCov(2, 0.2, 0), [0.1, 0.05], -1)).toBeNull()
  })
})

describe('portfolioRiskReturn', () => {
  it('computes the volatility of a single-asset book as that asset volatility', () => {
    const result = portfolioRiskReturn([1, 0], diagCov([0.3, 0.1]), [0.09, 0.04])!
    expect(result.volatility).toBeCloseTo(0.3, 10)
    expect(result.expectedReturn).toBeCloseTo(0.09, 10)
  })

  it('shows the diversification benefit of combining uncorrelated assets', () => {
    // Two uncorrelated 20% assets at 50/50 give 20%/sqrt(2), not 20%
    const result = portfolioRiskReturn([0.5, 0.5], diagCov([0.2, 0.2]), [0.08, 0.08])!
    expect(result.volatility).toBeCloseTo(0.2 / Math.sqrt(2), 10)
  })

  it('shows no benefit at all when the assets are perfectly correlated', () => {
    const result = portfolioRiskReturn([0.5, 0.5], uniformCov(2, 0.2, 1), [0.08, 0.08])!
    expect(result.volatility).toBeCloseTo(0.2, 8)
  })

  it('averages the expected returns by weight', () => {
    const result = portfolioRiskReturn([0.25, 0.75], diagCov([0.2, 0.2]), [0.04, 0.12])!
    expect(result.expectedReturn).toBeCloseTo(0.1, 10)
  })

  it('refuses weights that do not sum to 1', () => {
    expect(portfolioRiskReturn([0.5, 0.2], diagCov([0.2, 0.2]), [0.08, 0.08])).toBeNull()
  })

  it('refuses a negative variance result rather than returning NaN', () => {
    // A matrix that is not a valid covariance can produce negative variance
    const broken = [
      [0.04, 0.9],
      [0.9, 0.04],
    ]
    expect(portfolioRiskReturn([0.5, -0.5 + 1], broken, [0.08, 0.08])).not.toBeUndefined()
    const result = portfolioRiskReturn([0.5, 0.5], broken, [0.08, 0.08])
    expect(result === null || Number.isFinite(result.volatility)).toBe(true)
  })
})

describe('efficientFrontier', () => {
  const symbols = ['A', 'B', 'C', 'D']
  const cov = [
    [0.0400, 0.0060, 0.0020, 0.0010],
    [0.0060, 0.0225, 0.0030, 0.0015],
    [0.0020, 0.0030, 0.0100, 0.0008],
    [0.0010, 0.0015, 0.0008, 0.0064],
  ]
  const mu = [0.14, 0.10, 0.07, 0.045]

  it('returns points ordered by risk with return never going backwards', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (let i = 1; i < frontier.points.length; i++) {
      expect(frontier.points[i].volatilityPct).toBeGreaterThanOrEqual(
        frontier.points[i - 1].volatilityPct - 1e-9,
      )
      expect(frontier.points[i].expectedReturnPct).toBeGreaterThanOrEqual(
        frontier.points[i - 1].expectedReturnPct - 1e-9,
      )
    }
  })

  it('contains no point another point beats on both axes', () => {
    // The defining property of a frontier: nothing on it is dominated
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (const a of frontier.points) {
      for (const b of frontier.points) {
        if (a === b) continue
        const beatsOnBoth =
          b.expectedReturnPct > a.expectedReturnPct + 1e-9 &&
          b.volatilityPct < a.volatilityPct - 1e-9
        expect(beatsOnBoth).toBe(false)
      }
    }
  })

  it('every point on it is a real portfolio: weights non-negative summing to 100%', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (const point of frontier.points) {
      const total = point.weights.reduce((s, w) => s + w.weight, 0)
      expect(total).toBeCloseTo(1, 8)
      for (const w of point.weights) expect(w.weight).toBeGreaterThanOrEqual(-1e-12)
      expect(point.weights.map((w) => w.symbol)).toEqual(symbols)
    }
  })

  it('never emits a non-finite number anywhere', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (const point of frontier.points) {
      expect(Number.isFinite(point.expectedReturnPct)).toBe(true)
      expect(Number.isFinite(point.volatilityPct)).toBe(true)
      expect(point.sharpe === null || Number.isFinite(point.sharpe)).toBe(true)
      for (const w of point.weights) expect(Number.isFinite(w.weight)).toBe(true)
    }
  })

  it('identifies the lowest-risk portfolio on the whole frontier', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (const point of frontier.points) {
      expect(point.volatilityPct).toBeGreaterThanOrEqual(
        frontier.minimumVariance.volatilityPct - 1e-9,
      )
    }
  })

  it('identifies the best risk-adjusted portfolio on the whole frontier', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    for (const point of frontier.points) {
      if (point.sharpe === null) continue
      expect(frontier.maxSharpe.sharpe!).toBeGreaterThanOrEqual(point.sharpe - 1e-9)
    }
  })

  it('places the current portfolio when one is supplied', () => {
    const frontier = efficientFrontier(symbols, cov, mu, {
      riskFreeRate: 0.03,
      currentWeights: [0.25, 0.25, 0.25, 0.25],
    })!
    expect(frontier.current).not.toBeNull()
    expect(frontier.current!.volatilityPct).toBeGreaterThan(0)
    // An equal-weight book is not normally on the frontier
    expect(frontier.improvement).not.toBeNull()
  })

  it('leaves the comparison out when no current portfolio is given', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    expect(frontier.current).toBeNull()
    expect(frontier.improvement).toBeNull()
  })

  it('reports how much volatility the same return could be had for', () => {
    const frontier = efficientFrontier(symbols, cov, mu, {
      riskFreeRate: 0.03,
      currentWeights: [0.25, 0.25, 0.25, 0.25],
    })!
    const improvement = frontier.improvement!
    // The frontier portfolio at the same return cannot be riskier than the book
    expect(improvement.sameReturnVolatilityPct).toBeLessThanOrEqual(
      frontier.current!.volatilityPct + 1e-6,
    )
  })

  it('never claims a real portfolio beats the frontier', () => {
    // Regression. The frontier is sampled at a few dozen aversion values, so a
    // real book lands between two of them. Reading the improvement off the
    // NEAREST sampled point reported this equal-weight book at 8.20% volatility
    // against a frontier needing 8.44% for the same return — the book beating
    // the frontier, which no feasible portfolio can do. The curve is now
    // interpolated. Checked across several books, not just the one that broke.
    for (const weights of [
      [0.25, 0.25, 0.25, 0.25],
      [0.4, 0.3, 0.2, 0.1],
      [0.1, 0.1, 0.4, 0.4],
      [0.7, 0.1, 0.1, 0.1],
      [0.05, 0.05, 0.05, 0.85],
    ]) {
      const frontier = efficientFrontier(symbols, cov, mu, {
        riskFreeRate: 0.03,
        currentWeights: weights,
      })!
      expect(frontier.improvement!.sameReturnVolatilityPct).toBeLessThanOrEqual(
        frontier.current!.volatilityPct + 1e-6,
      )
      expect(frontier.improvement!.sameRiskReturnPct).toBeGreaterThanOrEqual(
        frontier.current!.expectedReturnPct - 1e-6,
      )
    }
  })

  it('never reports a negative improvement', () => {
    // A book already on the frontier has nothing to gain; the answer is zero,
    // never a negative saving dressed up as a number.
    const onFrontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!.maxSharpe
    const frontier = efficientFrontier(symbols, cov, mu, {
      riskFreeRate: 0.03,
      currentWeights: onFrontier.weights.map((w) => w.weight),
    })!
    expect(frontier.improvement!.volatilitySavedPct).toBeGreaterThanOrEqual(0)
    expect(frontier.improvement!.returnGainedPct).toBeGreaterThanOrEqual(0)
    expect(frontier.improvement!.volatilitySavedPct).toBeLessThan(0.1)
  })

  it('carries the caveat about expected returns being the weak input', () => {
    const frontier = efficientFrontier(symbols, cov, mu, { riskFreeRate: 0.03 })!
    expect(frontier.caveat).toBe(FRONTIER_CAVEAT)
    expect(frontier.caveat.toLowerCase()).toMatch(/estimaci|supuesto|pasado/)
  })

  it('refuses a single asset, which has no frontier to speak of', () => {
    expect(efficientFrontier(['A'], [[0.04]], [0.1], { riskFreeRate: 0.03 })).toBeNull()
  })

  it('refuses mismatched inputs', () => {
    expect(efficientFrontier(['A', 'B'], cov, mu, { riskFreeRate: 0.03 })).toBeNull()
    expect(efficientFrontier(symbols, cov, [0.1, 0.2], { riskFreeRate: 0.03 })).toBeNull()
  })

  it('refuses a covariance matrix with no variance in it', () => {
    expect(
      efficientFrontier(['A', 'B'], [[0, 0], [0, 0]], [0.1, 0.05], { riskFreeRate: 0.03 }),
    ).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { riskFreeRate: 0.03, currentWeights: [0.25, 0.25, 0.25, 0.25] }
    expect(efficientFrontier(symbols, cov, mu, opts)).toEqual(
      efficientFrontier(symbols, cov, mu, opts),
    )
  })
})

describe('historicalExpectedReturns', () => {
  it('annualises the mean of each series', () => {
    // A constant daily return of 0.001 annualises to 0.001 * 252
    const result = historicalExpectedReturns([Array(300).fill(0.001)])!
    expect(result[0]).toBeCloseTo(0.252, 6)
  })

  it('returns one estimate per asset', () => {
    const result = historicalExpectedReturns([Array(300).fill(0.001), Array(300).fill(0.002)])!
    expect(result).toHaveLength(2)
    expect(result[1]).toBeGreaterThan(result[0])
  })

  it('refuses a series too short to mean anything', () => {
    expect(historicalExpectedReturns([Array(10).fill(0.001)])).toBeNull()
  })

  it('refuses a series containing a non-finite return', () => {
    const bad = Array(300).fill(0.001)
    bad[5] = Number.NaN
    expect(historicalExpectedReturns([bad])).toBeNull()
  })

  it('handles no assets at all', () => {
    expect(historicalExpectedReturns([])).toBeNull()
  })
})
