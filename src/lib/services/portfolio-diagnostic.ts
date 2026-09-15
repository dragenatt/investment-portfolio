// Portfolio diagnostic (P2-8) — pure functions, no I/O.
//
// Nine plain questions, each answered with a sentence and the figures behind
// it, from engines that already exist: the risk sources (P2-5), the temporal
// attribution (P2-4), drawdown episodes, and the risk decomposition for the
// two "what if" questions. This module composes; it does not re-derive.
//
// Nothing here changes a portfolio or proposes a trade. The last two answers
// describe what WOULD happen to the measured risk under a change, phrased as a
// sensitivity, and the reader decides what, if anything, to do with it.

import type { RiskSources } from './risk-sources'
import type { TemporalAttribution } from './temporal-attribution'
import { analyseDrawdowns } from './drawdown'
import { portfolioVolatility } from './risk-attribution'

export const DIAGNOSTIC_QUESTION_IDS = [
  'risk_concentration',
  'top_return',
  'top_risk',
  'sector_overexposure',
  'vs_benchmark',
  'worst_drawdown',
  'recovery',
  'risk_levers',
  'rebalance',
] as const
export type DiagnosticQuestionId = (typeof DIAGNOSTIC_QUESTION_IDS)[number]

export type DiagnosticFigure = { label: string; value: string }

export type DiagnosticAnswer = {
  id: DiagnosticQuestionId
  question: string
  /** Null when the data to answer is not there; `unavailableReason` says why. */
  answer: string | null
  figures: DiagnosticFigure[]
  unavailableReason?: string
}

export type PortfolioDiagnostic = {
  answers: DiagnosticAnswer[]
  answered: number
  caveat: string
}

export const DIAGNOSTIC_CAVEAT =
  'Diagnóstico automático con los datos del periodo. Describe y mide; no ejecuta cambios ni recomienda comprar o vender. Las respuestas sobre qué cambiaría el riesgo o qué pasaría al rebalancear son sensibilidades sobre el pasado, no pronósticos.'

export type DiagnosticInput = {
  riskSources: RiskSources | null
  /** Current weights of the holdings the covariance covers, in its order. */
  holdings: Array<{ symbol: string; weight: number; companySector: string | null }> | null
  /** Annualised covariance, ordered as `holdings`. */
  cov: number[][] | null
  /** Price growth factor of each holding over the risk window (last / first close). */
  growth: number[] | null
  windowStart: string | null
  /** Attribution at daily granularity over the return window. */
  attribution: TemporalAttribution | null
  benchmark: { name: string; returnPct: number | null } | null
}

/** Above this share of the book, a sector is called overexposed (the threshold exposure.ts uses). */
export const SECTOR_OVEREXPOSURE_PCT = 35
/** The size of the hypothetical shift in the risk-lever answer, in percentage points. */
export const LEVER_SHIFT_PP = 5

const pct = (value: number, decimals = 1) => `${value.toFixed(decimals)}%`
const pp = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)} pp`
const signedPct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const days = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`

function missing(id: DiagnosticQuestionId, question: string, reason: string): DiagnosticAnswer {
  return { id, question, answer: null, figures: [], unavailableReason: reason }
}

const NO_RISK = 'Se necesitan al menos dos posiciones con historial común para medir el riesgo.'
const NO_RETURNS = 'No hay historial de operaciones y precios suficiente en el periodo para medir rendimientos.'

// ─── Questions ──────────────────────────────────────────────────────────────

