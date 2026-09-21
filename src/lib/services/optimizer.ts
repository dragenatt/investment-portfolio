// Mean-variance optimisation — pure functions, no I/O.
//
// ── Read this before trusting anything this file produces ───────────────────
//
// Markowitz is exact mathematics applied to inputs that are guesses. The
// covariance matrix estimated from history is noisy but roughly stable; the
// vector of expected returns is neither, and the optimiser is exquisitely
// sensitive to it. Nudge one asset's expected return by a percentage point and
// the "optimal" book can change completely.
//
// That is not a flaw in the implementation, it is the nature of the method, and
// it is why every result here travels with FRONTIER_CAVEAT and why expected
// returns are labelled an ESTIMATE everywhere they surface. The frontier is a
// teaching object — it shows the shape of the risk/return trade-off and where a
// book sits relative to it. It is not an instruction.
//
// Long-only and fully invested throughout: weights are non-negative and sum to
// exactly 1, enforced structurally by projecting onto the simplex rather than
// by normalising afterwards and hoping.

import { jacobiEigen } from './pca'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'
import {
  projectOntoConstraints,
  resolveConstraints,
  type ResolvedConstraints,
  type WeightConstraints,
} from './weight-constraints'


/** Below this, a variance is float dust rather than risk. */
const MIN_VARIANCE = 1e-14

/** Fewer observations than this and a mean return is noise wearing a number. */
const MIN_RETURN_OBSERVATIONS = 30

export const FRONTIER_CAVEAT =
  'Esta frontera se construye con rendimientos esperados ESTIMADOS a partir del pasado, y esa es la ' +
  'entrada mas debil de todo el modelo: el pasado no se repite y el optimizador es extremadamente ' +
  'sensible a ese supuesto — cambiar un punto porcentual en un activo puede reordenar la cartera ' +
  '"óptima" entera. La matriz de covarianza es mas estable que los rendimientos, asi que la forma de ' +
  'la curva es mas confiable que el punto exacto que senala. Usala para entender el intercambio entre ' +
  'riesgo y rendimiento, no como una instruccion de compra.'

/**
 * Euclidean projection of a vector onto the probability simplex.
 *
 * This is what makes "long-only and fully invested" a structural guarantee
 * instead of a hope. Every iterate is projected, so every weight vector that
 * leaves this file is non-negative and sums to 1 — the roadmap's rule that no
 * weight set failing to total 100% may reach the interface is satisfied by
 * construction rather than by a check at the end.
 *
 * Duchi et al. (2008), "Efficient Projections onto the l1-Ball for Learning in
 * High Dimensions" — the exact O(n log n) sort-based algorithm.
 */
export function projectOntoSimplex(v: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  if (!v.every(Number.isFinite)) return Array(n).fill(1 / n)

  const sorted = [...v].sort((a, b) => b - a)
  let cumulative = 0
  let rho = 0
  let theta = 0

  for (let i = 0; i < n; i++) {
    cumulative += sorted[i]
    const candidate = (cumulative - 1) / (i + 1)
    if (sorted[i] - candidate > 0) {
      rho = i + 1
      theta = candidate
    }
  }

  if (rho === 0) return Array(n).fill(1 / n)
  return v.map((value) => Math.max(0, value - theta))
}

function isUsableMatrix(cov: number[][], n: number): boolean {
  if (cov.length !== n) return false
  return cov.every((row) => row.length === n && row.every(Number.isFinite))
}

/** w' Σ w, floored at zero — a negative variance is a broken matrix, not a result. */
function quadraticForm(weights: number[], cov: number[][]): number {
  let total = 0
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      total += weights[i] * cov[i][j] * weights[j]
    }
  }
  return total
}

/** Iterations of projected gradient. Fixed, so the result is reproducible. */
const MAX_ITERATIONS = 2000
/** Stop early once the weights stop moving. */
const CONVERGENCE_TOLERANCE = 1e-12

/**
 * Maximise  μ'w − aversion · w'Σw  over long-only, fully-invested portfolios.
 *
 * Projected gradient descent rather than a general QP solver: the feasible set
 * is the simplex, whose exact projection is cheap and closed-form, so the
 * iteration is a few lines, has no pivoting or degeneracy cases, and cannot
 * return an infeasible answer even if it stops early.
 *
 * `aversion` is the trade-off knob. 0 chases return with no regard for risk;
 * large values converge on the minimum-variance portfolio and stop caring about
 * the expected returns at all — which is the one corner of this model that does
 * not depend on the untrustworthy input.
 */
