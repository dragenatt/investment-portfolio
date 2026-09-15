// Contribution over time (P2-4). Pure: no I/O.
//
// "How did each holding's contribution to my return change — by day, week,
// month, quarter, year?"
//
// One sub-period runs from snapshot t to snapshot t+1, with the same convention
// as calculateTWR (returns.ts): a snapshot is the book before that day's
// trades, and a trade dated D is capital that lands at the start of the period
// opening at D. For a holding s:
//
//   opening_s = value_s(t) + flows_s in [t, t+1)
//   gain_s    = value_s(t+1) − opening_s
//
// and for the book R = Σ gain_s / Σ opening_s. A holding's contribution is
// gain_s / Σ opening_s, so the contributions add up to R exactly and money added
// by a purchase never counts as performance.
//
// Contributions from several sub-periods do not add up to the compounded
// return of the bucket that contains them. They are linked with Carino's
// logarithmic smoothing — Carino, D. (1999), "Combining Attribution Effects
// Over Time", Journal of Performance Measurement 3(4) — which scales each
// sub-period's contributions by k_t = ln(1+R_t)/R_t over K = ln(1+R)/R. After
// linking, a bucket's contributions add up to its compounded return, with no
// residual left over to explain.
//
// Dividends are not in the book history, so this is price contribution, exactly
// like the time-weighted return it decomposes.

import type { BookHistory } from '@/lib/services/portfolio-history'

export const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const
export type Granularity = (typeof GRANULARITIES)[number]

export function isGranularity(value: unknown): value is Granularity {
  return typeof value === 'string' && (GRANULARITIES as readonly string[]).includes(value)
}

/** Same threshold as calculateTWR: below this a book is empty, not tiny. */
const EMPTY_BOOK = 0.005

export type SubPeriod = {
  start: string
  end: string
  /** Book return over the sub-period, as a fraction. */
  portfolioReturn: number
  /** Contribution of each holding, as a fraction of the opening book. Sums to portfolioReturn. */
  contributions: Record<string, number>
  /** Each holding's share of the opening book. */
  weights: Record<string, number>
  /** Each holding's own return over the sub-period, when it opened with capital. */
  assetReturns: Record<string, number>
}

export type SubPeriodResult = {
  periods: SubPeriod[]
  /** Sub-periods that opened from nothing but ended with value: no return exists for them. */
  unmeasurable: number
}

/** Per-holding contributions for each snapshot-to-snapshot sub-period. */
export function subPeriodContributions(history: Pick<BookHistory, 'symbolSnapshots' | 'symbolFlows'>): SubPeriodResult {
  const snaps = [...history.symbolSnapshots].sort((a, b) => a.date.localeCompare(b.date))
  const periods: SubPeriod[] = []
  let unmeasurable = 0

  let flowIndex = 0
  const flows = [...history.symbolFlows].sort((a, b) => a.date.localeCompare(b.date))
  // Flows before the first snapshot built the opening holdings; they are not
  // capital injected into any measured period.
  while (flowIndex < flows.length && snaps.length > 0 && flows[flowIndex].date < snaps[0].date) flowIndex++

  for (let i = 1; i < snaps.length; i++) {
    const start = snaps[i - 1].date
    const end = snaps[i].date

    const opening: Record<string, number> = { ...snaps[i - 1].values }
    while (flowIndex < flows.length && flows[flowIndex].date < end) {
      const flow = flows[flowIndex]
      if (flow.date >= start) opening[flow.symbol] = (opening[flow.symbol] ?? 0) + flow.amount
      flowIndex++
    }
    const closing = snaps[i].values

    const symbols = new Set([...Object.keys(opening), ...Object.keys(closing)])
    let totalOpening = 0
    let totalClosing = 0
    for (const s of symbols) {
      totalOpening += opening[s] ?? 0
      totalClosing += closing[s] ?? 0
    }

    // Days between selling everything and buying back in: nothing to measure.
    if (Math.abs(totalOpening) < EMPTY_BOOK && Math.abs(totalClosing) < EMPTY_BOOK) continue
    if (totalOpening <= 0) {
      unmeasurable++
      continue
    }

    const contributions: Record<string, number> = {}
    const weights: Record<string, number> = {}
    const assetReturns: Record<string, number> = {}
    for (const s of symbols) {
      const open = opening[s] ?? 0
      const close = closing[s] ?? 0
      if (Math.abs(open) < EMPTY_BOOK && Math.abs(close) < EMPTY_BOOK) continue
      contributions[s] = (close - open) / totalOpening
      weights[s] = open / totalOpening
      if (open > EMPTY_BOOK) assetReturns[s] = close / open - 1
    }

    periods.push({ start, end, portfolioReturn: totalClosing / totalOpening - 1, contributions, weights, assetReturns })
  }

  return { periods, unmeasurable }
}

