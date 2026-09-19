// Black-Litterman — pure functions, no I/O.
//
// ── The problem it solves ───────────────────────────────────────────────────
//
// robust-optimizer.ts showed the damage: with six months of data the "optimal"
// weight of a holding swings from 0% to 100% inside its own error bars. That is
// not a bug in Markowitz, it is Markowitz working correctly on inputs nobody can
// estimate. Feed it noise, get noise back, amplified.
//
// Black-Litterman attacks the input instead of the optimiser. It starts from the
// returns the MARKET already implies — reverse-optimise the weights everyone
// actually holds and ask what expectations would make those weights sensible —
// and then lets the user nudge that starting point with opinions they can
// defend, each with a confidence attached.
//
// Two properties make it worth shipping to someone learning:
//
//   No opinion means no deviation. A user with no views gets the market
//   portfolio back, not a wild corner solution. The naive optimiser has no such
//   resting state, which is why it is so easy to misuse.
//
//   An opinion about one asset becomes a partial opinion about its correlated
//   neighbours, automatically. Saying "A will beat B" does not just move A and
//   B; it moves whatever moves with them, in proportion. A hand-typed override
//   cannot do that and would quietly break the covariance structure.
//
// ── What it is not ──────────────────────────────────────────────────────────
//
// It is not a forecast and it does not make a wrong opinion right. Feed it a
// confident bad view and it will build a confident bad portfolio — faster than
// plain Markowitz would, because it trusts you. The honesty is in the
// confidence slider: it makes "how sure am I, really" an explicit input rather
// than something buried in a point estimate.

import { optimiseWeights, portfolioRiskReturn, type FrontierPoint } from './optimizer'

/**
 * Market risk aversion, lambda. The textbook figure, from the long-run equity
 * premium over its variance (roughly 7% / 0.15^2 ~ 3, commonly rounded to 2.5).
 *
 * It scales every implied return linearly, so it shifts the whole equilibrium up
 * or down without changing the RELATIVE ordering — which is what the model
 * actually uses. Documented rather than tuned.
 */
export const DEFAULT_RISK_AVERSION = 2.5

/**
 * Tau: how much less certain the equilibrium is than the returns themselves.
 *
 * Small by convention — the equilibrium is treated as a fairly tight prior.
 * 0.05 is the value in Black and Litterman's own worked examples and in most of
 * the literature since; it is not derived here and is not pretended to be.
 */
export const DEFAULT_TAU = 0.05

export const BLACK_LITTERMAN_CAVEAT =
  'Black-Litterman no predice nada. Parte de lo que el mercado ya implica y se mueve hacia tus opiniones en ' +
  'proporción a la confianza que TÚ les des. Si una opinión está equivocada y la declaras con mucha confianza, ' +
  'el modelo construirá una cartera equivocada con mucha convicción, y más rápido que Markowitz clásico porque ' +
  'se fía de ti. Su virtud es que la pregunta "qué tan seguro estoy" pasa a ser una entrada explícita en vez de ' +
  'quedar escondida dentro de un número único. Sin opiniones, te devuelve la cartera del mercado: ese es el ' +
  'comportamiento por defecto y no es un error.'

export type View = {
  /** The assets this opinion is about. */
  symbols: string[]
  /**
   * How they combine. [1] for "A returns X"; [1, -1] for "A beats B by X".
   * A relative view is usually the one a person can actually defend.
   */
  weights: number[]
  /** The return the view asserts, annual and as a decimal fraction. */
  expectedReturn: number
  /** How sure the user is, 0 to 1. Zero means the view is ignored entirely. */
  confidence: number
}

/**
 * An opinion as a person states it (4.7), before it becomes a row of P and Q.
 *
 *   absolute        "AAPL will return 9% a year"
 *   vsEquilibrium   "AAPL will return 2 points more than the market implies"
 *   outperform      "AAPL will beat MSFT by 3 points a year"
 *
 * The second is the one the model was built around — it says how far to move
 * from the prior rather than guessing a level from nothing — and the third is
 * usually the only kind a person can actually defend.
 */
