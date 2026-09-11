// Per-asset performance and risk — pure functions, no I/O.
//
// Everything here composes engines that already exist: volatility, Sharpe,
// beta/alpha, drawdown episodes and tail risk are imported, not reimplemented.
// The two things this file genuinely adds are the multi-horizon return table and
// a Sortino ratio that refuses to invent a number when there is no downside.

import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateDailyReturns,
  calculateBetaAlpha,
} from './analytics'
import { analyseDrawdowns } from './drawdown'
import { analyseTailRisk } from './var'
import type { PriceBar } from './stress-testing'

const TRADING_DAYS = 252

/** Below this, a history cannot support a risk statement worth printing. */
const MIN_RISK_OBSERVATIONS = 20

/** A Sortino ratio needs enough observations for a downside deviation to mean anything. */
const MIN_SORTINO_OBSERVATIONS = 10

export type HorizonId = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y'

export type Horizon = {
  id: HorizonId
  label: string
  /** Calendar days back from the latest bar. Null for YTD, which is anchored. */
  days: number | null
  /** Windows longer than a year also get an annualised figure. */
  years: number | null
}

export const HORIZONS: Horizon[] = [
  { id: '1D', label: '1 dia', days: 1, years: null },
  { id: '1W', label: '1 semana', days: 7, years: null },
  { id: '1M', label: '1 mes', days: 30, years: null },
  { id: '3M', label: '3 meses', days: 91, years: null },
  { id: '6M', label: '6 meses', days: 182, years: null },
  { id: 'YTD', label: 'En el ano', days: null, years: null },
  { id: '1Y', label: '1 ano', days: 365, years: null },
  { id: '3Y', label: '3 anos', days: 1095, years: 3 },
  { id: '5Y', label: '5 anos', days: 1825, years: 5 },
]

/** How much later than the target date a starting bar may be and still count. */
const MAX_ANCHOR_LAG_DAYS = 7

export type HorizonReturn = {
  id: HorizonId
  label: string
  returnPct: number | null
  /** Compound annual rate, for windows longer than a year. */
  annualisedPct: number | null
  fromDate: string | null
  toDate: string | null
}

