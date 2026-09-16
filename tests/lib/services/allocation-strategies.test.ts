import { describe, it, expect } from 'vitest'
import {
  inverseVolatilityWeights,
  riskParityWeights,
  portfolioCVaR,
  minimiseCVaRWeights,
  compareAllocationStrategies,
} from '@/lib/services/allocation-strategies'

/** Diagonal covariance from a list of volatilities. */
const diagCov = (vols: number[]) =>
  vols.map((v, i) => vols.map((w, j) => (i === j ? v * w : 0)))

function uniformCov(n: number, vol: number, correlation: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? vol * vol : vol * vol * correlation)),
  )
}

/** Deterministic pseudo-normal series — no Math.random anywhere in a test. */
function series(n: number, vol: number, drift: number, seed: number): number[] {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: n }, () => {
    const u1 = Math.max(next(), 1e-12)
    const u2 = next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return drift + z * vol
  })
}

/** Risk contribution of each asset, as a share of total portfolio risk. */
function riskShares(weights: number[], cov: number[][]): number[] {
  const n = weights.length
  const marginal = weights.map((_, i) =>
    weights.reduce((sum, w, j) => sum + cov[i][j] * w, 0),
  )
  const variance = weights.reduce((sum, w, i) => sum + w * marginal[i], 0)
  return Array.from({ length: n }, (_, i) => (weights[i] * marginal[i]) / variance)
}

describe('inverseVolatilityWeights', () => {
  it('gives twice the weight to an asset half as volatile', () => {
    const w = inverseVolatilityWeights(diagCov([0.1, 0.2]))!
    expect(w[0] / w[1]).toBeCloseTo(2, 8)
  })

  it('splits evenly between assets of equal volatility', () => {
    for (const value of inverseVolatilityWeights(diagCov([0.2, 0.2, 0.2]))!) {
      expect(value).toBeCloseTo(1 / 3, 10)
    }
  })

  it('produces weights that sum to 1 and are non-negative', () => {
    const w = inverseVolatilityWeights(diagCov([0.05, 0.3, 0.12, 0.44]))!
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    for (const value of w) expect(value).toBeGreaterThan(0)
  })

  it('ignores correlation entirely, which is the whole point of the contrast', () => {
    // Same volatilities, wildly different correlations: identical answer.
    const a = inverseVolatilityWeights(uniformCov(3, 0.2, 0))!
    const b = inverseVolatilityWeights(uniformCov(3, 0.2, 0.9))!
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 10)
  })

  it('refuses an asset with no volatility rather than dividing by zero', () => {
    expect(inverseVolatilityWeights(diagCov([0.2, 0]))).toBeNull()
  })

  it('refuses a non-square or non-finite matrix', () => {
    expect(inverseVolatilityWeights([[0.04, 0.01]])).toBeNull()
    expect(inverseVolatilityWeights([[Number.NaN, 0], [0, 0.04]])).toBeNull()
  })
})

describe('riskParityWeights', () => {
  it('equalises each asset contribution to portfolio risk', () => {
    const cov = [
      [0.0400, 0.0060, 0.0020],
      [0.0060, 0.0225, 0.0030],
      [0.0020, 0.0030, 0.0100],
    ]
    const shares = riskShares(riskParityWeights(cov)!, cov)
    for (const share of shares) expect(share).toBeCloseTo(1 / 3, 4)
  })

  it('matches inverse volatility exactly when nothing is correlated', () => {
    // With a diagonal covariance the two methods agree; they diverge only when
    // correlation exists, which is the case risk parity is built for.
    const cov = diagCov([0.1, 0.3, 0.2])
    const parity = riskParityWeights(cov)!
    const naive = inverseVolatilityWeights(cov)!
    for (let i = 0; i < 3; i++) expect(parity[i]).toBeCloseTo(naive[i], 5)
  })

  it('diverges from inverse volatility when correlation exists', () => {
    const cov = [
      [0.0400, 0.0350, 0.0010],
      [0.0350, 0.0400, 0.0010],
      [0.0010, 0.0010, 0.0400],
    ]
    const parity = riskParityWeights(cov)!
    const naive = inverseVolatilityWeights(cov)!
    // Two assets nearly move as one, so the third carries real diversification
    // and should get more than an equal split
    expect(parity[2]).toBeGreaterThan(naive[2] + 0.05)
  })

  it('splits evenly between identical assets', () => {
    for (const value of riskParityWeights(uniformCov(4, 0.2, 0.3))!) {
      expect(value).toBeCloseTo(0.25, 6)
    }
  })

  it('produces weights that sum to 1 and are strictly positive', () => {
    const w = riskParityWeights(uniformCov(5, 0.22, 0.45))!
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    for (const value of w) expect(value).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const cov = uniformCov(4, 0.2, 0.35)
    expect(riskParityWeights(cov)).toEqual(riskParityWeights(cov))
  })

  it('refuses a degenerate matrix', () => {
    expect(riskParityWeights([[0, 0], [0, 0]])).toBeNull()
    expect(riskParityWeights([[0.04, 0.01]])).toBeNull()
  })

  it('handles a single asset by putting everything in it', () => {
    expect(riskParityWeights([[0.04]])).toEqual([1])
  })
})