export type ViewInput = {
  kind: 'absolute' | 'vsEquilibrium' | 'outperform'
  symbol: string
  /** The asset the first is compared against, for 'outperform'. */
  other?: string
  /** Percent a year: the level, the points above equilibrium, or the margin. */
  pct: number
  /** How sure, 1 to 99. Certainty is not offered: it makes the system singular and the belief unfalsifiable. */
  confidencePct: number
}

export type ViewRejection = { index: number; reason: string }

/**
 * Turn stated opinions into the model's views, refusing — with a reason — any
 * that cannot be applied, instead of dropping it where the user would believe
 * it counted.
 */
export function viewsFromInputs(
  inputs: ViewInput[],
  symbols: string[],
  equilibriumReturns: number[],
): { views: View[]; rejected: ViewRejection[] } {
  const views: View[] = []
  const rejected: ViewRejection[] = []
  inputs.forEach((input, index) => {
    const reject = (reason: string) => rejected.push({ index, reason })
    const i = symbols.indexOf(input.symbol)
    if (i < 0) return reject(`${input.symbol} no entra en el análisis: no está en el portafolio o no tiene historial suficiente.`)
    if (!Number.isFinite(input.pct)) return reject('El rendimiento de la opinión no es un número.')
    if (!Number.isFinite(input.confidencePct) || input.confidencePct < 1 || input.confidencePct > 99) {
      return reject('La confianza va de 1% a 99%.')
    }
    const confidence = input.confidencePct / 100
    const pct = input.pct / 100
    if (input.kind === 'absolute') {
      views.push({ symbols: [input.symbol], weights: [1], expectedReturn: pct, confidence })
    } else if (input.kind === 'vsEquilibrium') {
      views.push({ symbols: [input.symbol], weights: [1], expectedReturn: equilibriumReturns[i] + pct, confidence })
    } else {
      const other = input.other ?? ''
      if (!symbols.includes(other)) return reject(`${other || 'El segundo activo'} no entra en el análisis.`)
      if (other === input.symbol) return reject('Una opinión relativa compara dos activos distintos.')
      views.push({ symbols: [input.symbol, other], weights: [1, -1], expectedReturn: pct, confidence })
    }
  })
  return { views, rejected }
}

/** The opinion back in words, the way the screen lists it. */
export function describeView(input: ViewInput): string {
  const points = (v: number) => `${Math.abs(v).toFixed(1)} puntos`
  const statement =
    input.kind === 'absolute'
      ? `${input.symbol} rendirá ${input.pct.toFixed(1)}% al año`
      : input.kind === 'vsEquilibrium'
        ? `${input.symbol} rendirá ${points(input.pct)} ${input.pct >= 0 ? 'más' : 'menos'} de lo que el mercado implica`
        : `${input.symbol} ${input.pct >= 0 ? 'superará' : 'quedará detrás de'} ${input.other} por ${points(input.pct)} al año`
  return `${statement} (confianza ${input.confidencePct.toFixed(0)}%)`
}

function isSquareFinite(matrix: number[][], n: number): boolean {
  if (matrix.length !== n) return false
  return matrix.every((row) => row.length === n && row.every(Number.isFinite))
}

/** Σw — the marginal risk each asset contributes at these weights. */
function covTimes(cov: number[][], vector: number[]): number[] {
  return cov.map((row) => row.reduce((sum, value, j) => sum + value * vector[j], 0))
}

/**
 * The returns the market's own weights already imply: Π = λ Σ w_mkt.
 *
 * Reverse optimisation. Instead of guessing returns and deriving weights, take
 * the weights people actually hold and ask what expectations would make them
 * optimal. No forecast is required, which is the whole appeal — the starting
 * point is an observation rather than a prediction.
 */