function riskConcentration(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Dónde está concentrado mi riesgo?'
  const rs = input.riskSources
  if (!rs || rs.byAsset.length === 0) return missing('risk_concentration', question, NO_RISK)
  const top = rs.byAsset[0]
  const sector = rs.bySector[0]
  const component = rs.byComponent?.components[0] ?? null
  const figures: DiagnosticFigure[] = [
    { label: `Mayor activo: ${top.symbol}`, value: pct(top.percentOfRisk) },
    { label: `Mayor sector: ${sector.sector}`, value: pct(sector.percentOfRisk) },
  ]
  if (component && !component.nearlyTied) figures.push({ label: 'Primer componente principal', value: pct(component.percentOfRisk) })
  if (rs.byComponent) figures.push({ label: 'Apuestas independientes', value: rs.byComponent.effectiveBets.toFixed(1) })
  return {
    id: 'risk_concentration',
    question,
    answer:
      `En ${top.symbol} (${pct(top.percentOfRisk, 0)} del riesgo) y, por sector, en ${sector.sector} (${pct(sector.percentOfRisk, 0)}).` +
      (rs.byComponent ? ` Tus ${rs.byAsset.length} posiciones se comportan como ${rs.byComponent.effectiveBets.toFixed(1)} apuestas independientes.` : ''),
    figures,
  }
}

function topReturn(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Qué activo aporta más rendimiento?'
  const total = input.attribution?.total
  if (!total || total.holdings.length === 0) return missing('top_return', question, NO_RETURNS)
  const best = total.holdings[0]
  const worst = total.holdings[total.holdings.length - 1]
  return {
    id: 'top_return',
    question,
    answer:
      `${best.symbol}, con ${pp(best.contributionPct)} de un rendimiento total de ${signedPct(total.portfolioReturnPct)} entre ${total.start} y ${total.end}.` +
      (worst.symbol !== best.symbol && worst.contributionPct < 0 ? ` El que más restó fue ${worst.symbol} (${pp(worst.contributionPct)}).` : ''),
    figures: total.holdings.slice(0, 5).map((h) => ({ label: h.symbol, value: pp(h.contributionPct) })),
  }
}

function topRisk(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Qué activo aporta más riesgo?'
  const rs = input.riskSources
  if (!rs || rs.byAsset.length === 0) return missing('top_risk', question, NO_RISK)
  const top = rs.byAsset[0]
  const gap = top.percentOfRisk - top.weightPct
  return {
    id: 'top_risk',
    question,
    answer:
      `${top.symbol}: ${pct(top.percentOfRisk, 0)} del riesgo con ${pct(top.weightPct, 0)} del dinero` +
      (Math.abs(gap) >= 5 ? `, ${Math.abs(gap).toFixed(0)} puntos ${gap > 0 ? 'más' : 'menos'} en riesgo que en peso` : '') +
      `. Su volatilidad anual fue ${pct(top.volatilityPct, 0)} y su correlación con el portafolio ${top.correlationWithPortfolio.toFixed(2)}.`,
    figures: rs.byAsset.slice(0, 5).map((a) => ({ label: `${a.symbol} (peso ${pct(a.weightPct, 0)})`, value: pct(a.percentOfRisk) })),
  }
}

function sectorOverexposure(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Qué sectores están sobreexpuestos?'
  const holdings = input.holdings
  if (!holdings || holdings.length === 0) return missing('sector_overexposure', question, NO_RISK)
  const known = holdings.filter((h) => h.companySector)
  const coverage = known.reduce((s, h) => s + h.weight, 0) * 100
  if (known.length === 0) {
    return missing('sector_overexposure', question, 'Ninguna posición tiene sector conocido (los ETF e índices no tienen uno solo).')
  }
  const bySector = new Map<string, number>()
  for (const h of known) bySector.set(h.companySector!, (bySector.get(h.companySector!) ?? 0) + h.weight * 100)
  const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1])
  const over = sorted.filter(([, w]) => w > SECTOR_OVEREXPOSURE_PCT)
  const riskBySector = new Map((input.riskSources?.bySector ?? []).map((s) => [s.sector, s.percentOfRisk]))
  return {
    id: 'sector_overexposure',
    question,
    answer:
      (over.length === 0
        ? `Ninguno pasa de ${SECTOR_OVEREXPOSURE_PCT}% del portafolio; el mayor es ${sorted[0][0]} con ${pct(sorted[0][1], 0)}.`
        : `${over.map(([s, w]) => `${s} (${pct(w, 0)})`).join(' y ')} ${over.length === 1 ? 'pasa' : 'pasan'} de ${SECTOR_OVEREXPOSURE_PCT}% del portafolio.`) +
      (coverage < 99 ? ` El sector solo se conoce para ${pct(coverage, 0)} del valor.` : ''),
    figures: sorted.slice(0, 5).map(([s, w]) => ({
      label: s,
      value: `${pct(w)}${riskBySector.has(s) ? ` · ${pct(riskBySector.get(s)!)} del riesgo` : ''}`,
    })),
  }
}

