// Optimisation that admits it does not know the expected returns.
//
// optimizer.ts takes a single number per asset — "AAPL will return 10%" — and
// FRONTIER_CAVEAT spends a paragraph apologising for it, because the optimiser
// is exquisitely sensitive to that number and nobody can estimate it well.
//
// This file does something about that instead of only warning. The input is a
// RANGE per asset ("AAPL: 8% to 12%") and the answer is the portfolio that does
// best assuming every estimate lands at the bad end of its range at once.
//
// ── Why the worst case is just the lower corner ─────────────────────────────
//
// Weights here are long-only, so every wᵢ ≥ 0, and
//
//     min over μ in the box of  μ'w  =  Σ (μᵢ − δᵢ) wᵢ
//
// exactly. The worst point of a box, for a non-negative weight vector, IS its
// lower corner — no search, no inner optimisation. Robust box optimisation for
// a long-only book therefore reduces to classic Markowitz run on the pessimistic
// edge of every range.
//
// That reduction is worth stating plainly rather than dressing up: the value
// here is not a cleverer algorithm, it is that an asset you are UNSURE about
// gets penalised by exactly how unsure you are. Two assets with the same
// midpoint estimate and the same volatility are identical to mean-variance and
// different to this, which is the whole demonstration.
//
// The second half, weightSensitivity, is arguably the more useful one: it shows
// how far the "optimal" weights move as the estimates wander inside their own
// stated ranges. A weight that swings from 0% to 47% across your own error bars
// was never an optimum, it was a coin landing.

import { efficientFrontier, type FrontierPoint } from './optimizer'

export type ReturnRange = {
  symbol: string
  /** Annual, as a decimal fraction. */
  low: number
  high: number
}

export type RobustOptions = {
  riskFreeRate: number
}

export const ROBUST_CAVEAT =
  'La optimizacion robusta no adivina mejor que la clasica: asume lo peor dentro del rango que TU declaraste. ' +
  'Si el rango esta mal puesto, el resultado tambien lo estara — solo que ahora el error es explicito en vez ' +
  'de estar escondido en un numero unico. Su virtud no es acertar mas, es castigar a los activos sobre los ' +
  'que tienes menos certeza, que es exactamente lo que la media-varianza clasica no sabe hacer.'

function usableRanges(ranges: ReturnRange[]): boolean {
  if (ranges.length === 0) return false
  return ranges.every(
    (r) => Number.isFinite(r.low) && Number.isFinite(r.high) && r.low <= r.high,
  )
}

/** The pessimistic edge of every range: the exact worst case for long-only weights. */
export function worstCaseReturns(ranges: ReturnRange[]): number[] | null {
  if (!usableRanges(ranges)) return null
  return ranges.map((r) => r.low)
}

/** The middle of every range — what a classic optimiser would have been handed. */
export function midpointReturns(ranges: ReturnRange[]): number[] | null {
  if (!usableRanges(ranges)) return null
  return ranges.map((r) => (r.low + r.high) / 2)
}

export type WeightShift = {
  symbol: string
  classicWeight: number
  robustWeight: number
  /** Robust minus classic, in percentage points. */
  deltaPp: number
}

export type RobustComparison = {
  classic: FrontierPoint
  robust: FrontierPoint
  weightShifts: WeightShift[]
  summary: string
  caveat: string
}

/** A weight moving less than this is noise from the optimiser, not a decision. */
const MATERIAL_SHIFT_PP = 1

/**
 * The same book optimised twice: once on the midpoints, once on the worst case.
 *
 * Both use the max-Sharpe point of their own frontier, so the two are compared
 * at the same place on the curve rather than at two arbitrary risk levels.
 */
export function compareRobustVsClassic(
  symbols: string[],
  cov: number[][],
  ranges: ReturnRange[],
  options: RobustOptions,
): RobustComparison | null {
  if (symbols.length < 2 || ranges.length !== symbols.length) return null

  const midpoints = midpointReturns(ranges)
  const worstCase = worstCaseReturns(ranges)
  if (!midpoints || !worstCase) return null

  const classicFrontier = efficientFrontier(symbols, cov, midpoints, options)
  const robustFrontier = efficientFrontier(symbols, cov, worstCase, options)
  if (!classicFrontier || !robustFrontier) return null

  const classic = classicFrontier.maxSharpe
  const robust = robustFrontier.maxSharpe

  const robustBySymbol = new Map(robust.weights.map((w) => [w.symbol, w.weight]))
  const weightShifts: WeightShift[] = classic.weights.map((w) => {
    const robustWeight = robustBySymbol.get(w.symbol) ?? 0
    return {
      symbol: w.symbol,
      classicWeight: w.weight,
      robustWeight,
      deltaPp: (robustWeight - w.weight) * 100,
    }
  })

  const moved = weightShifts
    .filter((s) => Math.abs(s.deltaPp) >= MATERIAL_SHIFT_PP)
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))

  const widest = ranges.reduce((w, r) => (r.high - r.low > w.high - w.low ? r : w))
  const widthPp = (widest.high - widest.low) * 100

  const summary =
    moved.length === 0
      ? `Ser pesimista no cambia nada aqui: con los rangos que diste, la cartera optima es practicamente la misma (${weightShifts.length} pesos, ninguno se mueve mas de un punto). Eso pasa cuando todos los activos tienen incertidumbres parecidas — el castigo cae igual sobre todos y el orden no cambia.`
      : `Asumir lo peor de cada rango mueve ${moved.length} de ${weightShifts.length} pesos. El mayor cambio es ` +
        moved
          .slice(0, 3)
          .map(
            (s) =>
              `${s.symbol} ${s.deltaPp >= 0 ? '+' : ''}${s.deltaPp.toFixed(1)} puntos (${(s.classicWeight * 100).toFixed(0)}% a ${(s.robustWeight * 100).toFixed(0)}%)`,
          )
          .join(', ') +
        `. El rango mas ancho que declaraste es el de ${widest.symbol}, ${widthPp.toFixed(1)} puntos de amplitud, y por eso es el que mas peso pierde: la version robusta no penaliza el riesgo del activo, penaliza tu falta de certeza sobre el.`

  return { classic, robust, weightShifts, summary, caveat: ROBUST_CAVEAT }
}