export function impliedEquilibriumReturns(
  cov: number[][],
  marketWeights: number[],
  riskAversion: number = DEFAULT_RISK_AVERSION,
): number[] | null {
  const n = marketWeights.length
  if (n === 0) return null
  if (!marketWeights.every(Number.isFinite)) return null
  if (!isSquareFinite(cov, n)) return null
  if (!Number.isFinite(riskAversion) || riskAversion <= 0) return null

  const total = marketWeights.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > 1e-6) return null

  const implied = covTimes(cov, marketWeights).map((value) => riskAversion * value)
  return implied.every(Number.isFinite) ? implied : null
}

export type BlackLittermanResult = {
  posteriorReturns: number[]
  /** Per asset: how far the views moved it off the equilibrium, in points. */
  shiftsPp: number[]
  viewsApplied: number
}

/** A confidence at or below this means the view is not held at all. */
const MIN_CONFIDENCE = 1e-6
/** Pivot below this makes the system singular. */
const SINGULAR_PIVOT = 1e-14

/** Solve Ax = b by Gauss-Jordan with partial pivoting. Null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length
  const m = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < SINGULAR_PIVOT) return null

    const swap = m[col]
    m[col] = m[pivot]
    m[pivot] = swap

    const divisor = m[col][col]
    for (let j = col; j <= n; j++) m[col][j] /= divisor

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row][col]
      if (factor === 0) continue
      for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j]
    }
  }

  const x = m.map((row) => row[n])
  return x.every(Number.isFinite) ? x : null
}

/**
 * Blend the equilibrium with the user's views.
 *
 *   E[R] = [ (τΣ)⁻¹ + PᵀΩ⁻¹P ]⁻¹ [ (τΣ)⁻¹Π + PᵀΩ⁻¹Q ]
 *
 * P is the view matrix (one row per opinion), Q the returns they assert, and Ω
 * the uncertainty around each — derived from the user's confidence rather than
 * set by hand: a view at confidence c gets variance scaled by (1 - c) / c, so
 * certainty shrinks it toward zero and doubt blows it up until the view is
 * effectively ignored.
 *
 * With no views the expression collapses to the equilibrium exactly, and a test
 * pins that: a user who says nothing gets the market back.
 */
