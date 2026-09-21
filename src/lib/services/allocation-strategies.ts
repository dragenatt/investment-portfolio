// Allocation strategies that do not need a forecast — pure functions, no I/O.
//
// The efficient frontier in `optimizer.ts` needs expected returns, and expected
// returns are the one input nobody can estimate well. Everything in this file
// deliberately avoids them: risk parity and minimum-CVaR ask only how assets
// have MOVED, not how they will PERFORM, so they rest on the more stable half
// of the historical record.
//
// That is not a claim that they beat mean-variance. It is a claim that they
// depend on a weaker assumption, which is a different and more defensible thing
// to say to someone learning.

import { conditionalVaR } from './var'
import { projectOntoSimplex } from './optimizer'
import { projectOntoConstraints, satisfiesConstraints, type ResolvedConstraints } from './weight-constraints'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'


/** Below this a variance is float dust, and dividing by it produces nonsense. */
const MIN_VARIANCE = 1e-14

/** Fewer scenarios than this and there is no tail to optimise against. */
const MIN_SCENARIOS = 30

function isUsableMatrix(cov: number[][], n: number): boolean {
  if (cov.length !== n || n === 0) return false
  return cov.every((row) => row.length === n && row.every(Number.isFinite))
}

/** Σw for each asset — the marginal risk each one adds. */
function marginalRisk(weights: number[], cov: number[][]): number[] {
  return weights.map((_, i) => weights.reduce((sum, w, j) => sum + cov[i][j] * w, 0))
}

/**
 * Weights inversely proportional to each asset's own volatility.
 *
 * Sometimes sold as "risk parity", which it is not: it ignores correlation
 * entirely, so two assets that move as one get the full weight of two separate
 * bets. Kept here precisely so the contrast with real risk parity is visible.
 */
export function inverseVolatilityWeights(cov: number[][]): number[] | null {
  const n = cov.length
  if (!isUsableMatrix(cov, n)) return null

  const inverses: number[] = []
  for (let i = 0; i < n; i++) {
    const variance = cov[i][i]
    if (!(variance > MIN_VARIANCE)) return null
    inverses.push(1 / Math.sqrt(variance))
  }

  const total = inverses.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  return inverses.map((v) => v / total)
}

/** Iterations of the risk-parity fixed point. Fixed, so results reproduce exactly. */
const PARITY_MAX_ITERATIONS = 5000
const PARITY_TOLERANCE = 1e-14
/** Damping on the multiplicative update; full steps oscillate on correlated books. */
const PARITY_DAMPING = 0.5

/**
 * Weights at which every asset contributes the same share of portfolio risk.
 *
 * Risk contribution is wᵢ·(Σw)ᵢ, and the target is that all n of them are equal.
 * Solved by the damped multiplicative fixed point wᵢ ← wᵢ·(target/RCᵢ)^d followed
 * by renormalisation — chosen over a Newton solve because every iterate stays
 * strictly positive and sums to 1, so an early stop still yields a real
 * portfolio rather than an infeasible one.
 *
 * The difference from inverse volatility is correlation: an asset that moves
 * with everything else is contributing more risk than its own volatility
 * suggests, and this sees that. On a diagonal covariance the two coincide, which
 * is asserted in the tests.
 */
export function riskParityWeights(cov: number[][]): number[] | null {
  const n = cov.length
  if (!isUsableMatrix(cov, n)) return null
  for (let i = 0; i < n; i++) if (!(cov[i][i] > MIN_VARIANCE)) return null
  if (n === 1) return [1]

  let w = inverseVolatilityWeights(cov)
  if (!w) return null

  for (let iteration = 0; iteration < PARITY_MAX_ITERATIONS; iteration++) {
    const marginal = marginalRisk(w, cov)
    const variance = w.reduce((sum, weight, i) => sum + weight * marginal[i], 0)
    if (!(variance > MIN_VARIANCE)) return null

    const target = variance / n
    const next: number[] = []
    for (let i = 0; i < n; i++) {
      const contribution = w[i] * marginal[i]
      // A non-positive contribution means the matrix is not positive definite;
      // there is no risk-parity portfolio to find and guessing is worse than null.
      if (!(contribution > 0)) return null
      next.push(w[i] * Math.pow(target / contribution, PARITY_DAMPING))
    }

    const total = next.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return null
    const normalised = next.map((v) => v / total)

    let movement = 0
    for (let i = 0; i < n; i++) movement += Math.abs(normalised[i] - w[i])
    w = normalised
    if (movement < PARITY_TOLERANCE) break
  }

  return w.every(Number.isFinite) ? w : null
}

/** The portfolio return series a weight vector would have produced. */
function blend(weights: number[], returnsMatrix: number[][]): number[] | null {
  const n = weights.length
  if (n === 0 || returnsMatrix.length !== n) return null
  if (!weights.every(Number.isFinite)) return null

  const length = returnsMatrix[0].length
  if (returnsMatrix.some((series) => series.length !== length)) return null
  if (returnsMatrix.some((series) => !series.every(Number.isFinite))) return null

  return Array.from({ length }, (_, t) =>
    weights.reduce((sum, w, i) => sum + w * returnsMatrix[i][t], 0),
  )
}

