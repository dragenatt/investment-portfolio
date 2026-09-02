// Monte Carlo portfolio simulation — pure functions, no I/O, fully unit-testable.
//
// Each asset follows a geometric Brownian motion, discretised weekly:
//
//   S(t+Δt) = S(t)·exp((μ − σ²/2)·Δt + σ·√Δt·z)
//
// where z is a *correlated* standard normal shock. The correlation comes from
// the assets' own history: covariance matrix → correlation matrix → Cholesky
// factor L, and then z = L·ε with ε a vector of independent standard normals.
//
// Why the correlation matrix and not Σ directly: σ already multiplies the shock
// in the formula above, so factoring Σ would apply the volatility twice. Taking
// L from the correlation matrix leaves the shocks with unit variance, which is
// exactly what that formula expects.
//
// The whole simulation runs on a portfolio normalised to 1.0 at week 0, so the
// caller scales the bands by whatever the book is worth today. That keeps the
// engine free of currency, quantities and I/O.

import { calculateVolatility } from './analytics'
import { calculateCovarianceMatrix, choleskyDecomposition } from './covariance'

const TRADING_DAYS = 252
const WEEKS_PER_YEAR = 52
const DEFAULT_WEEKS = 52
const DEFAULT_SIMULATIONS = 1500

// Fixed by default so the same portfolio yields the same cone on every refresh
// (and so the tests can't flake). Pass `seed` to explore a different draw.
const DEFAULT_SEED = 20260901

export type MonteCarloAsset = {
  symbol: string
  weight: number
  historicalReturns: number[]
}

export type WeeklyBand = {
  week: number
  p10: number
  p50: number
  p90: number
}

export type MonteCarloResult = {
  /** Week 0 is the deterministic starting point (1.0), so the cone opens from a point. */
  weeklyBands: WeeklyBand[]
  /** Portfolio value at the final week, one entry per simulation, sorted ascending. */
  finalValueDistribution: number[]
  /**
   * Loss at the 5% worst case, as a fraction of the starting value
   * (0.23 = "95% of the time you don't lose more than 23%"). A negative value
   * means even the 5% worst case finishes above where it started.
   */
  var95: number
}

/** mulberry32 — small, fast, seedable. Deterministic across platforms. */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normals via Box-Muller, keeping the second of each pair. */
function createNormalSampler(seed: number): () => number {
  const rng = createRng(seed)
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    let u = 0
    while (u === 0) u = rng() // log(0) would be -Infinity
    const v = rng()
    const radius = Math.sqrt(-2 * Math.log(u))
    const theta = 2 * Math.PI * v
    spare = radius * Math.sin(theta)
    return radius * Math.cos(theta)
  }
}

/** Linear-interpolated percentile of an ascending-sorted array. p is 0..1. */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0]
  const position = (n - 1) * Math.min(Math.max(p, 0), 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedAsc[lower]
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (position - lower)
}

/** Σ → correlation matrix, clamped to [-1, 1] against floating-point drift. */
function correlationFromCovariance(cov: number[][]): number[][] {
  const n = cov.length
  const stdDevs = cov.map((row, i) => Math.sqrt(Math.max(row[i], 0)))
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1
      const denominator = stdDevs[i] * stdDevs[j]
      if (denominator <= 0) return 0 // a flat series correlates with nothing
      return Math.min(Math.max(cov[i][j] / denominator, -1), 1)
    })
  )
}

/**
 * Simulate a portfolio forward with correlated GBM paths.
 *
 * μ and σ are estimated per asset from `historicalReturns` (daily), annualised
 * the same way the rest of the analytics layer does it: μ = mean·252 and
 * σ = calculateVolatility (which already applies √252).
 *
 * Weights are normalised, so the portfolio starts at exactly 1.0 and every
 * number returned is a multiple of today's value.
 */
export function simulatePortfolioGBM(params: {
  assets: MonteCarloAsset[]
  weeks?: number
  numSimulations?: number
  seed?: number
}): MonteCarloResult {
  const {
    assets,
    weeks = DEFAULT_WEEKS,
    numSimulations = DEFAULT_SIMULATIONS,
    seed = DEFAULT_SEED,
  } = params

  const assetCount = assets.length
  const totalWeeks = Math.floor(weeks)
  const paths = Math.floor(numSimulations)

  if (assetCount === 0 || totalWeeks < 1 || paths < 1) {
    return { weeklyBands: [], finalValueDistribution: [], var95: 0 }
  }

  // Normalised so the portfolio is worth exactly 1.0 at week 0.
  const weightSum = assets.reduce((sum, a) => sum + a.weight, 0)
  const weights =
    weightSum > 0
      ? assets.map((a) => a.weight / weightSum)
      : assets.map(() => 1 / assetCount)

  const mu = assets.map((a) =>
    a.historicalReturns.length > 0
      ? (a.historicalReturns.reduce((x, y) => x + y, 0) / a.historicalReturns.length) * TRADING_DAYS
      : 0
  )
  const sigma = assets.map((a) => calculateVolatility(a.historicalReturns))

  const covariance = calculateCovarianceMatrix(assets.map((a) => a.historicalReturns))
  const cholesky = choleskyDecomposition(correlationFromCovariance(covariance))

  const dt = 1 / WEEKS_PER_YEAR
  const sqrtDt = Math.sqrt(dt)
  const drift = mu.map((m, i) => (m - (sigma[i] * sigma[i]) / 2) * dt)
  const diffusion = sigma.map((s) => s * sqrtDt)

  const nextNormal = createNormalSampler(seed)

  // valuesByWeek[w][sim] — portfolio value at week w+1 on path `sim`.
  const valuesByWeek: number[][] = Array.from({ length: totalWeeks }, () =>
    new Array<number>(paths).fill(0)
  )
  const prices = new Array<number>(assetCount).fill(1)
  const shocks = new Array<number>(assetCount).fill(0)

  for (let sim = 0; sim < paths; sim++) {
    for (let i = 0; i < assetCount; i++) prices[i] = 1

    for (let week = 0; week < totalWeeks; week++) {
      for (let i = 0; i < assetCount; i++) shocks[i] = nextNormal()

      let portfolioValue = 0
      for (let i = 0; i < assetCount; i++) {
        // z = (L·ε)_i — L is lower triangular, so only k ≤ i contribute.
        let z = 0
        for (let k = 0; k <= i; k++) z += cholesky[i][k] * shocks[k]

        prices[i] *= Math.exp(drift[i] + diffusion[i] * z)
        portfolioValue += weights[i] * prices[i]
      }
      valuesByWeek[week][sim] = portfolioValue
    }
  }

  const weeklyBands: WeeklyBand[] = [{ week: 0, p10: 1, p50: 1, p90: 1 }]
  for (let week = 0; week < totalWeeks; week++) {
    const sorted = valuesByWeek[week].slice().sort((a, b) => a - b)
    weeklyBands.push({
      week: week + 1,
      p10: percentile(sorted, 0.1),
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
    })
  }

  const finalValueDistribution = valuesByWeek[totalWeeks - 1].slice().sort((a, b) => a - b)
  const var95 = 1 - percentile(finalValueDistribution, 0.05)

  return { weeklyBands, finalValueDistribution, var95 }
}
