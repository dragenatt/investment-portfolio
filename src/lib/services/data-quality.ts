// Market data quality — pure functions, no I/O.
//
// Every risk number in the app is only as good as the price series underneath
// it, and a bad series does not announce itself: a missing week quietly shrinks
// volatility, an unadjusted split shows up as a -75% day, a stale feed reports a
// flat line as zero risk. This module inspects a series before anyone measures
// anything on it and returns a score plus the specific problems it found.
//
// It is deliberately advisory: nothing here blocks a calculation. The score and
// its issues are surfaced so a reader can weigh a metric, not silently discard
// it. See docs/DATA_QUALITY.md.

import { classifyJumps } from './corporate-actions'

export type PriceBar = {
  date: string // YYYY-MM-DD
  close: number | null
  volume?: number | null
}

export type DataQualityCode =
  | 'no-data'
  | 'missing-close'
  | 'non-positive-close'
  | 'duplicate-date'
  | 'calendar-gap'
  | 'extreme-move'
  | 'suspected-split'
  | 'stale'
  | 'short-history'
  | 'flat-line'

export type DataQualitySeverity = 'info' | 'warning' | 'critical'

export type DataQualityIssue = {
  code: DataQualityCode
  severity: DataQualitySeverity
  /** Plain-language explanation, safe to show a reader. */
  message: string
  /** How many observations are affected. */
  count: number
  /** Points deducted from 100 for this issue. */
  penalty: number
  /** The first few offending dates, for a reader who wants to look. */
  samples: string[]
}

export type DataQualityGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'unusable'

export type DataQualityReport = {
  symbol: string
  /** 0-100. 100 means nothing suspicious was found. */
  score: number
  grade: DataQualityGrade
  observations: number
  from: string | null
  to: string | null
  issues: DataQualityIssue[]
}

export type AssessOptions = {
  /** Reference "today". Injected so reports are reproducible in tests and jobs. */
  asOf?: Date
  /** Trading days before a series is considered too short to measure risk on. */
  minObservations?: number
  /** Calendar days without a bar before it counts as a gap. */
  maxGapDays?: number
  /** Calendar days since the last bar before the series counts as stale. */
  maxStaleDays?: number
  /** Treat a series that never moves as suspicious. Off by default — some
   *  instruments genuinely do not trade every day. */
  requireMovement?: boolean
}

const DEFAULTS = {
  minObservations: 20,
  // Long weekends and market holidays routinely leave four calendar days between
  // bars; five is the first gap that cannot be explained that way.
  maxGapDays: 5,
  maxStaleDays: 7,
}

/** Matches the jump threshold corporate-actions.ts classifies on. */
const EXTREME_MOVE = 0.5

const MAX_SAMPLES = 5

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function isUsable(close: number | null | undefined): close is number {
  return typeof close === 'number' && Number.isFinite(close) && close > 0
}

function grade(score: number): DataQualityGrade {
  if (score >= 95) return 'excellent'
  if (score >= 80) return 'good'
  if (score >= 60) return 'fair'
  if (score > 0) return 'poor'
  return 'unusable'
}

/**
 * Score one symbol's price history from 0 to 100 and say what is wrong with it.
 *
 * Penalties are capped per issue so that one pervasive problem cannot mask
 * several distinct ones — a series with a hundred missing closes and an
 * unadjusted split should report both.
 */