/**
 * Conditional VaR of a weighted book, measured on the historical scenarios.
 *
 * Returned as a positive daily loss fraction, matching `conditionalVaR`.
 */
export function portfolioCVaR(
  weights: number[],
  returnsMatrix: number[][],
  confidence = 95,
): number | null {
  const total = weights.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > 1e-6) return null

  const blended = blend(weights, returnsMatrix)
  if (!blended) return null
  return conditionalVaR(blended, confidence)
}

const CVAR_MAX_ITERATIONS = 800
/**
 * Step length for the subgradient walk, as a distance in weight space.
 *
 * The subgradient is normalised before stepping, so this is a real distance on
 * the simplex rather than a scale factor on a quantity whose magnitude depends
 * on the size of the returns. With the 1/sqrt(k) schedule the total path length
 * is about 0.08·2·sqrt(800) ≈ 4.5, comfortably more than the simplex diameter.
 */
const CVAR_STEP = 0.08

/**
 * Weights minimising historical CVaR, long-only and fully invested.
 *
 * Projected subgradient descent: the CVaR of a weighted historical sample is
 * convex in the weights but not differentiable where the tail membership
 * changes, so a gradient method is out and a subgradient method is the natural
 * fit. Subgradient descent is not monotone, so the BEST iterate is tracked
 * rather than the last one.
 *
 * Run from several starting points, not one. A single run from equal weight
 * guaranteed only "no worse than equal weight", and that was not enough: risk
 * parity beat it on the very metric this function is named after, which would
 * have shipped a row labelled "minimum CVaR" that another row on the same screen
 * beats. Seeding the search with equal weight, inverse volatility and risk
 * parity — then keeping the best result of all of them — makes "no worse than
 * any of the alternatives it is displayed next to" structural.
 */
export function minimiseCVaRWeights(
  returnsMatrix: number[][],
  confidence = 95,
  constraints?: ResolvedConstraints,
): number[] | null {
  const n = returnsMatrix.length
  if (n === 0) return null

  const length = returnsMatrix[0].length
  if (length < MIN_SCENARIOS) return null
  if (returnsMatrix.some((series) => series.length !== length)) return null
  if (returnsMatrix.some((series) => !series.every(Number.isFinite))) return null
  if (n === 1) return [1]

  // A candidate that breaks the caller's limits is not a candidate, however low
  // its shortfall. Subgradient descent is not monotone, so the BEST iterate is
  // tracked — and "best" has to mean "best among the feasible ones".
  const usable = constraints && !constraints.trivial ? constraints : null
  const project = (w: number[]): number[] => (usable ? projectOntoConstraints(w, usable) : projectOntoSimplex(w))

  const evaluate = (weights: number[]): number | null => {
    if (usable && !satisfiesConstraints(weights, usable)) return null
    const blended = blend(weights, returnsMatrix)
    if (!blended) return null
    return conditionalVaR(blended, confidence)
  }

  const cov = covarianceFrom(returnsMatrix)
  const starts = [
    Array(n).fill(1 / n) as number[],
    inverseVolatilityWeights(cov),
    riskParityWeights(cov),
  ]
    .filter((w): w is number[] => w !== null && w.length === n)
    // Every start has to begin inside the feasible set, or the first evaluation
    // rejects it and that whole run is wasted.
    .map(project)

  const tailSize = Math.max(1, Math.floor(((100 - confidence) / 100) * length))

  let best: number[] | null = null
  let bestValue = Infinity

  for (const start of starts) {
    let w = start
    const startValue = evaluate(w)
    if (startValue !== null && startValue < bestValue) {
      bestValue = startValue
      best = w
    }

    for (let iteration = 1; iteration <= CVAR_MAX_ITERATIONS; iteration++) {
      const blended = blend(w, returnsMatrix)
      if (!blended) break

      // The subgradient of the tail mean is the average of the asset returns
      // over exactly those scenarios currently IN the tail. Which scenarios
      // those are is what makes the objective non-smooth.
      const tail = blended
        .map((value, index) => ({ value, index }))
        .sort((a, b) => a.value - b.value)
        .slice(0, tailSize)

      const gradient = Array(n).fill(0)
      for (const { index } of tail) {
        for (let i = 0; i < n; i++) gradient[i] -= returnsMatrix[i][index] / tail.length
      }

      // Normalised, so CVAR_STEP is a distance on the simplex rather than a
      // scale factor on a quantity whose size depends on the returns themselves.
      const norm = Math.sqrt(gradient.reduce((s, g) => s + g * g, 0))
      if (!(norm > 0)) break

      const step = CVAR_STEP / Math.sqrt(iteration)
      w = project(w.map((value, i) => value - (step * gradient[i]) / norm))

      const value = evaluate(w)
      if (value !== null && value < bestValue) {
        bestValue = value
        best = w
      }
    }
  }

  return best && best.every(Number.isFinite) ? best : null
}

export type StrategyId = 'equalWeight' | 'inverseVolatility' | 'riskParity' | 'minCVaR'