export type AssetSensitivity = {
  symbol: string
  minWeight: number
  maxWeight: number
  /** How far the weight travelled across the uncertainty box, in points. */
  spreadPp: number
  midpointWeight: number
}

export type WeightSensitivity = {
  samples: number
  perAsset: AssetSensitivity[]
  mostSensitive: string
  summary: string
}

/** Above this spread, a weight is not an answer, it is a coin landing. */
const FRAGILE_SPREAD_PP = 20

/** 2^n corners is not a plan for large books; the sampling stops here. */
const MAX_SAMPLES = 256

/**
 * Every corner of the uncertainty box, and what the optimiser says at each.
 *
 * Corners rather than random draws, and for two reasons. They are the extremes,
 * so they bracket everything in between for a linear objective; and they are
 * deterministic, so the same inputs give the same answer without a seed to
 * manage.
 *
 * Above MAX_SAMPLES assets the full corner set is too large, so a fixed subset
 * is taken — enough to show the shape, and the sample count is reported so the
 * result is not mistaken for exhaustive.
 */
export function weightSensitivity(
  symbols: string[],
  cov: number[][],
  ranges: ReturnRange[],
  options: RobustOptions,
): WeightSensitivity | null {
  if (symbols.length < 2 || ranges.length !== symbols.length) return null
  if (!usableRanges(ranges)) return null

  const n = symbols.length
  const fullCorners = Math.pow(2, n)
  const samples = Math.min(fullCorners, MAX_SAMPLES)

  const mins = new Array<number>(n).fill(Infinity)
  const maxs = new Array<number>(n).fill(-Infinity)
  let evaluated = 0

  for (let mask = 0; mask < samples; mask++) {
    // Bit i decides whether asset i sits at its low or high end.
    const corner = ranges.map((r, i) => ((mask >> i) & 1 ? r.high : r.low))

    const frontier = efficientFrontier(symbols, cov, corner, options)
    if (!frontier) continue

    const weights = new Map(frontier.maxSharpe.weights.map((w) => [w.symbol, w.weight]))
    for (let i = 0; i < n; i++) {
      const weight = weights.get(symbols[i]) ?? 0
      if (!Number.isFinite(weight)) continue
      mins[i] = Math.min(mins[i], weight)
      maxs[i] = Math.max(maxs[i], weight)
    }
    evaluated++
  }

  if (evaluated === 0) return null

  const midpoints = midpointReturns(ranges)!
  const midFrontier = efficientFrontier(symbols, cov, midpoints, options)
  if (!midFrontier) return null
  const midWeights = new Map(midFrontier.maxSharpe.weights.map((w) => [w.symbol, w.weight]))

  const perAsset: AssetSensitivity[] = symbols.map((symbol, i) => {
    const minWeight = Number.isFinite(mins[i]) ? mins[i] : 0
    const maxWeight = Number.isFinite(maxs[i]) ? maxs[i] : 0
    return {
      symbol,
      minWeight,
      maxWeight,
      spreadPp: (maxWeight - minWeight) * 100,
      midpointWeight: midWeights.get(symbol) ?? 0,
    }
  })

  const worst = perAsset.reduce((a, b) => (b.spreadPp > a.spreadPp ? b : a))

  const summary =
    worst.spreadPp >= FRAGILE_SPREAD_PP
      ? `Dentro de los rangos que tu mismo declaraste, el peso optimo de ${worst.symbol} va del ${(worst.minWeight * 100).toFixed(0)}% al ${(worst.maxWeight * 100).toFixed(0)}% — ${worst.spreadPp.toFixed(0)} puntos de diferencia sin salirte de tus propios supuestos. Un numero que se mueve tanto por dentro de tu margen de error no es una respuesta, es una moneda al aire. Asi de fragil es la media-varianza cuando los rendimientos esperados no se conocen bien.`
      : `El peso que mas se mueve es el de ${worst.symbol}, ${worst.spreadPp.toFixed(0)} puntos de un extremo a otro de tus rangos. Es poco: con estos supuestos la cartera optima es razonablemente estable, y eso suele significar que la matriz de covarianza manda mas que los rendimientos esperados. Es la mejor situacion posible, porque la covarianza se estima mucho mejor.`

  return { samples: evaluated, perAsset, mostSensitive: worst.symbol, summary }
}