export function blackLitterman(
  symbols: string[],
  cov: number[][],
  equilibriumReturns: number[],
  views: View[],
  tau: number = DEFAULT_TAU,
): BlackLittermanResult | null {
  const n = symbols.length
  if (n === 0) return null
  if (equilibriumReturns.length !== n || !equilibriumReturns.every(Number.isFinite)) return null
  if (!isSquareFinite(cov, n)) return null
  if (!Number.isFinite(tau) || tau <= 0) return null

  // Validate every view before using any of them: a typo'd symbol should be a
  // refusal, not a silently dropped opinion the user believes was applied.
  const usable: View[] = []
  for (const view of views) {
    if (view.symbols.length !== view.weights.length || view.symbols.length === 0) return null
    if (!view.weights.every(Number.isFinite)) return null
    if (!Number.isFinite(view.expectedReturn)) return null
    if (!Number.isFinite(view.confidence) || view.confidence < 0 || view.confidence > 1) return null
    if (!view.symbols.every((s) => symbols.includes(s))) return null

    if (view.confidence > MIN_CONFIDENCE) usable.push(view)
  }

  const equilibrium = [...equilibriumReturns]

  if (usable.length === 0) {
    return {
      posteriorReturns: equilibrium,
      shiftsPp: new Array(n).fill(0),
      viewsApplied: 0,
    }
  }

  // P: one row per view, one column per asset.
  const P = usable.map((view) => {
    const row = new Array<number>(n).fill(0)
    view.symbols.forEach((symbol, i) => {
      row[symbols.indexOf(symbol)] += view.weights[i]
    })
    return row
  })
  const Q = usable.map((view) => view.expectedReturn)

  // Omega, diagonal. The base uncertainty of a view is P τΣ Pᵀ — how much the
  // covariance itself says that combination can vary — scaled by the user's
  // doubt. Confidence 1 would give zero variance and a singular system, so it
  // is held just short of certain.
  const omega: number[] = P.map((row, k) => {
    const tauSigmaRow = covTimes(cov, row).map((v) => v * tau)
    const base = row.reduce((sum, value, j) => sum + value * tauSigmaRow[j], 0)
    const confidence = Math.min(usable[k].confidence, 0.99)
    const scale = (1 - confidence) / confidence
    const variance = Math.max(base, 1e-12) * scale
    return Number.isFinite(variance) && variance > 0 ? variance : 1e-6
  })

  // (τΣ)⁻¹ — inverted by solving against the identity.
  const tauSigma = cov.map((row) => row.map((v) => v * tau))
  const tauSigmaInv: number[][] = []
  for (let i = 0; i < n; i++) {
    const e = new Array<number>(n).fill(0)
    e[i] = 1
    const column = solve(tauSigma, e)
    if (!column) return null
    tauSigmaInv.push(column)
  }
  // solve() returned columns; transpose back into rows.
  const inv = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => tauSigmaInv[j][i]),
  )

  // A = (τΣ)⁻¹ + Pᵀ Ω⁻¹ P     and     b = (τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q
  const A = inv.map((row) => [...row])
  const b = covTimes(inv, equilibrium)

  for (let k = 0; k < P.length; k++) {
    const weight = 1 / omega[k]
    for (let i = 0; i < n; i++) {
      if (P[k][i] === 0) continue
      for (let j = 0; j < n; j++) {
        if (P[k][j] === 0) continue
        A[i][j] += P[k][i] * weight * P[k][j]
      }
      b[i] += P[k][i] * weight * Q[k]
    }
  }

  const posterior = solve(A, b)
  if (!posterior) return null

  return {
    posteriorReturns: posterior,
    shiftsPp: posterior.map((value, i) => (value - equilibrium[i]) * 100),
    viewsApplied: usable.length,
  }
}

export type BLWeightShift = {
  symbol: string
  markowitzWeight: number
  blackLittermanWeight: number
  deltaPp: number
}

export type BLComparison = {
  equilibriumReturns: number[]
  posteriorReturns: number[]
  markowitz: FrontierPoint
  blackLitterman: FrontierPoint
  weightShifts: BLWeightShift[]
  viewsApplied: number
  summary: string
  caveat: string
}

/** A weight moving less than this is optimiser noise, not a decision. */
const MATERIAL_SHIFT_PP = 1

/**
 * Build a comparable point from a weight vector.
 *
 * Same shape the frontier produces, so the interface can render either without
 * knowing which optimiser made it.
 */
function toPoint(
  weights: number[],
  cov: number[][],
  returns: number[],
  symbols: string[],
  riskFreeRate: number,
): FrontierPoint | null {
  const stats = portfolioRiskReturn(weights, cov, returns)
  if (!stats) return null

  return {
    expectedReturnPct: stats.expectedReturn * 100,
    volatilityPct: stats.volatility * 100,
    sharpe:
      stats.volatility > 1e-8 ? (stats.expectedReturn - riskFreeRate) / stats.volatility : null,
    weights: symbols.map((symbol, i) => ({ symbol, weight: weights[i] })),
  }
}

/**
 * The same book optimised on the equilibrium and on the blended view.
 *
 * ── Why utility, not max-Sharpe ─────────────────────────────────────────────
 *
 * The first version took the max-Sharpe point of each frontier, and the model's
 * defining property broke: with no views the answer came back at 1.6% where the
 * market held 50%. Max-Sharpe is a different objective, and the equilibrium does
 * not reproduce the market weights under it.
 *
 * Black-Litterman is a UTILITY model. The equilibrium is defined as
 * Pi = lambda * Sigma * w_mkt precisely so that maximising
 * Pi'w - (lambda/2) w'Sigma w returns w_mkt exactly. Optimising anything else
 * throws that away — and "no opinion gives you the market" is the whole reason
 * the model is safe to put in front of someone learning.
 *
 * optimiseWeights maximises mu'w - aversion * w'Sigma w with no one-half, so the
 * aversion passed here is lambda/2. A test pins the round trip.
 */