function vsBenchmark(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Cómo me fue contra el benchmark?'
  const total = input.attribution?.total
  const bench = input.benchmark
  if (!total) return missing('vs_benchmark', question, NO_RETURNS)
  if (!bench || bench.returnPct === null) return missing('vs_benchmark', question, 'No hay precios del benchmark en el mismo periodo.')
  const diff = total.portfolioReturnPct - bench.returnPct
  return {
    id: 'vs_benchmark',
    question,
    answer: `Entre ${total.start} y ${total.end} tu portafolio rindió ${signedPct(total.portfolioReturnPct)} (ponderado por tiempo) y ${bench.name} ${signedPct(bench.returnPct)}: ${Math.abs(diff).toFixed(2)} puntos ${diff >= 0 ? 'por encima' : 'por debajo'}.`,
    figures: [
      { label: 'Tu portafolio', value: signedPct(total.portfolioReturnPct) },
      { label: bench.name, value: signedPct(bench.returnPct) },
      { label: 'Diferencia', value: pp(diff) },
    ],
  }
}

/** The time-weighted index of the book, from the daily attribution buckets. */
export function twrIndex(attribution: TemporalAttribution | null): Array<{ date: string; value: number }> {
  if (!attribution || attribution.buckets.length === 0) return []
  const points = [{ date: attribution.buckets[0].start, value: 1 }]
  let value = 1
  for (const bucket of attribution.buckets) {
    value *= 1 + bucket.portfolioReturnPct / 100
    points.push({ date: bucket.end, value })
  }
  return points
}

function drawdownAnswers(input: DiagnosticInput): [DiagnosticAnswer, DiagnosticAnswer] {
  const q1 = '¿Cuál fue mi peor drawdown?'
  const q2 = '¿Cuánto tardé en recuperarme?'
  const index = twrIndex(input.attribution)
  if (index.length < 3) return [missing('worst_drawdown', q1, NO_RETURNS), missing('recovery', q2, NO_RETURNS)]
  const analysis = analyseDrawdowns(index)
  const worst = analysis.worstEpisode
  if (!worst || worst.depthPct <= 0) {
    const none = `No hubo caídas en el periodo medido (${index[0].date} a ${index[index.length - 1].date}).`
    return [
      { id: 'worst_drawdown', question: q1, answer: none, figures: [] },
      { id: 'recovery', question: q2, answer: 'No hubo una caída de la cual recuperarse.', figures: [] },
    ]
  }
  const drawdown: DiagnosticAnswer = {
    id: 'worst_drawdown',
    question: q1,
    answer: `${pct(worst.depthPct)} desde el máximo del ${worst.peakDate} hasta el mínimo del ${worst.troughDate} (${days(worst.declineDays)} de caída), medido con el rendimiento ponderado por tiempo, sin que aportaciones ni retiros cuenten como pérdidas.`,
    figures: [
      { label: 'Profundidad', value: pct(worst.depthPct) },
      { label: 'Duración de la caída', value: days(worst.declineDays) },
      { label: 'Caídas registradas', value: String(analysis.episodes.length) },
    ],
  }
  const recovery: DiagnosticAnswer = worst.recovered
    ? {
        id: 'recovery',
        question: q2,
        answer: `${days(worst.recoveryDays ?? 0)}: el portafolio volvió al máximo previo el ${worst.recoveryDate}.` +
          (analysis.longestRecoveryDays !== null && analysis.longestRecoveryDays > (worst.recoveryDays ?? 0)
            ? ` La recuperación más larga del periodo tomó ${days(analysis.longestRecoveryDays)}.`
            : ''),
        figures: [
          { label: 'Recuperación de la peor caída', value: days(worst.recoveryDays ?? 0) },
          ...(analysis.longestRecoveryDays !== null ? [{ label: 'Recuperación más larga', value: days(analysis.longestRecoveryDays) }] : []),
        ],
      }
    : {
        id: 'recovery',
        question: q2,
        answer: `Todavía no se recupera: sigue ${pct(analysis.currentDrawdownPct)} por debajo del máximo del ${worst.peakDate} y necesita ${signedPct(analysis.recoveryRequiredPct)} para volver a él.`,
        figures: [
          { label: 'Caída actual', value: pct(analysis.currentDrawdownPct) },
          { label: 'Subida necesaria', value: signedPct(analysis.recoveryRequiredPct) },
        ],
      }
  return [drawdown, recovery]
}