// ─── Buckets ────────────────────────────────────────────────────────────────

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** ISO-8601 week: weeks start on Monday, week 1 contains the year's first Thursday. */
function isoWeek(date: string): { year: number; week: number } {
  const d = new Date(`${date}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7 // Monday 0
  d.setUTCDate(d.getUTCDate() - day + 3) // Thursday of this week
  const year = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return { year, week }
}

/**
 * The bucket a sub-period belongs to, by the day it ENDS: the gain from Friday's
 * close to Monday's close is Monday's, and belongs to Monday's week and month.
 */
export function bucketOf(date: string, granularity: Granularity): { key: string; label: string } {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  switch (granularity) {
    case 'day':
      return { key: date, label: `${Number(date.slice(8, 10))} ${MONTHS_ES[month - 1]} ${year}` }
    case 'week': {
      const { year: wy, week } = isoWeek(date)
      const key = `${wy}-W${String(week).padStart(2, '0')}`
      return { key, label: `Semana ${week} de ${wy}` }
    }
    case 'month':
      return { key: date.slice(0, 7), label: `${MONTHS_ES[month - 1]} ${year}` }
    case 'quarter': {
      const quarter = Math.ceil(month / 3)
      return { key: `${year}-Q${quarter}`, label: `T${quarter} ${year}` }
    }
    case 'year':
      return { key: String(year), label: String(year) }
  }
}

export type HoldingContribution = {
  symbol: string
  /** Linked contribution to the bucket's return, in percentage points. */
  contributionPct: number
  /** The holding's own compounded return over the sub-periods it held capital, in %; null if it never did. */
  assetReturnPct: number | null
  /** Average share of the opening book across the bucket's sub-periods, in %. */
  averageWeightPct: number
}

export type AttributionBucket = {
  key: string
  label: string
  start: string
  end: string
  subPeriods: number
  /** Compounded book return over the bucket, in %. */
  portfolioReturnPct: number
  /** Largest contribution first. Sums to portfolioReturnPct. */
  holdings: HoldingContribution[]
}

/** k = ln(1+r)/r, and 1 at r = 0 (its limit). */
function carinoFactor(r: number): number | null {
  if (1 + r <= 0) return null
  return Math.abs(r) < 1e-12 ? 1 : Math.log(1 + r) / r
}

/** Link sub-periods into one bucket. Null when a sub-period lost everything (Carino is undefined there). */
export function linkSubPeriods(periods: SubPeriod[]): Omit<AttributionBucket, 'key' | 'label'> | null {
  if (periods.length === 0) return null

  let growth = 1
  for (const p of periods) growth *= 1 + p.portfolioReturn
  const total = growth - 1
  const K = carinoFactor(total)
  if (K === null) return null

  const linked: Record<string, number> = {}
  const assetGrowth: Record<string, number> = {}
  const weightSum: Record<string, number> = {}
  for (const p of periods) {
    const k = carinoFactor(p.portfolioReturn)
    if (k === null) return null
    for (const [symbol, c] of Object.entries(p.contributions)) {
      linked[symbol] = (linked[symbol] ?? 0) + (c * k) / K
    }
    for (const [symbol, w] of Object.entries(p.weights)) weightSum[symbol] = (weightSum[symbol] ?? 0) + w
    for (const [symbol, r] of Object.entries(p.assetReturns)) assetGrowth[symbol] = (assetGrowth[symbol] ?? 1) * (1 + r)
  }

  const holdings = Object.keys(linked)
    .map((symbol) => ({
      symbol,
      contributionPct: linked[symbol] * 100,
      assetReturnPct: assetGrowth[symbol] !== undefined ? (assetGrowth[symbol] - 1) * 100 : null,
      averageWeightPct: ((weightSum[symbol] ?? 0) / periods.length) * 100,
    }))
    .sort((a, b) => b.contributionPct - a.contributionPct)

  return {
    start: periods[0].start,
    end: periods[periods.length - 1].end,
    subPeriods: periods.length,
    portfolioReturnPct: total * 100,
    holdings,
  }
}

export type TemporalAttribution = {
  granularity: Granularity
  buckets: AttributionBucket[]
  /** The whole window linked into one: its return is the window's time-weighted return. */
  total: Omit<AttributionBucket, 'key' | 'label'> | null
  unmeasurable: number
  /** Buckets dropped because a sub-period in them lost 100% (no linking exists). */
  unlinkable: number
}

/** Hard cap so a daily view of a long window stays renderable. */
export const MAX_BUCKETS = 400

export function temporalAttribution(
  history: Pick<BookHistory, 'symbolSnapshots' | 'symbolFlows'>,
  granularity: Granularity,
): TemporalAttribution {
  const { periods, unmeasurable } = subPeriodContributions(history)

  const grouped = new Map<string, { label: string; periods: SubPeriod[] }>()
  for (const period of periods) {
    const { key, label } = bucketOf(period.end, granularity)
    const group = grouped.get(key) ?? { label, periods: [] }
    group.periods.push(period)
    grouped.set(key, group)
  }

  const buckets: AttributionBucket[] = []
  let unlinkable = 0
  for (const [key, group] of grouped) {
    const linked = linkSubPeriods(group.periods)
    if (!linked) {
      unlinkable++
      continue
    }
    buckets.push({ key, label: group.label, ...linked })
  }

  return {
    granularity,
    buckets: buckets.slice(-MAX_BUCKETS),
    total: linkSubPeriods(periods),
    unmeasurable,
    unlinkable,
  }
}