export function compareBlackLittermanVsMarkowitz(
  symbols: string[],
  cov: number[][],
  marketWeights: number[],
  views: View[],
  options: { riskFreeRate: number; riskAversion?: number; tau?: number },
): BLComparison | null {
  if (symbols.length < 2 || marketWeights.length !== symbols.length) return null

  const equilibriumReturns = impliedEquilibriumReturns(
    cov,
    marketWeights,
    options.riskAversion ?? DEFAULT_RISK_AVERSION,
  )
  if (!equilibriumReturns) return null

  const blended = blackLitterman(symbols, cov, equilibriumReturns, views, options.tau)
  if (!blended) return null

  // lambda/2 because optimiseWeights carries no one-half in its risk term.
  const aversion = (options.riskAversion ?? DEFAULT_RISK_AVERSION) / 2

  const priorWeights = optimiseWeights(cov, equilibriumReturns, aversion)
  const posteriorWeights = optimiseWeights(cov, blended.posteriorReturns, aversion)
  if (!priorWeights || !posteriorWeights) return null

  const markowitz = toPoint(priorWeights, cov, equilibriumReturns, symbols, options.riskFreeRate)
  const blackLittermanPoint = toPoint(
    posteriorWeights,
    cov,
    blended.posteriorReturns,
    symbols,
    options.riskFreeRate,
  )
  if (!markowitz || !blackLittermanPoint) return null

  const posteriorBySymbol = new Map(blackLittermanPoint.weights.map((w) => [w.symbol, w.weight]))
  const weightShifts: BLWeightShift[] = markowitz.weights.map((w) => {
    const posterior = posteriorBySymbol.get(w.symbol) ?? 0
    return {
      symbol: w.symbol,
      markowitzWeight: w.weight,
      blackLittermanWeight: posterior,
      deltaPp: (posterior - w.weight) * 100,
    }
  })

  const moved = weightShifts
    .filter((s) => Math.abs(s.deltaPp) >= MATERIAL_SHIFT_PP)
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))

  const summary =
    blended.viewsApplied === 0
      ? 'Sin opiniones, Black-Litterman devuelve exactamente la cartera que el mercado ya implica. No es que el modelo no haya hecho nada: ese ES su punto de partida, y que exista un punto de partida sensato es justo lo que le falta a la media-varianza clásica, que sin opiniones se va a las esquinas.'
      : moved.length === 0
        ? `Tus ${blended.viewsApplied} opinión(es) no mueven los pesos de forma apreciable. Suele pasar cuando la confianza declarada es baja o cuando la opinión coincide con lo que el mercado ya descuenta: si todo el mundo ya piensa eso, está en el precio.`
        : `Tus ${blended.viewsApplied} opinión(es) mueven ${moved.length} de ${weightShifts.length} pesos respecto a la cartera de equilibrio. Los mayores cambios: ` +
          moved
            .slice(0, 3)
            .map(
              (s) =>
                `${s.symbol} ${s.deltaPp >= 0 ? '+' : ''}${s.deltaPp.toFixed(1)} puntos (${(s.markowitzWeight * 100).toFixed(0)}% a ${(s.blackLittermanWeight * 100).toFixed(0)}%)`,
            )
            .join(', ') +
          '. Fíjate en que también se mueven activos sobre los que no opinaste: el modelo propaga tu opinión a lo que se mueve junto con aquello de lo que hablaste, que es lo que un ajuste a mano no sabría hacer.'

  return {
    equilibriumReturns,
    posteriorReturns: blended.posteriorReturns,
    markowitz,
    blackLitterman: blackLittermanPoint,
    weightShifts,
    viewsApplied: blended.viewsApplied,
    summary,
    caveat: BLACK_LITTERMAN_CAVEAT,
  }
}