function sorted(bars: PriceBar[]): PriceBar[] {
  return bars
    .filter((bar) => Number.isFinite(bar.close))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The last bar on or before `target`, or null if the history starts after it. */
function barAtOrBefore(bars: PriceBar[], target: string): PriceBar | null {
  let found: PriceBar | null = null
  for (const bar of bars) {
    if (bar.date <= target) found = bar
    else break
  }
  return found
}

function shiftDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() - days)
  return cursor.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`)
  const to = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY
  return Math.abs(to - from) / 86_400_000
}

/**
 * Return over each standard window, ending at the most recent bar.
 *
 * A window the history does not reach back to returns null rather than falling
 * back to "since inception". A five-year number computed from eight months of
 * data is not a five-year number, and a reader comparing two assets would have
 * no way to tell that one of the two columns means something different.
 *
 * The one-day figure uses the previous BAR, not the previous calendar day, so a
 * Monday reads against Friday instead of against nothing.
 */
export function multiHorizonReturns(bars: PriceBar[]): HorizonReturn[] {
  const series = sorted(bars)

  const empty = (horizon: Horizon): HorizonReturn => ({
    id: horizon.id,
    label: horizon.label,
    returnPct: null,
    annualisedPct: null,
    fromDate: null,
    toDate: null,
  })

  if (series.length < 2) return HORIZONS.map(empty)

  const latest = series[series.length - 1]

  return HORIZONS.map((horizon) => {
    let start: PriceBar | null = null

    if (horizon.id === '1D') {
      start = series[series.length - 2]
    } else if (horizon.id === 'YTD') {
      // The last close of the previous year is the anchor, not the first close
      // of this one: the year's first move happens between those two bars.
      const yearStart = `${latest.date.slice(0, 4)}-01-01`
      start = barAtOrBefore(series, yearStart)
      if (start && start.date >= yearStart) start = null
    } else if (horizon.days !== null) {
      const target = shiftDays(latest.date, horizon.days)
      const candidate = barAtOrBefore(series, target)
      // Only accept an anchor close to the target. Falling back to the oldest
      // bar available is how a short history quietly becomes a long-horizon claim.
      start =
        candidate && daysBetween(candidate.date, target) <= MAX_ANCHOR_LAG_DAYS
          ? candidate
          : null
    }

    if (!start || !(start.close > 0) || start.date === latest.date) return empty(horizon)

    const returnPct = ((latest.close - start.close) / start.close) * 100
    if (!Number.isFinite(returnPct)) return empty(horizon)

    let annualisedPct: number | null = null
    if (horizon.years !== null) {
      const growth = latest.close / start.close
      const annual = growth > 0 ? (Math.pow(growth, 1 / horizon.years) - 1) * 100 : null
      annualisedPct = annual !== null && Number.isFinite(annual) ? annual : null
    }

    return {
      id: horizon.id,
      label: horizon.label,
      returnPct,
      annualisedPct,
      fromDate: start.date,
      toDate: latest.date,
    }
  })
}

/**
 * Sortino ratio: like Sharpe, but only losses count as risk.
 *
 * The single implementation for the whole app. Three existed before this, and
 * two of them were wrong in the same way: they took the standard deviation of
 * the negative returns ABOUT THEIR OWN MEAN, which measures how spread out the
 * losses are rather than how large they are. A series of steady -2% days has
 * almost no spread, so that formula reported it as having no downside risk.
 *
 * This is the Sortino & Price (1994) definition: the root mean square of the
 * shortfall below the target, averaged over ALL observations, not just the
 * negative ones. Dividing by the count of losses instead inflates the deviation
 * for a series that rarely loses, which understates exactly the portfolios the
 * ratio is meant to reward.
 *
 * Null when the series never fell. That case has no downside deviation and
 * therefore no ratio; the risk endpoint used to answer 3 or 0 depending on the
 * sign of the return, and neither was a number anyone computed.
 */
export function calculateSortinoRatio(returns: number[], riskFreeRate: number): number | null {
  if (returns.length < MIN_SORTINO_OBSERVATIONS) return null
  if (!returns.every(Number.isFinite)) return null
  if (!Number.isFinite(riskFreeRate)) return null

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualisedReturn = mean * TRADING_DAYS

  // Target is zero: "risk" here means losing money, not underperforming a rate.
  let shortfall = 0
  for (const r of returns) if (r < 0) shortfall += r * r
  if (shortfall === 0) return null

  const downsideDeviation = Math.sqrt(shortfall / returns.length) * Math.sqrt(TRADING_DAYS)
  if (!(downsideDeviation > 0)) return null

  const ratio = (annualisedReturn - riskFreeRate) / downsideDeviation
  return Number.isFinite(ratio) ? ratio : null
}

export type AssetRiskMetrics = {
  observations: number
  volatilityPct: number
  sharpe: number
  sortino: number | null
  beta: number | null
  alphaPct: number | null
  maxDrawdownPct: number
  currentDrawdownPct: number
  var95Pct: number | null
  cvar95Pct: number | null
}

/**
 * The risk half of an asset page, composed from the engines that already exist.
 *
 * Beta is null rather than 1 when there is no comparable benchmark series. A
 * default of 1 is a claim — "this moves exactly with the market" — and it is
 * the single most common way a missing input gets rendered as a finding.
 */
export function assetRiskMetrics(
  bars: PriceBar[],
  benchmarkBars: PriceBar[],
  riskFreeRate: number,
): AssetRiskMetrics | null {
  const series = sorted(bars)
  if (series.length < MIN_RISK_OBSERVATIONS) return null

  const returns = calculateDailyReturns(series.map((bar) => bar.close))
  if (returns.length < MIN_RISK_OBSERVATIONS - 1) return null

  // Beta needs the two series on the same days, not merely the same length.
  const benchmarkByDate = new Map(sorted(benchmarkBars).map((bar) => [bar.date, bar.close]))
  const shared = series.filter((bar) => benchmarkByDate.has(bar.date))
  let beta: number | null = null
  let alphaPct: number | null = null

  if (shared.length >= MIN_RISK_OBSERVATIONS) {
    const own = calculateDailyReturns(shared.map((bar) => bar.close))
    const against = calculateDailyReturns(shared.map((bar) => benchmarkByDate.get(bar.date)!))
    const stats = calculateBetaAlpha(own, against, riskFreeRate)
    if (stats && Number.isFinite(stats.beta)) {
      beta = stats.beta
      alphaPct = Number.isFinite(stats.alpha) ? stats.alpha : null
    }
  }

  const drawdowns = analyseDrawdowns(
    series.map((bar) => ({ date: bar.date, value: bar.close })),
  )
  const tail = analyseTailRisk(returns, 95)

  const metrics: AssetRiskMetrics = {
    observations: returns.length,
    volatilityPct: calculateVolatility(returns) * 100,
    sharpe: calculateSharpeRatio(returns, riskFreeRate),
    sortino: calculateSortinoRatio(returns, riskFreeRate),
    beta,
    alphaPct,
    maxDrawdownPct: drawdowns.maxDrawdownPct,
    currentDrawdownPct: drawdowns.currentDrawdownPct,
    var95Pct: tail?.historicalPct ?? null,
    cvar95Pct: tail?.conditionalPct ?? null,
  }

  const finite =
    Number.isFinite(metrics.volatilityPct) &&
    Number.isFinite(metrics.sharpe) &&
    Number.isFinite(metrics.maxDrawdownPct) &&
    Number.isFinite(metrics.currentDrawdownPct)

  return finite ? metrics : null
}
