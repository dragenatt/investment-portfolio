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
import { createNormalSampler } from '@/lib/utils/random'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'

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

/** Drift and volatility per asset, and the Cholesky factor of their correlation. */
export type GbmInputs = {
  /** Annualised arithmetic mean return per asset. */
  mu: number[]
  /** Annualised volatility per asset. */
  sigma: number[]
  /** Lower-triangular factor of the correlation matrix (not the covariance). */
  cholesky: number[][]
}

/**
 * GBM parameters from daily return histories, one row per asset.
 *
 * μ = mean·252 and σ = calculateVolatility (which already applies √252), the
 * same way the rest of the analytics layer annualises.
 */
export function gbmInputsFromHistory(returnsMatrix: number[][]): GbmInputs {
  const mu = returnsMatrix.map((returns) =>
    returns.length > 0
      ? (returns.reduce((x, y) => x + y, 0) / returns.length) * TRADING_DAYS
      : 0
  )
  const sigma = returnsMatrix.map((returns) => calculateVolatility(returns))
  const covariance = calculateCovarianceMatrix(returnsMatrix)
  const cholesky = choleskyDecomposition(correlationFromCovariance(covariance))
  return { mu, sigma, cholesky }
}

/**
 * Walk correlated GBM price paths step by step — the one generator every
 * simulation here is built on.
 *
 * `onStep(sim, step, relatives)` receives each asset's price relative to the
 * start of the path (1.0 at step 0) after `step + 1` steps. The shocks are drawn
 * per path, per step, per asset, in that order, from one seeded stream, so any
 * two consumers asking for the same inputs, steps and seed see the same futures.
 * `relatives` is reused between calls; copy it to keep it.
 *
 * Weekly for the portfolio cone and the scenario comparison, monthly for the
 * scenario engine (P2-9): the discretisation is the caller's choice, the
 * process is not.
 */
export function forEachCorrelatedStep(
  params: { inputs: GbmInputs; steps: number; stepsPerYear: number; numSimulations: number; seed: number },
  onStep: (sim: number, step: number, relatives: number[]) => void,
): void {
  const { inputs, seed } = params
  const assetCount = inputs.mu.length
  const steps = Math.floor(params.steps)
  const paths = Math.floor(params.numSimulations)
  if (assetCount === 0 || steps < 1 || paths < 1 || !(params.stepsPerYear > 0)) return

  const dt = 1 / params.stepsPerYear
  const sqrtDt = Math.sqrt(dt)
  const drift = inputs.mu.map((m, i) => (m - (inputs.sigma[i] * inputs.sigma[i]) / 2) * dt)
  const diffusion = inputs.sigma.map((s) => s * sqrtDt)
  const cholesky = inputs.cholesky

  const nextNormal = createNormalSampler(seed)
  const prices = new Array<number>(assetCount).fill(1)
  const shocks = new Array<number>(assetCount).fill(0)

  for (let sim = 0; sim < paths; sim++) {
    for (let i = 0; i < assetCount; i++) prices[i] = 1

    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < assetCount; i++) shocks[i] = nextNormal()

      for (let i = 0; i < assetCount; i++) {
        // z = (L·ε)_i — L is lower triangular, so only k ≤ i contribute.
        let z = 0
        for (let k = 0; k <= i; k++) z += cholesky[i][k] * shocks[k]
        prices[i] *= Math.exp(drift[i] + diffusion[i] * z)
      }

      onStep(sim, step, prices)
    }
  }
}

export type WeightingSimulation = {
  /** The weights actually used, normalised to sum to 1. */
  weights: number[]
  /** valuesByWeek[w][sim] — book value at week w+1 on path `sim`, starting from 1.0. */
  valuesByWeek: number[][]
}

function normaliseWeights(weights: number[]): number[] {
  const sum = weights.reduce((total, w) => total + w, 0)
  return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / weights.length)
}

/**
 * Several books priced on ONE set of simulated asset paths.
 *
 * The shocks are drawn per asset, per week, per path — never per weighting — so
 * every book in `weightings` lives through exactly the same futures. That is
 * what makes a comparison between them a comparison of the books and not of
 * their luck: if one allocation came out ahead on its own draw of the dice, the
 * difference would be half allocation and half noise, with no way to tell
 * which half.
 *
 * Books are buy-and-hold from week 0: each asset's value drifts with its own
 * price, the same assumption simulatePortfolioGBM has always made.
 */
export function simulateWeightings(params: {
  inputs: GbmInputs
  weightings: number[][]
  weeks: number
  numSimulations: number
  seed: number
}): WeightingSimulation[] {
  const { inputs, weightings, seed } = params
  const assetCount = inputs.mu.length
  const totalWeeks = Math.floor(params.weeks)
  const paths = Math.floor(params.numSimulations)

  for (const weights of weightings) {
    if (weights.length !== assetCount) {
      throw new RangeError(`weighting has ${weights.length} weights for ${assetCount} assets`)
    }
  }

  const normalised = weightings.map(normaliseWeights)
  const results: WeightingSimulation[] = normalised.map((weights) => ({
    weights,
    valuesByWeek: Array.from({ length: Math.max(0, totalWeeks) }, () =>
      new Array<number>(Math.max(0, paths)).fill(0)
    ),
  }))
  if (assetCount === 0 || totalWeeks < 1 || paths < 1) return results

  forEachCorrelatedStep({ inputs, steps: totalWeeks, stepsPerYear: WEEKS_PER_YEAR, numSimulations: paths, seed }, (sim, week, relatives) => {
    for (let s = 0; s < normalised.length; s++) {
      const weights = normalised[s]
      let value = 0
      for (let i = 0; i < assetCount; i++) value += weights[i] * relatives[i]
      results[s].valuesByWeek[week][sim] = value
    }
  })

  return results
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

  const totalWeeks = Math.floor(weeks)
  const paths = Math.floor(numSimulations)

  if (assets.length === 0 || totalWeeks < 1 || paths < 1) {
    return { weeklyBands: [], finalValueDistribution: [], var95: 0 }
  }

  const [{ valuesByWeek }] = simulateWeightings({
    inputs: gbmInputsFromHistory(assets.map((a) => a.historicalReturns)),
    weightings: [assets.map((a) => a.weight)],
    weeks: totalWeeks,
    numSimulations: paths,
    seed,
  })

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
