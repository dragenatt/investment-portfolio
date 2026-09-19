// Multi-model optimisation (P2-6) — pure functions, no I/O.
//
// Five allocation models, one ruler. Each optimiser in this app reports its
// result in its own terms: the frontier in expected return and volatility, the
// CVaR strategies in daily tail loss, Black-Litterman against its equilibrium,
// the robust version against its classic twin. Put side by side like that they
// cannot be compared, because every row answers a different question.
//
// Here every model's weights are measured the same way, on the same holdings,
// window and estimates: estimated return, volatility, Sharpe, daily VaR and
// CVaR, concentration and the drawdown those weights would have had.
//
// Nothing here says which model is better, on purpose. Each optimises a
// different thing, so each wins on its own objective by construction — and they
// are all measured in-sample, on the history they were fitted to, which flatters
// whichever objective leans hardest on that history. Declaring a winner would be
// reading the construction back as a finding.

import { efficientFrontier, portfolioRiskReturn } from './optimizer'
import { minimiseCVaRWeights, riskParityWeights } from './allocation-strategies'
import {
  compareBlackLittermanVsMarkowitz,
  describeView,
  impliedEquilibriumReturns,
  viewsFromInputs,
  type BLWeightShift,
  type ViewInput,
  type ViewRejection,
} from './black-litterman'
import { compareRobustVsClassic, type ReturnRange } from './robust-optimizer'
import { conditionalVaR, historicalVaR } from './var'
import { calculateMaxDrawdown } from './analytics'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'

export const MODEL_IDS = ['markowitz', 'minCVaR', 'riskParity', 'blackLitterman', 'robust'] as const
export type ModelId = (typeof MODEL_IDS)[number]

export type ModelDefinition = {
  id: ModelId
  name: string
  /** What the model maximises or minimises, in one sentence. */
  objective: string
  /** What it needs to be believed, which is what decides how far to trust it. */
  relies_on: string
}

export const MODEL_DEFINITIONS: Record<ModelId, ModelDefinition> = {
  markowitz: {
    id: 'markowitz',
    name: 'Markowitz (máximo Sharpe)',
    objective: 'El punto de la frontera eficiente con mayor rendimiento estimado por unidad de volatilidad.',
    relies_on: 'Rendimientos esperados estimados con la media histórica, el dato más frágil de todos.',
  },
  minCVaR: {
    id: 'minCVaR',
    name: 'Mínimo CVaR',
    objective: 'La menor pérdida promedio en el 5% de los peores días del periodo.',
    relies_on: 'Que los peores días del pasado representen bien los del futuro. No usa rendimientos esperados.',
  },
  riskParity: {
    id: 'riskParity',
    name: 'Paridad de riesgo',
    objective: 'Que cada activo aporte la misma parte del riesgo del portafolio.',
    relies_on: 'Solo volatilidades y correlaciones. No usa rendimientos esperados.',
  },
  blackLitterman: {
    id: 'blackLitterman',
    name: 'Black-Litterman (sin opiniones)',
    objective: 'La cartera óptima para los rendimientos que tu asignación actual implica, ajustada por opiniones.',
    relies_on:
      'Un punto de partida de equilibrio. Sin opiniones y sin pesos de mercado por capitalización, el equilibrio sale de tus pesos actuales y el modelo los devuelve tal cual.',
  },
  robust: {
    id: 'robust',
    name: 'Optimización robusta',
    objective: 'Máximo Sharpe suponiendo el extremo pesimista del rango de cada rendimiento estimado.',
    relies_on: 'Rangos de rendimiento de ±1 error estándar de la media histórica, en vez de un punto.',
  },
}

export type Concentration = {
  /** Herfindahl index of the weights: 1 is everything in one holding. */
  hhi: number
  /** 1 / HHI: how many equal holdings would give the same concentration. */
  effectiveHoldings: number
  maxWeightPct: number
  maxWeightSymbol: string
}

export type WeightEvaluation = {
  weights: Array<{ symbol: string; weight: number }>
  /** Annualised wᵀμ on the historical means, %. An estimate, not a forecast. */
  estimatedReturnPct: number
  volatilityPct: number
  /** Null when volatility is too small for the ratio to mean anything. */
  sharpe: number | null
  /** Historical one-day VaR at 95%, as a positive loss, %. */
  var95Pct: number | null
  /** Historical one-day CVaR at 95%, as a positive loss, %. */
  cvar95Pct: number | null
  concentration: Concentration
  /** Deepest fall these weights, rebalanced daily, would have had on the window, %. */
  estimatedMaxDrawdownPct: number
}

export type ModelResult = ModelDefinition & WeightEvaluation

export type WeightSpread = {
  symbol: string
  minPct: number
  maxPct: number
  /** Max minus min across the models, in percentage points. */
  spreadPp: number
}