export function assessPriceHistory(
  symbol: string,
  bars: PriceBar[],
  options: AssessOptions = {},
): DataQualityReport {
  const asOf = options.asOf ?? new Date()
  const minObservations = options.minObservations ?? DEFAULTS.minObservations
  const maxGapDays = options.maxGapDays ?? DEFAULTS.maxGapDays
  const maxStaleDays = options.maxStaleDays ?? DEFAULTS.maxStaleDays

  const issues: DataQualityIssue[] = []
  const add = (issue: DataQualityIssue) => issues.push(issue)

  if (bars.length === 0) {
    return {
      symbol,
      score: 0,
      grade: 'unusable',
      observations: 0,
      from: null,
      to: null,
      issues: [
        {
          code: 'no-data',
          severity: 'critical',
          message: 'No price history is available for this asset, so no metric can be computed.',
          count: 0,
          penalty: 100,
          samples: [],
        },
      ],
    }
  }

  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date))
  const from = sorted[0].date
  const to = sorted[sorted.length - 1].date

  // ── Missing and invalid closes ───────────────────────────────────────────
  const missing = sorted.filter((b) => b.close == null || !Number.isFinite(b.close))
  if (missing.length > 0) {
    add({
      code: 'missing-close',
      severity: missing.length > sorted.length * 0.1 ? 'critical' : 'warning',
      message: `${missing.length} of ${sorted.length} days have no closing price. Returns across those days cannot be measured and are skipped.`,
      count: missing.length,
      penalty: Math.min(30, 5 + missing.length),
      samples: missing.slice(0, MAX_SAMPLES).map((b) => b.date),
    })
  }

  const nonPositive = sorted.filter((b) => typeof b.close === 'number' && Number.isFinite(b.close) && b.close <= 0)
  if (nonPositive.length > 0) {
    add({
      code: 'non-positive-close',
      severity: 'critical',
      message: `${nonPositive.length} day(s) report a zero or negative price, which no traded asset can have. These are feed errors.`,
      count: nonPositive.length,
      penalty: Math.min(40, 15 + nonPositive.length * 5),
      samples: nonPositive.slice(0, MAX_SAMPLES).map((b) => b.date),
    })
  }

  // ── Duplicate dates ──────────────────────────────────────────────────────
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const bar of sorted) {
    if (seen.has(bar.date)) duplicates.push(bar.date)
    else seen.add(bar.date)
  }
  if (duplicates.length > 0) {
    add({
      code: 'duplicate-date',
      severity: 'warning',
      message: `${duplicates.length} date(s) appear more than once. Duplicated days double-count a return and inflate measured volatility.`,
      count: duplicates.length,
      penalty: Math.min(20, 5 + duplicates.length * 2),
      samples: duplicates.slice(0, MAX_SAMPLES),
    })
  }

  // ── Calendar gaps ────────────────────────────────────────────────────────
  const gaps: string[] = []
  let longestGap = 0
  for (let i = 1; i < sorted.length; i++) {
    const span = daysBetween(sorted[i - 1].date, sorted[i].date)
    if (span > maxGapDays) {
      gaps.push(`${sorted[i - 1].date} to ${sorted[i].date}`)
      longestGap = Math.max(longestGap, span)
    }
  }
  if (gaps.length > 0) {
    add({
      code: 'calendar-gap',
      severity: longestGap > 30 ? 'critical' : 'warning',
      message: `${gaps.length} gap(s) in the series, the longest ${longestGap} days. Missing stretches hide the moves that happened inside them.`,
      count: gaps.length,
      penalty: Math.min(25, 5 + gaps.length * 3),
      samples: gaps.slice(0, MAX_SAMPLES),
    })
  }

  // ── Extreme moves and unadjusted splits ──────────────────────────────────
  // Splits and bad prints are separated by corporate-actions.ts, which is the
  // module that also knows how to undo a split; keeping one classifier means the
  // report and the correction can never disagree about what happened.
  const usable = sorted.filter((b) => isUsable(b.close)) as Array<{ date: string; close: number }>
  const { splits, anomalies } = classifyJumps(sorted)
  const suspectedSplits = splits.map((s) => s.date)
  const extremeMoves = anomalies

  if (suspectedSplits.length > 0) {
    add({
      code: 'suspected-split',
      severity: 'critical',
      message: `${suspectedSplits.length} day(s) show a clean multiple-of-price jump that persists, which is the signature of a stock split the provider did not adjust for. Returns around those dates are wrong until adjusted prices are used.`,
      count: suspectedSplits.length,
      penalty: Math.min(35, 20 + suspectedSplits.length * 5),
      samples: suspectedSplits.slice(0, MAX_SAMPLES),
    })
  }

  if (extremeMoves.length > 0) {
    add({
      code: 'extreme-move',
      severity: 'warning',
      message: `${extremeMoves.length} day(s) move more than ${EXTREME_MOVE * 100}% and snap back, which usually means a bad print rather than a real market move.`,
      count: extremeMoves.length,
      penalty: Math.min(25, 5 + extremeMoves.length * 4),
      samples: extremeMoves.slice(0, MAX_SAMPLES),
    })
  }

  // ── Freshness ────────────────────────────────────────────────────────────
  const staleDays = daysBetween(to, asOf.toISOString().slice(0, 10))
  if (staleDays > maxStaleDays) {
    add({
      code: 'stale',
      severity: staleDays > 30 ? 'critical' : 'warning',
      message: `The most recent price is ${staleDays} days old (${to}). Anything measured from it describes the past, not today.`,
      count: staleDays,
      penalty: Math.min(35, 10 + Math.floor(staleDays / 7) * 5),
      samples: [to],
    })
  }

  // ── Depth ────────────────────────────────────────────────────────────────
  if (usable.length < minObservations) {
    add({
      code: 'short-history',
      severity: usable.length < 5 ? 'critical' : 'info',
      message: `Only ${usable.length} usable observation(s); at least ${minObservations} are needed before volatility or beta mean anything.`,
      count: usable.length,
      penalty: Math.min(30, (minObservations - usable.length) * 2),
      samples: [],
    })
  }

  // ── Flat line ────────────────────────────────────────────────────────────
  if (options.requireMovement && usable.length >= 5) {
    const first = usable[0].close
    if (usable.every((b) => b.close === first)) {
      add({
        code: 'flat-line',
        severity: 'critical',
        message: `The price never changes across ${usable.length} observations, which points to a stalled feed rather than a market with no risk.`,
        count: usable.length,
        penalty: 40,
        samples: [usable[0].date, usable[usable.length - 1].date],
      })
    }
  }

  const penalty = issues.reduce((sum, issue) => sum + issue.penalty, 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))

  return {
    symbol,
    score,
    grade: grade(score),
    observations: sorted.length,
    from,
    to,
    issues,
  }
}

/** Roll several per-symbol reports into the weakest link, for a portfolio view. */
export function worstReport(reports: DataQualityReport[]): DataQualityReport | null {
  if (reports.length === 0) return null
  return reports.reduce((worst, current) => (current.score < worst.score ? current : worst))
}