export function optimiseWeights(
  cov: number[][],
  expectedReturns: number[],
  aversion: number,
  constraints?: ResolvedConstraints,
): number[] | null {
  const n = expectedReturns.length
  if (n === 0) return null
  if (!expectedReturns.every(Number.isFinite)) return null
  if (!isUsableMatrix(cov, n)) return null
  if (!Number.isFinite(aversion) || aversion < 0) return null
  if (constraints && (constraints.lower.length !== n || constraints.upper.length !== n)) return null

  const project = (w: number[]): number[] =>
    constraints && !constraints.trivial ? projectOntoConstraints(w, constraints) : projectOntoSimplex(w)

  // With no penalty on risk the problem is linear, and the optimum is a corner:
  // everything in the best asset, split evenly across ties. Gradient descent
  // would need an infinite step to get there, so it is solved directly — and
  // then projected, because with weight or sector limits in force that corner
  // is usually outside what the caller allows.
  if (aversion === 0) {
    const best = Math.max(...expectedReturns)
    const winners = expectedReturns.map((r): number => (r === best ? 1 : 0))
    const count = winners.reduce((a, b) => a + b, 0)
    const corner = winners.map((w) => w / count)
    return constraints && !constraints.trivial ? project(corner) : corner
  }

  // Step size from the Lipschitz constant of the gradient, 2·aversion·λmax(Σ).
  // Taking λmax from the existing Jacobi routine rather than estimating it keeps
  // the step as large as convergence allows without ever overshooting.
  const eigen = jacobiEigen(cov)
  const lambdaMax = eigen ? Math.max(...eigen.eigenvalues) : null
  if (lambdaMax === null || !(lambdaMax > 0)) return null
  const step = 1 / (2 * aversion * lambdaMax)
  if (!Number.isFinite(step) || step <= 0) return null

  // Start inside the feasible set, not merely on the simplex: equal weight can
  // sit outside a tight box or over a sector cap.
  let w = project(Array(n).fill(1 / n))

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // ∇ of (aversion·w'Σw − μ'w)
    const gradient = w.map((_, i) => {
      let risk = 0
      for (let j = 0; j < n; j++) risk += cov[i][j] * w[j]
      return 2 * aversion * risk - expectedReturns[i]
    })

    const next = project(w.map((value, i) => value - step * gradient[i]))

    let movement = 0
    for (let i = 0; i < n; i++) movement += Math.abs(next[i] - w[i])
    w = next
    if (movement < CONVERGENCE_TOLERANCE) break
  }

  if (!w.every(Number.isFinite)) return null
  return w
}

export type RiskReturn = { expectedReturn: number; volatility: number }

/** Expected return and volatility of a specific weight vector. */
export function portfolioRiskReturn(
  weights: number[],
  cov: number[][],
  expectedReturns: number[],
): RiskReturn | null {
  const n = weights.length
  if (n === 0) return null
  if (!weights.every(Number.isFinite)) return null
  if (expectedReturns.length !== n || !expectedReturns.every(Number.isFinite)) return null
  if (!isUsableMatrix(cov, n)) return null

  const total = weights.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > 1e-6) return null

  const variance = quadraticForm(weights, cov)
  if (!Number.isFinite(variance) || variance < 0) return null

  const expectedReturn = weights.reduce((sum, w, i) => sum + w * expectedReturns[i], 0)
  const volatility = Math.sqrt(variance)
  if (!Number.isFinite(expectedReturn) || !Number.isFinite(volatility)) return null

  return { expectedReturn, volatility }
}

export type FrontierWeight = { symbol: string; weight: number }

export type FrontierPoint = {
  expectedReturnPct: number
  volatilityPct: number
  /** Null when volatility is too small for the ratio to mean anything. */
  sharpe: number | null
  weights: FrontierWeight[]
}

export type FrontierImprovement = {
  /** Volatility of the frontier portfolio earning what the book earns today. */
  sameReturnVolatilityPct: number
  volatilitySavedPct: number
  /** Expected return of the frontier portfolio at the book's current risk. */
  sameRiskReturnPct: number
  returnGainedPct: number
  summary: string
}

export type EfficientFrontier = {
  points: FrontierPoint[]
  minimumVariance: FrontierPoint
  maxSharpe: FrontierPoint
  /** Where the book actually sits, when its weights were supplied. */
  current: FrontierPoint | null
  improvement: FrontierImprovement | null
  riskFreeRatePct: number
  caveat: string
}

export type FrontierOptions = {
  riskFreeRate: number
  currentWeights?: number[]
  points?: number
  /**
   * Weight and sector limits every portfolio on the curve must respect (P1-31).
   *
   * Without them the frontier is long-only and fully invested and nothing more,
   * so its greedy end is the whole book in one holding — a portfolio nobody
   * would hold and no mandate would allow. `sectors` is the label per symbol,
   * in the same order as `symbols`.
   */
  constraints?: WeightConstraints
}

const DEFAULT_FRONTIER_POINTS = 40