export type ModelComparison = {
  models: ModelResult[]
  /** Models that could not be computed on this data, with the reason. */
  unavailable: Array<{ id: ModelId; name: string; reason: string }>
  /** The book as it stands, measured with the same ruler. Not a model. */
  current: WeightEvaluation | null
  /** How far the models disagree on each holding, widest first. */
  weightSpread: WeightSpread[]
  /** Null when Black-Litterman could not be computed. */
  blackLitterman: BlackLittermanDetail | null
  summary: string
  caveat: string
}

export const MODEL_COMPARISON_CAVEAT =
  'Ningún modelo es superior en general: cada uno optimiza un objetivo distinto y gana en el suyo por construcción. Todas las cifras se miden sobre el mismo historial con el que se calcularon los pesos, lo que favorece a los modelos que más dependen de ese historial. No es una recomendación de compra o venta.'

const CONFIDENCE = 95
/** Below this, volatility is float dust and a Sharpe ratio is noise. */
const MIN_VOLATILITY = 1e-8

export type ModelComparisonInput = {
  symbols: string[]
  /** Daily returns per symbol, aligned. */
  returnsMatrix: number[][]
  /** Annualised covariance. */
  cov: number[][]
  /** Annualised historical mean returns. */
  estimatedReturns: number[]
  riskFreeRate: number
  currentWeights?: number[] | null
  /** Ranges for the robust model; without them it is unavailable. */
  ranges?: ReturnRange[] | null
  /** The user's opinions for Black-Litterman (4.7). Without them it returns the equilibrium. */
  views?: ViewInput[] | null
}

/** What the user's opinions did to Black-Litterman, for the explanation beside the table. */
export type BlackLittermanDetail = {
  /** The opinions that were applied, in words. */
  views: string[]
  /** Opinions that could not be applied, and why. */
  rejected: Array<ViewRejection & { view: string }>
  viewsApplied: number
  /** Each holding's weight in the pure equilibrium and after the opinions. */
  weightShifts: BLWeightShift[]
  /** Each holding's implied return and the blended one, in percent a year. */
  returns: Array<{ symbol: string; equilibriumPct: number; posteriorPct: number }>
  /**
   * Where the result goes against the opinion's own direction, explained. A
   * correct posterior can still surprise: see blackLittermanNotes.
   */
  notes: string[]
  summary: string
  caveat: string
}

/** A weight change smaller than this is not worth explaining. */
const NOTE_SHIFT_PP = 1

/**
 * The results a reader will think are mistakes, explained before they have to
 * ask.
 *
 * An opinion that an asset will do better raises its expected return — and,
 * through the covariance, the expected return of everything that moves with
 * it. When the others move with it MORE than it moves with them (a calm asset
 * next to volatile ones), they gain more than it does, and the optimiser can
 * end up holding less of the very asset the opinion favoured. That is the
 * model working, not failing, and the way to say "this beats that" is a
 * relative opinion.
 */
export function blackLittermanNotes(
  inputs: ViewInput[],
  applied: boolean[],
  symbols: string[],
  equilibriumReturns: number[],
  weightShifts: BLWeightShift[],
  posteriorReturns: number[],
): string[] {
  const notes: string[] = []
  inputs.forEach((input, k) => {
    if (!applied[k] || input.kind === 'outperform') return
    const i = symbols.indexOf(input.symbol)
    const shift = weightShifts.find((s) => s.symbol === input.symbol)
    if (i < 0 || !shift) return
    const asserted = input.kind === 'absolute' ? input.pct / 100 : equilibriumReturns[i] + input.pct / 100
    const bullish = asserted > equilibriumReturns[i]
    const against = bullish ? shift.deltaPp <= -NOTE_SHIFT_PP : shift.deltaPp >= NOTE_SHIFT_PP
    if (!against) return
    const others = symbols
      .map((symbol, j) => ({ symbol, gain: (posteriorReturns[j] - equilibriumReturns[j]) * 100 }))
      .filter((o) => o.symbol !== input.symbol && (bullish ? o.gain > 0 : o.gain < 0))
      .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
      .slice(0, 2)
      .map((o) => o.symbol)
    notes.push(
      `Tu opinión ${bullish ? 'sube' : 'baja'} el rendimiento esperado de ${input.symbol}, y aun así su peso ${bullish ? 'baja' : 'sube'}: ` +
        `el modelo también ${bullish ? 'subió' : 'bajó'} el de ${others.length > 0 ? others.join(' y ') : 'los activos que se mueven con él'}, que se mueven con ${input.symbol} ` +
        `más de lo que ${input.symbol} se mueve con ellos, así que ${bullish ? 'ganan' : 'pierden'} más. Es el modelo funcionando, no un error. ` +
        `Si lo que crees es que ${input.symbol} le ganará a otro activo, decláralo así ("superará a").`,
    )
  })
  return notes
}

