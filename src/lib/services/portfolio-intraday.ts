// The portfolio's value DURING a session, not at its close.
//
// "1D" and "1W" are the two ranges a daily close cannot draw. The value chart
// was built from daily bars for every range, so picking 1D asked for a window
// of one calendar day and got what that window holds: two closes, drawn as one
// straight segment between two dots. 1W got eight, two of them weekend repeats.
// Neither showed the movement the reader pressed the button to see.
//
// The providers already return intraday bars for those ranges — 5 minutes for a
// day, 15 for a week — and the route was collapsing every one of them onto its
// calendar date and keeping the last. This module uses them as they arrive.

import type { DailySnapshot } from './portfolio-history'

/** One intraday bar: an ISO instant and the price printed at it. */
export type IntradayBar = { time: string; close: number }

export type IntradayPoint = { date: string; value: number }

export type IntradayInputs = {
  /** Holdings as they changed, ascending by date (computeDailyPositions). */
  snapshots: DailySnapshot[]
  /** symbol -> bars, any order; sorted here. */
  bars: Record<string, IntradayBar[]>
  /** symbol -> the close of the session before the window, when it is known. */
  previousCloses?: Record<string, number>
  /** symbol -> the price it last traded at, the last resort the daily chart also uses. */
  transactionPrices?: Record<string, number>
}

/**
 * What a symbol is worth at an instant.
 *
 * The bars of one symbol are a step function: between two prints, the holding
 * is worth the earlier print. A market that has closed for the day — Tokyo, at
 * any hour a New York session is open — holds its last print rather than
 * disappearing, which is what it is in fact worth.
 *
 * Before a symbol's first bar of the window the previous session's close is the
 * honest answer, and when even that is unknown the first bar is carried
 * backwards: a months-old execution price would draw a jump at the open that
 * never happened. The execution price stays as the last resort, for a holding
 * no provider quotes at all, exactly as in buildDailyTimeline.
 */
function priceAt(
  sorted: IntradayBar[],
  index: number,
  previousClose: number | undefined,
  transactionPrice: number | undefined,
): number {
  if (index >= 0) return sorted[index].close
  if (previousClose !== undefined && previousClose > 0) return previousClose
  if (sorted.length > 0) return sorted[0].close
  if (transactionPrice !== undefined && transactionPrice > 0) return transactionPrice
  return 0
}

/**
 * The portfolio's value at every instant any holding printed a price.
 *
 * The time grid is the union of the bars' own timestamps, never a synthetic
 * one: every point on the line is an instant at which something really traded,
 * so nothing is interpolated into existence. Holdings are those of the
 * timestamp's calendar date, so a purchase made during the window steps the
 * line up on the day it happened — the same convention, and the same caveat,
 * as the daily chart.
 *
 * Returns points with an ISO instant as `date`; the daily chart's points carry
 * a YYYY-MM-DD, and the reader of both must not assume either.
 */
export function buildIntradayTimeline({
  snapshots,
  bars,
  previousCloses = {},
  transactionPrices = {},
}: IntradayInputs): IntradayPoint[] {
  const sorted: Record<string, IntradayBar[]> = {}
  for (const [symbol, list] of Object.entries(bars)) {
    const clean = list.filter((b) => Number.isFinite(b.close) && b.close > 0)
    if (clean.length > 0) sorted[symbol] = [...clean].sort((a, b) => a.time.localeCompare(b.time))
  }

  const grid = [...new Set(Object.values(sorted).flatMap((list) => list.map((b) => b.time)))].sort()
  if (grid.length === 0 || snapshots.length === 0) return []

  // One cursor per symbol, walked forward with the grid: the bars and the grid
  // are both ascending, so the whole series costs one pass instead of a binary
  // search per symbol per point.
  const cursor: Record<string, number> = {}
  for (const symbol of Object.keys(sorted)) cursor[symbol] = -1

  const points: IntradayPoint[] = []
  let positions: Record<string, number> = {}
  let snapshotIdx = 0

  for (const time of grid) {
    const date = time.slice(0, 10)
    while (snapshotIdx < snapshots.length && snapshots[snapshotIdx].date <= date) {
      positions = { ...snapshots[snapshotIdx].positions }
      snapshotIdx++
    }

    for (const [symbol, list] of Object.entries(sorted)) {
      let i = cursor[symbol]
      while (i + 1 < list.length && list[i + 1].time <= time) i++
      cursor[symbol] = i
    }

    // Nothing held yet at this instant is not a portfolio worth zero, it is a
    // portfolio that does not exist. Drawing it would open the line at the
    // bottom of the axis and call the first purchase an infinite gain.
    const held = Object.entries(positions).filter(([, quantity]) => quantity > 0)
    if (held.length === 0) continue

    let value = 0
    for (const [symbol, quantity] of held) {
      value += quantity * priceAt(sorted[symbol] ?? [], cursor[symbol] ?? -1, previousCloses[symbol], transactionPrices[symbol])
    }
    points.push({ date: time, value })
  }

  return points
}

/**
 * Whether an intraday series is worth drawing.
 *
 * A single bar is a dot, not a line, and two bars from one symbol out of twenty
 * holdings is a straight segment that says nothing about the day. Below this
 * the caller falls back to the daily series, which at least covers the book.
 */
export const MIN_INTRADAY_POINTS = 4