function riskLevers(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Qué cambiaría el riesgo del portafolio?'
  const { holdings, cov } = input
  if (!holdings || !cov || holdings.length < 2 || cov.length !== holdings.length) return missing('risk_levers', question, NO_RISK)
  const w = holdings.map((h) => h.weight)
  const sigma = portfolioVolatility(w, cov)
  if (sigma === null || !(sigma > 0)) return missing('risk_levers', question, NO_RISK)

  // Marginal contribution: how much volatility moves per unit of extra weight.
  const marginal = cov.map((row) => row.reduce((s, c, j) => s + c * w[j], 0) / sigma)
  const byMarginal = holdings.map((h, i) => ({ ...h, marginal: marginal[i], i })).sort((a, b) => b.marginal - a.marginal)
  const from = byMarginal.find((h) => h.weight > 0) ?? byMarginal[0]
  const to = byMarginal[byMarginal.length - 1]
  if (from.symbol === to.symbol) return missing('risk_levers', question, NO_RISK)

  const shift = Math.min(LEVER_SHIFT_PP / 100, w[from.i])
  const shifted = [...w]
  shifted[from.i] -= shift
  shifted[to.i] += shift
  const after = portfolioVolatility(shifted, cov)

  // The same book without its largest source of risk, its weight spread pro rata.
  const top = input.riskSources?.byAsset[0]
  const topIndex = top ? holdings.findIndex((h) => h.symbol === top.symbol) : -1
  let without: number | null = null
  if (topIndex >= 0 && w[topIndex] < 1) {
    const rest = 1 - w[topIndex]
    without = portfolioVolatility(w.map((x, i) => (i === topIndex ? 0 : x / rest)), cov)
  }

  const figures: DiagnosticFigure[] = [
    { label: 'Volatilidad actual', value: pct(sigma * 100) },
    { label: `${(shift * 100).toFixed(0)} puntos de ${from.symbol} a ${to.symbol}`, value: after === null ? '—' : pct(after * 100) },
  ]
  if (without !== null && top) figures.push({ label: `Sin ${top.symbol}, repartido entre el resto`, value: pct(without * 100) })

  return {
    id: 'risk_levers',
    question,
    answer:
      `El peso que más mueve el riesgo es el de ${from.symbol} y el que menos, el de ${to.symbol}. ` +
      (after !== null
        ? `Pasar ${(shift * 100).toFixed(0)} puntos del primero al segundo llevaría la volatilidad de ${pct(sigma * 100)} a ${pct(after * 100)}`
        : '') +
      (without !== null && top ? `; sin ${top.symbol}, repartiendo su peso entre el resto, quedaría en ${pct(without * 100)}.` : '.') +
      ' Son sensibilidades con la covarianza del periodo, no sugerencias.',
    figures,
  }
}

/** Below this turnover, the weights have barely drifted. */
const NEGLIGIBLE_TURNOVER_PP = 1