function normalised(weights: number[]): number[] | null {
  if (!weights.every((w) => Number.isFinite(w) && w >= -1e-9)) return null
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0)
  if (!(total > 0)) return null
  return weights.map((w) => Math.max(0, w) / total)
}

/**
 * Measure a weight vector with the ruler every model shares.
 *
 * Returns null for weights that are not a long-only, fully invested portfolio
 * of these holdings, or inputs that do not line up.
 */
export function evaluateWeights(
  input: Pick<ModelComparisonInput, 'symbols' | 'returnsMatrix' | 'cov' | 'estimatedReturns' | 'riskFreeRate'>,
  rawWeights: number[],
): WeightEvaluation | null {
  const { symbols, returnsMatrix, cov, estimatedReturns, riskFreeRate } = input
  const n = symbols.length
  if (n === 0 || rawWeights.length !== n || returnsMatrix.length !== n || estimatedReturns.length !== n) return null
  const weights = normalised(rawWeights)
  if (!weights) return null

  const stats = portfolioRiskReturn(weights, cov, estimatedReturns)
  if (!stats || !Number.isFinite(stats.expectedReturn) || !Number.isFinite(stats.volatility)) return null

  const T = returnsMatrix[0]?.length ?? 0
  if (T === 0 || returnsMatrix.some((r) => r.length !== T || !r.every(Number.isFinite))) return null
  const blended = Array.from({ length: T }, (_, t) => weights.reduce((sum, w, i) => sum + w * returnsMatrix[i][t], 0))

  // Constant weights, rebalanced each day: the drawdown of the weights, not of
  // any particular sequence of trades.
  const values: number[] = [1]
  for (const r of blended) values.push(values[values.length - 1] * (1 + r))

  const var95 = historicalVaR(blended, CONFIDENCE)
  const cvar95 = conditionalVaR(blended, CONFIDENCE)

  const hhi = weights.reduce((sum, w) => sum + w * w, 0)
  const maxIndex = weights.reduce((best, w, i) => (w > weights[best] ? i : best), 0)

  return {
    weights: symbols.map((symbol, i) => ({ symbol, weight: weights[i] })),
    estimatedReturnPct: stats.expectedReturn * 100,
    volatilityPct: stats.volatility * 100,
    sharpe: stats.volatility > MIN_VOLATILITY ? (stats.expectedReturn - riskFreeRate) / stats.volatility : null,
    var95Pct: var95 === null ? null : var95 * 100,
    cvar95Pct: cvar95 === null ? null : cvar95 * 100,
    concentration: {
      hhi,
      effectiveHoldings: 1 / hhi,
      maxWeightPct: weights[maxIndex] * 100,
      maxWeightSymbol: symbols[maxIndex],
    },
    estimatedMaxDrawdownPct: calculateMaxDrawdown(values),
  }
}

/**
 * Black-Litterman with the user's opinions. The equilibrium is the one their
 * current weights imply, so with no opinions the model hands their book back.
 */
function blackLittermanWithViews(input: ModelComparisonInput) {
  const { symbols, cov, riskFreeRate, currentWeights } = input
  if (!currentWeights || currentWeights.length !== symbols.length) return null
  const equilibrium = impliedEquilibriumReturns(cov, currentWeights)
  if (!equilibrium) return null
  const stated = input.views ?? []
  const { views, rejected } = viewsFromInputs(stated, symbols, equilibrium)
  const comparison = compareBlackLittermanVsMarkowitz(symbols, cov, currentWeights, views, { riskFreeRate })
  if (!comparison) return null
  const applied = stated.map((_, i) => !rejected.some((r) => r.index === i))
  const detail: BlackLittermanDetail = {
    views: stated.filter((_, i) => applied[i]).map(describeView),
    rejected: rejected.map((r) => ({ ...r, view: describeView(stated[r.index]) })),
    viewsApplied: comparison.viewsApplied,
    weightShifts: comparison.weightShifts,
    returns: symbols.map((symbol, i) => ({
      symbol,
      equilibriumPct: comparison.equilibriumReturns[i] * 100,
      posteriorPct: comparison.posteriorReturns[i] * 100,
    })),
    notes: blackLittermanNotes(stated, applied, symbols, equilibrium, comparison.weightShifts, comparison.posteriorReturns),
    summary: comparison.summary,
    caveat: comparison.caveat,
  }
  return { comparison, detail }
}