describe('portfolioCVaR', () => {
  const matrix = [series(500, 0.012, 0.0004, 11), series(500, 0.020, 0.0006, 22)]

  it('reports a positive loss for a normal book', () => {
    expect(portfolioCVaR([0.5, 0.5], matrix, 95)!).toBeGreaterThan(0)
  })

  it('reports a larger loss for the more volatile asset alone', () => {
    expect(portfolioCVaR([0, 1], matrix, 95)!).toBeGreaterThan(portfolioCVaR([1, 0], matrix, 95)!)
  })

  it('shows that mixing two assets beats holding the worse one', () => {
    expect(portfolioCVaR([0.5, 0.5], matrix, 95)!).toBeLessThan(portfolioCVaR([0, 1], matrix, 95)!)
  })

  it('gets worse as the confidence level goes deeper into the tail', () => {
    expect(portfolioCVaR([0.5, 0.5], matrix, 99)!).toBeGreaterThanOrEqual(
      portfolioCVaR([0.5, 0.5], matrix, 95)!,
    )
  })

  it('refuses weights that do not sum to 1', () => {
    expect(portfolioCVaR([0.5, 0.2], matrix, 95)).toBeNull()
  })

  it('refuses series of different lengths', () => {
    expect(portfolioCVaR([0.5, 0.5], [series(500, 0.01, 0, 1), series(400, 0.01, 0, 2)], 95))
      .toBeNull()
  })

  it('refuses a sample too small for a tail', () => {
    expect(portfolioCVaR([1], [[0.01, -0.02, 0.005]], 95)).toBeNull()
  })
})

describe('minimiseCVaRWeights', () => {
  const matrix = [
    series(600, 0.010, 0.0003, 101),
    series(600, 0.025, 0.0008, 202),
    series(600, 0.016, 0.0005, 303),
  ]

  it('never returns a book with worse CVaR than equal weight', () => {
    // Guaranteed by construction: the search starts at equal weight and keeps
    // the best iterate, so it cannot hand back something worse than where it began
    const equal = [1 / 3, 1 / 3, 1 / 3]
    const optimised = minimiseCVaRWeights(matrix, 95)!
    expect(portfolioCVaR(optimised, matrix, 95)!).toBeLessThanOrEqual(
      portfolioCVaR(equal, matrix, 95)! + 1e-12,
    )
  })

  it('leans away from the asset with the worst tail', () => {
    const w = minimiseCVaRWeights(matrix, 95)!
    expect(w[0]).toBeGreaterThan(w[1])
  })

  it('produces weights that sum to 1 and are non-negative', () => {
    const w = minimiseCVaRWeights(matrix, 95)!
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    for (const value of w) expect(value).toBeGreaterThanOrEqual(-1e-12)
  })

  it('is deterministic', () => {
    expect(minimiseCVaRWeights(matrix, 95)).toEqual(minimiseCVaRWeights(matrix, 95))
  })

  it('puts everything in the only asset there is', () => {
    expect(minimiseCVaRWeights([series(200, 0.01, 0, 7)], 95)).toEqual([1])
  })

  it('refuses a sample too small to have a tail worth optimising', () => {
    expect(minimiseCVaRWeights([[0.01, -0.02], [0.005, 0.01]], 95)).toBeNull()
  })

  it('refuses a non-finite return', () => {
    const bad = series(600, 0.01, 0, 9)
    bad[10] = Number.POSITIVE_INFINITY
    expect(minimiseCVaRWeights([bad, series(600, 0.01, 0, 10)], 95)).toBeNull()
  })
})