function rebalance(input: DiagnosticInput): DiagnosticAnswer {
  const question = '¿Qué ocurre si rebalanceo?'
  const { holdings, cov, growth } = input
  if (!holdings || !cov || !growth || holdings.length < 2 || growth.length !== holdings.length) {
    return missing('rebalance', question, NO_RISK)
  }
  if (!growth.every((g) => Number.isFinite(g) && g > 0)) return missing('rebalance', question, 'Falta el precio inicial de alguna posición.')

  // The weights today's quantities had at the start of the window: undoing
  // exactly the drift that prices caused since then. These are not the weights
  // the owner held then — positions opened later did not exist — which is why
  // the answer speaks of undoing price drift, not of returning to a past book.
  const w = holdings.map((h) => h.weight)
  const raw = w.map((x, i) => x / growth[i])
  const total = raw.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return missing('rebalance', question, NO_RISK)
  const start = raw.map((x) => x / total)

  const turnoverPp = (w.reduce((s, x, i) => s + Math.abs(x - start[i]), 0) / 2) * 100
  const before = portfolioVolatility(w, cov)
  const after = portfolioVolatility(start, cov)
  const drift = holdings
    .map((h, i) => ({ symbol: h.symbol, deltaPp: (w[i] - start[i]) * 100 }))
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
  const largest = drift[0]
  const since = input.windowStart ?? 'el inicio del periodo'

  if (turnoverPp < NEGLIGIBLE_TURNOVER_PP) {
    return {
      id: 'rebalance',
      question,
      answer: `Casi nada: con tus cantidades actuales, los precios apenas movieron los pesos desde ${since} (rotación de ${turnoverPp.toFixed(1)} puntos).`,
      figures: [{ label: 'Rotación necesaria', value: `${turnoverPp.toFixed(1)} pp` }],
    }
  }

  return {
    id: 'rebalance',
    question,
    answer:
      `Deshacer lo que los precios movieron desde ${since}, con tus cantidades actuales, rotaría ${turnoverPp.toFixed(1)} puntos del portafolio; el mayor desvío es ${largest.symbol} (${largest.deltaPp > 0 ? '+' : ''}${largest.deltaPp.toFixed(1)} puntos ${largest.deltaPp > 0 ? 'por encima' : 'por debajo'} de su peso de entonces)` +
      (before !== null && after !== null ? ` y la volatilidad pasaría de ${pct(before * 100)} a ${pct(after * 100)}.` : '.') +
      ' No incluye comisiones ni impuestos, y nada se ejecuta desde aquí.',
    figures: [
      { label: 'Rotación necesaria', value: `${turnoverPp.toFixed(1)} pp` },
      ...drift.slice(0, 4).map((d) => ({ label: `Desvío de ${d.symbol}`, value: `${d.deltaPp > 0 ? '+' : ''}${d.deltaPp.toFixed(1)} pp` })),
      ...(before !== null && after !== null ? [{ label: 'Volatilidad actual → rebalanceada', value: `${pct(before * 100)} → ${pct(after * 100)}` }] : []),
    ],
  }
}

// ─── The diagnostic ─────────────────────────────────────────────────────────

export function diagnosePortfolio(input: DiagnosticInput): PortfolioDiagnostic {
  const [worstDrawdown, recovery] = drawdownAnswers(input)
  const answers = [
    riskConcentration(input),
    topReturn(input),
    topRisk(input),
    sectorOverexposure(input),
    vsBenchmark(input),
    worstDrawdown,
    recovery,
    riskLevers(input),
    rebalance(input),
  ]
  return { answers, answered: answers.filter((a) => a.answer !== null).length, caveat: DIAGNOSTIC_CAVEAT }
}

/**
 * Percentage price return of a close series between two dates, each taken as
 * the last close on or before it. Null when either end has no close.
 */
export function closeReturn(closes: Record<string, number>, from: string, to: string): number | null {
  const dates = Object.keys(closes).sort()
  const onOrBefore = (date: string) => {
    let found: string | null = null
    for (const d of dates) {
      if (d <= date) found = d
      else break
    }
    return found === null ? null : closes[found]
  }
  const start = onOrBefore(from)
  const end = onOrBefore(to)
  if (start === null || end === null || !(start > 0) || !Number.isFinite(end)) return null
  return (end / start - 1) * 100
}