/** Every model's weights, or the reason it has none on this data. */
function modelWeights(
  input: ModelComparisonInput,
  bl: ReturnType<typeof blackLittermanWithViews>,
): Record<ModelId, number[] | string> {
  const { symbols, cov, estimatedReturns, riskFreeRate, returnsMatrix } = input
  const weightsOf = (point: { weights: Array<{ symbol: string; weight: number }> } | null | undefined) =>
    point ? symbols.map((s) => point.weights.find((w) => w.symbol === s)?.weight ?? 0) : null

  const frontier = efficientFrontier(symbols, cov, estimatedReturns, { riskFreeRate })
  const cvar = minimiseCVaRWeights(returnsMatrix, CONFIDENCE)
  const parity = riskParityWeights(cov)
  const robust =
    input.ranges && input.ranges.length === symbols.length
      ? compareRobustVsClassic(symbols, cov, input.ranges, { riskFreeRate })
      : null

  return {
    markowitz: weightsOf(frontier?.maxSharpe) ?? 'No se pudo trazar la frontera eficiente con estos datos.',
    minCVaR: cvar ?? 'No hay suficientes días en el historial para medir la cola de pérdidas.',
    riskParity: parity ?? 'La matriz de covarianza no permite repartir el riesgo por igual.',
    blackLitterman:
      weightsOf(bl?.comparison.blackLitterman) ??
      (input.currentWeights ? 'No se pudo derivar el equilibrio de tus pesos actuales.' : 'Se necesitan los pesos actuales del portafolio.'),
    robust: weightsOf(robust?.robust) ?? 'No hay rangos de rendimiento con los que optimizar el peor caso.',
  }
}

/**
 * Run the five models and measure each with the same ruler.
 */
export function compareModels(input: ModelComparisonInput): ModelComparison | null {
  const n = input.symbols.length
  if (n < 2 || input.returnsMatrix.length !== n || input.cov.length !== n || input.estimatedReturns.length !== n) return null

  const bl = blackLittermanWithViews(input)
  const weights = modelWeights(input, bl)
  const models: ModelResult[] = []
  const unavailable: ModelComparison['unavailable'] = []

  for (const id of MODEL_IDS) {
    const definition = MODEL_DEFINITIONS[id]
    const w = weights[id]
    const evaluation = typeof w === 'string' ? null : evaluateWeights(input, w)
    if (evaluation) models.push({ ...definition, ...evaluation })
    else unavailable.push({ id, name: definition.name, reason: typeof w === 'string' ? w : 'Los pesos obtenidos no forman una cartera válida.' })
  }

  if (models.length === 0) return null

  const current = input.currentWeights ? evaluateWeights(input, input.currentWeights) : null

  const weightSpread: WeightSpread[] = input.symbols
    .map((symbol, i) => {
      const values = models.map((m) => m.weights[i].weight * 100)
      const minPct = Math.min(...values)
      const maxPct = Math.max(...values)
      return { symbol, minPct, maxPct, spreadPp: maxPct - minPct }
    })
    .sort((a, b) => b.spreadPp - a.spreadPp)

  return {
    models,
    unavailable,
    current,
    weightSpread,
    blackLitterman: bl?.detail ?? null,
    summary: describeModelComparison(models, weightSpread),
    caveat: MODEL_COMPARISON_CAVEAT,
  }
}

/** Below this spread, the models agree on a holding for practical purposes. */
const AGREEMENT_PP = 10

/**
 * Where the models agree and where they do not — never which one is right.
 */
export function describeModelComparison(models: ModelResult[], spread: WeightSpread[]): string {
  if (models.length < 2 || spread.length === 0) {
    return models.length === 1 ? `Solo se pudo calcular ${models[0].name}; no hay con qué compararlo.` : ''
  }
  const widest = spread[0]
  const agreed = spread.filter((s) => s.spreadPp < AGREEMENT_PP)
  const volatilities = models.map((m) => m.volatilityPct)
  const volRange = `${Math.min(...volatilities).toFixed(1)}% a ${Math.max(...volatilities).toFixed(1)}%`

  const disagreement =
    widest.spreadPp < AGREEMENT_PP
      ? `Los ${models.length} modelos llegan a pesos parecidos: ningún activo varía más de ${widest.spreadPp.toFixed(0)} puntos entre ellos.`
      : `Donde más difieren es en ${widest.symbol}: de ${widest.minPct.toFixed(0)}% a ${widest.maxPct.toFixed(0)}% según el modelo.`

  const agreement =
    agreed.length > 0 && widest.spreadPp >= AGREEMENT_PP
      ? ` Coinciden, con menos de ${AGREEMENT_PP} puntos de diferencia, en ${agreed.map((s) => s.symbol).join(', ')}.`
      : ''

  return `${disagreement}${agreement} La volatilidad estimada va de ${volRange}. Cada modelo optimiza algo distinto, así que las diferencias muestran qué supone cada uno, no cuál acierta.`
}

/** Annualisation factor for daily bars, exported for the tests. */
export const MODEL_TRADING_DAYS = TRADING_DAYS
