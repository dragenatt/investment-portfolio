// Per-asset performance and risk — pure functions, no I/O.
//
// Everything here composes engines that already exist: volatility, Sharpe,
// beta/alpha, drawdown episodes and tail risk are imported, not reimplemented.
// The two things this file genuinely adds are the multi-horizon return table and
// a Sortino ratio that refuses to invent a number when there is no downside.

import {
  calculateVolatility,
  calculateDailyReturns,
  calculateBetaAlpha,
} from './analytics'
import { analyseDrawdowns } from './drawdown'
import { analyseTailRisk } from './var'
import type { PriceBar } from './stress-testing'

const TRADING_DAYS = 252

// ── Bar cadence ─────────────────────────────────────────────────────────────
//
// Nothing here may assume the bars are daily. The provider chain returns
// MONTHLY bars for any range long enough to reach five years, and this file
// originally annualised everything with sqrt(252) regardless — which rendered
// the S&P 500 at 70.7% annual volatility and a Sharpe of 3.34, because
// sqrt(252) on monthly returns inflates by sqrt(252/12) = sqrt(21).
//
// The same trap is documented in the stress-testing route, and this file walked
// into it anyway. Every test fixture was daily, so nothing caught it.

export type Cadence = {
  /** Median days between consecutive bars. */
  daysPerBar: number
  /** What to annualise by: 252 daily, 52 weekly, 12 monthly. */
  periodsPerYear: number
  /** For labelling a VaR, which is per-bar and not per-day unless it is. */
  label: string
}

/** Bars this far apart or closer are daily; real daily data has weekend gaps. */
const DAILY_MAX_SPACING = 4
const WEEKLY_MAX_SPACING = 10

/** The cadence of a series, or null when there are too few bars to tell. */
export function detectCadence(bars: PriceBar[]): Cadence | null {
  const series = sorted(bars)
  if (series.length < 2) return null

  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const gap = daysBetween(series[i - 1].date, series[i].date)
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return null

  // Median, not mean: a single long gap (a delisting, a data outage) must not
  // reclassify a daily series as weekly.
  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  const daysPerBar =
    gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle]

  if (daysPerBar <= DAILY_MAX_SPACING) {
    return { daysPerBar, periodsPerYear: 252, label: '1 dia' }
  }
  if (daysPerBar <= WEEKLY_MAX_SPACING) {
    return { daysPerBar, periodsPerYear: 52, label: '1 semana' }
  }
  return { daysPerBar, periodsPerYear: 12, label: '1 mes' }
}

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

/**
 * How far a starting bar may sit from the target date and still anchor a window.
 *
 * Scaled to the series' own cadence. A fixed 7 days rejected every monthly bar,
 * so five years of data reported n/d for every horizon from 1M up — the data was
 * there and the gate would not let it through.
 */
const MIN_ANCHOR_LAG_DAYS = 7
const ANCHOR_LAG_BARS = 1.5

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

/** The first bar on or after `target`, or null if the history ends before it. */
function barAtOrAfter(bars: PriceBar[], target: string): PriceBar | null {
  for (const bar of bars) if (bar.date >= target) return bar
  return null
}

/**
 * The bar closest to `target`, looking BOTH ways, within `tolerance` days.
 *
 * Looking only backwards left a real gap: five years back from 2026-09-11 is
 * 2021-09-11, the earliest monthly bar was 2021-10-01, and the window reported
 * n/d over a twenty-day shortfall — well inside the tolerance monthly data
 * needs. The tolerance still does the refusing; it just gets to see both
 * candidates now.
 */