/** Risk-aversion values swept to trace the curve, log-spaced from greedy to timid. */
function aversionLadder(count: number): number[] {
  const MIN_AVERSION = 0.05
  const MAX_AVERSION = 500
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    return MIN_AVERSION * Math.pow(MAX_AVERSION / MIN_AVERSION, t)
  })
}

function toPoint(
  weights: number[],
  cov: number[][],
  expectedReturns: number[],
  symbols: string[],
  riskFreeRate: number,
): FrontierPoint | null {
  const stats = portfolioRiskReturn(weights, cov, expectedReturns)
  if (!stats) return null

  return {
    expectedReturnPct: stats.expectedReturn * 100,
    volatilityPct: stats.volatility * 100,
    sharpe:
      stats.volatility > Math.sqrt(MIN_VARIANCE)
        ? (stats.expectedReturn - riskFreeRate) / stats.volatility
        : null,
    weights: symbols.map((symbol, i) => ({ symbol, weight: weights[i] })),
  }
}

// ── Reading a continuous curve off a discrete sample ────────────────────────
//
// The frontier is sampled at a few dozen risk-aversion values, so a real book
// almost always falls BETWEEN two of them. Comparing it against the nearest
// sampled point is wrong in a way that shows: an equal-weight book landed at
// 8.20% volatility for 8.88% return while the nearest sampled frontier point at
// that return sat at 8.44%, which reads as the book beating the frontier — a
// thing no feasible portfolio can do. It was sampling granularity, not the
// optimiser, and the fix is to interpolate.
//
// Chord interpolation on a convex curve always lands slightly OUTSIDE it, so
// both readings understate the gap rather than overstating it. That is the right
// direction for a number being shown to someone deciding what to do.

/** Frontier volatility at a target return, or null if it is beyond the curve. */
function volatilityAtReturn(frontier: FrontierPoint[], targetPct: number): number | null {
  if (frontier.length === 0) return null
  const first = frontier[0]
  const last = frontier[frontier.length - 1]
  if (targetPct <= first.expectedReturnPct) return first.volatilityPct
  if (targetPct > last.expectedReturnPct) return null

  for (let i = 1; i < frontier.length; i++) {
    const a = frontier[i - 1]
    const b = frontier[i]
    if (targetPct > b.expectedReturnPct) continue
    const span = b.expectedReturnPct - a.expectedReturnPct
    if (!(span > 0)) return Math.min(a.volatilityPct, b.volatilityPct)
    const t = (targetPct - a.expectedReturnPct) / span
    return a.volatilityPct + t * (b.volatilityPct - a.volatilityPct)
  }
  return last.volatilityPct
}

/** Frontier return at a target volatility, or null if it is beyond the curve. */
function returnAtVolatility(frontier: FrontierPoint[], targetPct: number): number | null {
  if (frontier.length === 0) return null
  const first = frontier[0]
  const last = frontier[frontier.length - 1]
  // Below the minimum-variance point there is no frontier portfolio at all.
  if (targetPct < first.volatilityPct) return null
  if (targetPct >= last.volatilityPct) return last.expectedReturnPct

  for (let i = 1; i < frontier.length; i++) {
    const a = frontier[i - 1]
    const b = frontier[i]
    if (targetPct > b.volatilityPct) continue
    const span = b.volatilityPct - a.volatilityPct
    if (!(span > 0)) return Math.max(a.expectedReturnPct, b.expectedReturnPct)
    const t = (targetPct - a.volatilityPct) / span
    return a.expectedReturnPct + t * (b.expectedReturnPct - a.expectedReturnPct)
  }
  return last.expectedReturnPct
}

/**
 * The set of portfolios offering the most expected return for each level of risk.
 *
 * Traced by sweeping risk aversion rather than by pinning a target return and
 * solving: every point the sweep produces is optimal for some investor by
 * construction, so the curve cannot contain an interior point that should not
 * be there. Dominated points — the noise the sweep leaves at the ends — are then
 * filtered out explicitly, which is what makes the returned series monotone.
 *
 * Read FRONTIER_CAVEAT. It is returned with the result for a reason.
 */