export type StrategyWeight = { symbol: string; weight: number }

export type AllocationStrategy = {
  id: StrategyId
  name: string
  rationale: string
  weights: StrategyWeight[]
  volatilityPct: number
  cvarPct: number
}

export type StrategyComparison = {
  confidence: number
  observations: number
  strategies: AllocationStrategy[]
  caveat: string
}

const STRATEGY_COPY: Record<StrategyId, { name: string; rationale: string }> = {
  equalWeight: {
    name: 'Pesos iguales',
    rationale:
      'Reparte lo mismo en cada posición. No optimiza nada, y por eso mismo no depende de ningun ' +
      'supuesto: es la referencia honesta contra la que hay que medir cualquier método mas elaborado. ' +
      'Gana mas veces de lo que a la industria le gusta admitir.',
  },
  inverseVolatility: {
    name: 'Inverso de la volatilidad',
    rationale:
      'Da mas peso a lo que se mueve menos. Ignora por completo la correlación, asi que dos activos que ' +
      'suben y bajan juntos cuentan como dos apuestas separadas cuando en realidad son una. Se incluye ' +
      'para que se vea la diferencia con la paridad de riesgo real.',
  },
  riskParity: {
    name: 'Paridad de riesgo',
    rationale:
      'Busca que cada posición aporte la misma porcion del riesgo total, no del dinero total. Si un ' +
      'activo se mueve junto con el resto, aporta mas riesgo del que su volatilidad sugiere y recibe ' +
      'menos peso. No necesita estimar rendimientos futuros.',
  },
  minCVaR: {
    name: 'Mínimo CVaR',
    rationale:
      'Minimiza la pérdida promedio de los peores días observados, en vez de la volatilidad. La ' +
      'volatilidad castiga igual las subidas y las bajadas; esto solo mira el lado que duele. Depende ' +
      'del historial disponible: no puede prever una caida peor que la peor ya vista.',
  },
}

const STRATEGY_CAVEAT =
  'Ninguna de estas asignaciones es una recomendacion, y ninguna es "la correcta". Cada una optimiza una ' +
  'cosa distinta y todas se calculan sobre el mismo historial, que es pasado y no promesa. Los números de ' +
  'volatilidad y CVaR que acompanan a cada una describen como se habría comportado esa mezcla en ese ' +
  'historial; un periodo distinto habría dado un ganador distinto. Compararlas sirve para entender que ' +
  'esta optimizando cada método, no para elegir una y copiarla.'

function covarianceFrom(returnsMatrix: number[][]): number[][] {
  const n = returnsMatrix.length
  const length = returnsMatrix[0].length
  const means = returnsMatrix.map((s) => s.reduce((a, b) => a + b, 0) / length)

  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let sum = 0
      for (let t = 0; t < length; t++) {
        sum += (returnsMatrix[i][t] - means[i]) * (returnsMatrix[j][t] - means[j])
      }
      // Annualised, to match how volatility is quoted everywhere else.
      return (sum / (length - 1)) * TRADING_DAYS
    }),
  )
}

/**
 * The same holdings allocated four different ways, side by side.
 *
 * The point is the comparison, not any single row. Showing one "optimal"
 * allocation invites it to be copied; showing four that disagree invites the
 * question of what each one is optimising, which is the part worth learning.
 */
export function compareAllocationStrategies(
  symbols: string[],
  returnsMatrix: number[][],
  confidence = 95,
  constraints?: ResolvedConstraints,
): StrategyComparison | null {
  const n = symbols.length
  if (n === 0 || returnsMatrix.length !== n) return null

  const length = returnsMatrix[0].length
  if (length < MIN_SCENARIOS) return null
  if (returnsMatrix.some((series) => series.length !== length)) return null
  if (returnsMatrix.some((series) => !series.every(Number.isFinite))) return null

  const cov = covarianceFrom(returnsMatrix)

  const candidates: [StrategyId, number[] | null][] = [
    ['equalWeight', Array(n).fill(1 / n)],
    ['inverseVolatility', inverseVolatilityWeights(cov)],
    ['riskParity', riskParityWeights(cov)],
    ['minCVaR', minimiseCVaRWeights(returnsMatrix, confidence, constraints)],
  ]

  const strategies: AllocationStrategy[] = []
  for (const [id, weights] of candidates) {
    if (!weights) continue

    const variance = weights.reduce(
      (sum, w, i) => sum + w * marginalRisk(weights, cov)[i],
      0,
    )
    const cvar = portfolioCVaR(weights, returnsMatrix, confidence)
    if (!(variance >= 0) || cvar === null) continue

    strategies.push({
      id,
      name: STRATEGY_COPY[id].name,
      rationale: STRATEGY_COPY[id].rationale,
      weights: symbols.map((symbol, i) => ({ symbol, weight: weights[i] })),
      volatilityPct: Math.sqrt(variance) * 100,
      cvarPct: cvar * 100,
    })
  }

  if (strategies.length === 0) return null

  return {
    confidence,
    observations: length,
    strategies,
    caveat: STRATEGY_CAVEAT,
  }
}