describe('compareAllocationStrategies', () => {
  const symbols = ['SAFE', 'WILD', 'MID']
  const matrix = [
    series(600, 0.010, 0.0003, 101),
    series(600, 0.025, 0.0008, 202),
    series(600, 0.016, 0.0005, 303),
  ]

  it('reports every strategy it can compute, each with a full weight set', () => {
    const result = compareAllocationStrategies(symbols, matrix, 95)!
    expect(result.strategies.length).toBeGreaterThanOrEqual(3)
    for (const strategy of result.strategies) {
      const total = strategy.weights.reduce((s, w) => s + w.weight, 0)
      expect(total).toBeCloseTo(1, 8)
      for (const w of strategy.weights) expect(w.weight).toBeGreaterThanOrEqual(-1e-12)
      expect(strategy.weights.map((w) => w.symbol)).toEqual(symbols)
    }
  })

  it('includes equal weight as the baseline anyone can actually follow', () => {
    const result = compareAllocationStrategies(symbols, matrix, 95)!
    const equal = result.strategies.find((s) => s.id === 'equalWeight')!
    for (const w of equal.weights) expect(w.weight).toBeCloseTo(1 / 3, 10)
  })

  it('quotes volatility and CVaR for every strategy so they can be compared', () => {
    const result = compareAllocationStrategies(symbols, matrix, 95)!
    for (const strategy of result.strategies) {
      expect(Number.isFinite(strategy.volatilityPct)).toBe(true)
      expect(Number.isFinite(strategy.cvarPct)).toBe(true)
      expect(strategy.cvarPct).toBeGreaterThan(0)
    }
  })

  it('gives the CVaR-minimising strategy the lowest CVaR of the set', () => {
    const result = compareAllocationStrategies(symbols, matrix, 95)!
    const minCVaR = result.strategies.find((s) => s.id === 'minCVaR')!
    for (const strategy of result.strategies) {
      expect(minCVaR.cvarPct).toBeLessThanOrEqual(strategy.cvarPct + 1e-9)
    }
  })

  it('explains what each strategy optimises for, and says none is the answer', () => {
    const result = compareAllocationStrategies(symbols, matrix, 95)!
    for (const strategy of result.strategies) {
      expect(strategy.name.length).toBeGreaterThan(3)
      expect(strategy.rationale.length).toBeGreaterThan(40)
    }
    expect(result.caveat.length).toBeGreaterThan(80)
  })

  it('refuses mismatched symbols and series', () => {
    expect(compareAllocationStrategies(['A', 'B'], matrix, 95)).toBeNull()
  })

  it('refuses a history too short to say anything', () => {
    expect(compareAllocationStrategies(['A'], [[0.01, -0.01]], 95)).toBeNull()
  })

  it('is deterministic', () => {
    expect(compareAllocationStrategies(symbols, matrix, 95)).toEqual(
      compareAllocationStrategies(symbols, matrix, 95),
    )
  })
})

// ─── P1-32: minimise CVaR SUBJECT TO something ──────────────────────────────

import { resolveConstraints, satisfiesConstraints, type WeightConstraints } from '@/lib/services/weight-constraints'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

function bounds(n: number, constraints: WeightConstraints) {
  const resolved = resolveConstraints(n, constraints)
  if (!resolved.ok) throw new Error(`test expected feasible constraints, got ${resolved.reason}`)
  return resolved.constraints
}

describe('minimiseCVaRWeights under constraints', () => {
  // Three assets: the first is calm and goes nowhere, the third is wild and
  // pays. Unconstrained, minimum CVaR is almost entirely the calm one.
  function series(seed: number, vol: number, drift: number, length = 400): number[] {
    let s = seed >>> 0
    const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    return Array.from({ length }, () => {
      const u = next() || 1e-12
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()) * vol + drift
    })
  }
  const matrix = [series(1, 0.004, 0.00005), series(2, 0.011, 0.0004), series(3, 0.02, 0.0009)]
  const annual = matrix.map((s) => (s.reduce((a, b) => a + b, 0) / s.length) * TRADING_DAYS_PER_YEAR)

  it('puts the book in the calm asset when nothing is asked of the return', () => {
    const free = minimiseCVaRWeights(matrix, 95)!
    expect(free.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(free[0]).toBeGreaterThan(0.6)
  })

  it('moves the book to meet a minimum return, and says so in the weights', () => {
    const free = minimiseCVaRWeights(matrix, 95)!
    const freeReturn = free.reduce((s, w, i) => s + w * annual[i], 0)
    const target = freeReturn + (Math.max(...annual) - freeReturn) * 0.5

    const constraints = bounds(3, { minReturn: target, expectedReturns: annual })
    const constrained = minimiseCVaRWeights(matrix, 95, constraints)!

    expect(constrained.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    const achieved = constrained.reduce((s, w, i) => s + w * annual[i], 0)
    expect(achieved).toBeGreaterThanOrEqual(target - 1e-6)
    // Meeting a higher return costs tail risk — that is the trade-off the
    // constrained problem exists to show.
    expect(portfolioCVaR(constrained, matrix, 95)!).toBeGreaterThan(portfolioCVaR(free, matrix, 95)!)
    expect(satisfiesConstraints(constrained, constraints)).toBe(true)
  })

  it('respects a maximum weight', () => {
    const constraints = bounds(3, { maxWeight: 0.4 })
    const w = minimiseCVaRWeights(matrix, 95, constraints)!
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    for (const weight of w) expect(weight).toBeLessThanOrEqual(0.4 + 1e-6)
  })

  it('respects a sector cap', () => {
    const constraints = bounds(3, { sectors: ['Tech', 'Tech', 'Energy'], sectorCaps: { Tech: 0.5 } })
    const w = minimiseCVaRWeights(matrix, 95, constraints)!
    expect(w[0] + w[1]).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })

  it('refuses a return no feasible book can reach', () => {
    const impossible = resolveConstraints(3, { minReturn: Math.max(...annual) * 2, expectedReturns: annual })
    expect(impossible).toEqual({ ok: false, reason: 'min-return-unreachable' })
  })

  it('is unchanged when no constraint binds', () => {
    const free = minimiseCVaRWeights(matrix, 95)!
    const trivial = minimiseCVaRWeights(matrix, 95, bounds(3, {}))!
    expect(trivial).toEqual(free)
  })
})