export function efficientFrontier(
  symbols: string[],
  cov: number[][],
  expectedReturns: number[],
  options: FrontierOptions,
): EfficientFrontier | null {
  const n = symbols.length
  // One asset has no trade-off to trace: there is nothing to choose between.
  if (n < 2) return null
  if (expectedReturns.length !== n) return null
  if (!isUsableMatrix(cov, n)) return null

  const { riskFreeRate, currentWeights, points = DEFAULT_FRONTIER_POINTS } = options
  if (!Number.isFinite(riskFreeRate)) return null

  // Constraints the caller cannot satisfy produce no curve at all. Returning a
  // frontier that quietly ignores them would be worse than returning nothing:
  // the reader would take weights that violate what they asked for.
  const resolution = resolveConstraints(n, options.constraints ?? {})
  if (!resolution.ok) return null
  const constraints = resolution.constraints

  // A matrix with no variance anywhere describes no risk, and a risk/return
  // curve with no risk axis is not a thing worth drawing.
  const totalVariance = cov.reduce((sum, row, i) => sum + row[i], 0)
  if (!(totalVariance > MIN_VARIANCE)) return null

  const candidates: FrontierPoint[] = []
  for (const aversion of aversionLadder(points)) {
    const weights = optimiseWeights(cov, expectedReturns, aversion, constraints)
    if (!weights) continue
    const point = toPoint(weights, cov, expectedReturns, symbols, riskFreeRate)
    if (point) candidates.push(point)
  }

  if (candidates.length === 0) return null

  // Sort by risk, then keep only points that improve on the best return seen so
  // far. What survives is monotone in both axes and contains nothing dominated.
  candidates.sort(
    (a, b) => a.volatilityPct - b.volatilityPct || b.expectedReturnPct - a.expectedReturnPct,
  )

  const frontier: FrontierPoint[] = []
  let bestReturn = -Infinity
  for (const point of candidates) {
    if (point.expectedReturnPct > bestReturn + 1e-9) {
      frontier.push(point)
      bestReturn = point.expectedReturnPct
    }
  }

  const minimumVariance = frontier[0]
  const maxSharpe = frontier.reduce((best, point) => {
    if (point.sharpe === null) return best
    if (best.sharpe === null) return point
    return point.sharpe > best.sharpe ? point : best
  }, frontier[0])

  let current: FrontierPoint | null = null
  let improvement: FrontierImprovement | null = null

  if (currentWeights && currentWeights.length === n) {
    current = toPoint(currentWeights, cov, expectedReturns, symbols, riskFreeRate)

    if (current) {
      // Two readings of the same gap, because they answer different questions:
      // "same return, less risk" and "same risk, more return". A book whose
      // return is past the frontier's top end has no same-return comparison to
      // make, and the honest answer there is no improvement rather than a
      // number read off the nearest point.
      const sameReturnVolatilityPct =
        volatilityAtReturn(frontier, current.expectedReturnPct) ?? current.volatilityPct
      const sameRiskReturnPct =
        returnAtVolatility(frontier, current.volatilityPct) ?? current.expectedReturnPct

      const volatilitySaved = Math.max(0, current.volatilityPct - sameReturnVolatilityPct)
      const returnGained = Math.max(0, sameRiskReturnPct - current.expectedReturnPct)

      improvement = {
        sameReturnVolatilityPct,
        volatilitySavedPct: volatilitySaved,
        sameRiskReturnPct,
        returnGainedPct: returnGained,
        summary:
          volatilitySaved < 0.1 && returnGained < 0.1
            ? 'Tu cartera ya esta prácticamente sobre la frontera para estos supuestos: reordenar los pesos ' +
              'no compraria una mejora apreciable. Recuerda que eso depende de los rendimientos esperados ' +
              'estimados, que son la parte mas fragil del cálculo.'
            : `Con estos supuestos, el mismo rendimiento esperado (${current.expectedReturnPct.toFixed(1)}%) ` +
              `podría obtenerse con ${sameReturnVolatilityPct.toFixed(1)}% de volatilidad en vez de ` +
              `${current.volatilityPct.toFixed(1)}%, o el mismo riesgo podría rendir ` +
              `${sameRiskReturnPct.toFixed(1)}% en vez de ${current.expectedReturnPct.toFixed(1)}%. ` +
              'Es un ejercicio con supuestos estimados, no una recomendacion.',
      }
    }
  }

  return {
    points: frontier,
    minimumVariance,
    maxSharpe,
    current,
    improvement,
    riskFreeRatePct: riskFreeRate * 100,
    caveat: FRONTIER_CAVEAT,
  }
}

/**
 * Annualised mean of each asset's historical returns.
 *
 * Provided because the frontier needs expected returns and this is the only
 * estimate the app can produce from data it actually has. It is a weak one —
 * the arithmetic mean of past returns is a famously poor forecast — and it is
 * named `historical` rather than `expected` so no caller can pretend otherwise.
 * Anything built on it must carry FRONTIER_CAVEAT.
 */
export function historicalExpectedReturns(returnsMatrix: number[][]): number[] | null {
  if (returnsMatrix.length === 0) return null
  if (returnsMatrix.some((series) => series.length < MIN_RETURN_OBSERVATIONS)) return null
  if (returnsMatrix.some((series) => !series.every(Number.isFinite))) return null

  const estimates = returnsMatrix.map(
    (series) => (series.reduce((a, b) => a + b, 0) / series.length) * TRADING_DAYS,
  )

  return estimates.every(Number.isFinite) ? estimates : null
}