function nearestBar(bars: PriceBar[], target: string, tolerance: number): PriceBar | null {
  const before = barAtOrBefore(bars, target)
  const after = barAtOrAfter(bars, target)

  const candidates = [before, after].filter((bar): bar is PriceBar => bar !== null)
  if (candidates.length === 0) return null

  const best = candidates.reduce((closest, bar) =>
    daysBetween(bar.date, target) < daysBetween(closest.date, target) ? bar : closest,
  )

  return daysBetween(best.date, target) <= tolerance ? best : null
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

  const cadence = detectCadence(series)
  const daysPerBar = cadence?.daysPerBar ?? 1
  const tolerance = Math.max(MIN_ANCHOR_LAG_DAYS, daysPerBar * ANCHOR_LAG_BARS)

  const latest = series[series.length - 1]

  return HORIZONS.map((horizon) => {
    let start: PriceBar | null = null

    // A horizon shorter than the data's own resolution cannot be measured.
    // Monthly bars answering "1 day" with the last bar's change is not a
    // one-day move — it is a month wearing the wrong label, which is exactly
    // what shipped: 1D and 1W both read +1.0% and both were ~10-day moves.
    if (horizon.days !== null && horizon.days < daysPerBar) return empty(horizon)

    if (horizon.id === '1D') {
      start = series[series.length - 2]
    } else if (horizon.id === 'YTD') {
      // The last close of the PREVIOUS year is the anchor, not the first close
      // of this one: the year's first move happens between those two bars.
      //
      // A monthly series has a bar dated exactly 1 January, and the first
      // version found it, saw it was not in the previous year, and gave up —
      // reporting n/d for a year of data it was holding. Step back one bar
      // instead of surrendering.
      const yearStart = `${latest.date.slice(0, 4)}-01-01`
      const index = series.findIndex((bar) => bar.date >= yearStart)
      start = index > 0 ? series[index - 1] : null
    } else if (horizon.days !== null) {
      // Only accept an anchor close to the target. Falling back to the oldest
      // bar available is how a short history quietly becomes a long-horizon claim.
      start = nearestBar(series, shiftDays(latest.date, horizon.days), tolerance)
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
export function calculateSortinoRatio(
  returns: number[],
  riskFreeRate: number,
  periodsPerYear: number = TRADING_DAYS,
): number | null {
  if (returns.length < MIN_SORTINO_OBSERVATIONS) return null
  if (!returns.every(Number.isFinite)) return null
  if (!Number.isFinite(riskFreeRate)) return null
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) return null

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualisedReturn = mean * periodsPerYear

  // Target is zero: "risk" here means losing money, not underperforming a rate.
  let shortfall = 0
  for (const r of returns) if (r < 0) shortfall += r * r
  if (shortfall === 0) return null

  const downsideDeviation = Math.sqrt(shortfall / returns.length) * Math.sqrt(periodsPerYear)
  if (!(downsideDeviation > 0)) return null

  const ratio = (annualisedReturn - riskFreeRate) / downsideDeviation
  return Number.isFinite(ratio) ? ratio : null
}

export type AssetRiskMetrics = {
  observations: number
  /** What the bars actually are. VaR and CVaR are per-bar, not per-day. */
  cadence: Cadence
  /**
   * The window these numbers were measured over.
   *
   * Carried here because the caller reaches further back for the horizon table
   * than for risk, and quoting one window beside the other's observation count
   * describes two different histories in one sentence.
   */
  fromDate: string
  toDate: string
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

  // Everything below annualises by this, never by a hardcoded 252.
  const cadence = detectCadence(series)
  if (!cadence) return null
  const { periodsPerYear } = cadence

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

  // calculateVolatility and calculateSharpeRatio both annualise by 252
  // internally, which is right for daily bars and wrong for anything else.
  // Rescaling by sqrt(periodsPerYear / 252) converts without reimplementing
  // either — the roadmap forbids a second copy of this arithmetic.
  const scale = Math.sqrt(periodsPerYear / TRADING_DAYS)
  const volatility = calculateVolatility(returns) * scale

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualisedReturn = meanReturn * periodsPerYear
  const sharpe =
    volatility > 1e-10 ? (annualisedReturn - riskFreeRate) / volatility : 0

  const metrics: AssetRiskMetrics = {
    observations: returns.length,
    cadence,
    fromDate: series[0].date,
    toDate: series[series.length - 1].date,
    volatilityPct: volatility * 100,
    sharpe,
    sortino: calculateSortinoRatio(returns, riskFreeRate, periodsPerYear),
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

/**
 * Combine horizons measured on two series of different cadence.
 *
 * The daily series answers the short windows precisely; the monthly one reaches
 * back years. Neither can do both, so each horizon takes the finest answer
 * available rather than one series being chosen for all of them.
 */
export function mergeHorizons(
  fine: HorizonReturn[],
  coarse: HorizonReturn[] | null,
): HorizonReturn[] {
  if (!coarse) return fine

  return HORIZONS.map((horizon) => {
    const preferred = fine.find((r) => r.id === horizon.id)
    if (preferred && preferred.returnPct !== null) return preferred

    const fallback = coarse.find((r) => r.id === horizon.id)
    if (fallback && fallback.returnPct !== null) return fallback

    return (
      preferred ??
      fallback ?? {
        id: horizon.id,
        label: horizon.label,
        returnPct: null,
        annualisedPct: null,
        fromDate: null,
        toDate: null,
      }
    )
  })
}
