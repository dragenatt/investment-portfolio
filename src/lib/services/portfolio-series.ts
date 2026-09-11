// The portfolio's value over time — a pure function, no I/O.
//
// ── Why this is its own module ──────────────────────────────────────────────
//
// Three routes built this series inline, each with the same shape: walk the
// price rows, multiply by quantity, add it to a map keyed by date. That shape
// has a hole in it, and the hole is the point of this file.
//
// If a date is missing a price for ONE holding, summing whatever happened to be
// present makes the book appear to lose that position for a day and get it back
// the next. On a real portfolio that produced a -60% day followed by a +150%
// day, out of nothing. Two such dates in a hundred and thirty took a genuine
// 18% annual volatility and reported 178%, with a Sortino of 24.7.
//
// Nothing downstream could detect it: the values are all positive, the dates are
// all real, and the drawdown series looked fine because the crater healed the
// next day. It only showed up as a number too absurd to be true.
//
// So the rule is the one the covariance path already followed: a date counts
// only when EVERY holding has a price on it. Dates that do not are dropped and
// counted, so the caller can say how much was skipped rather than quietly
// measuring a different history than it claims.

export type PricedRow = { symbol: string; date: string; close: number }

export type Holding = { symbol: string; quantity: number }

export type PortfolioSeries = {
  dates: string[]
  values: number[]
  /** Dates skipped because at least one holding had no price. */
  droppedDates: string[]
  /** Holdings with no price data anywhere; excluded rather than fatal. */
  excludedSymbols: string[]
}

/** Below this there is no series: returns need a previous bar. */
const MIN_DATES = 2

/**
 * Value of the book on each date every holding can be priced on.
 *
 * Returns null when there is nothing to measure. A holding the provider knows
 * nothing about is excluded and named rather than emptying the whole series —
 * one unknown ticker should not blank the risk tab — but a date missing a price
 * for a holding that otherwise HAS data is dropped, because that is a gap in the
 * series rather than a gap in the book.
 */
export function portfolioValueSeries(
  rows: PricedRow[],
  holdings: Holding[],
): PortfolioSeries | null {
  if (holdings.length === 0 || rows.length === 0) return null

  const wanted = new Map<string, number>()
  for (const holding of holdings) {
    if (Number.isFinite(holding.quantity)) wanted.set(holding.symbol, holding.quantity)
  }
  if (wanted.size === 0) return null

  // symbol -> date -> close, keeping only usable prices.
  const bySymbol = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (!wanted.has(row.symbol)) continue
    if (!Number.isFinite(row.close)) continue

    let dates = bySymbol.get(row.symbol)
    if (!dates) {
      dates = new Map<string, number>()
      bySymbol.set(row.symbol, dates)
    }
    dates.set(row.date, row.close)
  }

  const priced = [...wanted.keys()].filter((symbol) => (bySymbol.get(symbol)?.size ?? 0) > 0)
  const excludedSymbols = [...wanted.keys()].filter((symbol) => !priced.includes(symbol))
  if (priced.length === 0) return null

  const allDates = [...new Set(rows.map((row) => row.date))].sort()

  const dates: string[] = []
  const values: number[] = []
  const droppedDates: string[] = []

  for (const date of allDates) {
    // Every priced holding, or the date does not count. This is the whole fix.
    const complete = priced.every((symbol) => bySymbol.get(symbol)!.has(date))
    if (!complete) {
      droppedDates.push(date)
      continue
    }

    let total = 0
    for (const symbol of priced) {
      total += wanted.get(symbol)! * bySymbol.get(symbol)!.get(date)!
    }
    if (!Number.isFinite(total)) {
      droppedDates.push(date)
      continue
    }

    dates.push(date)
    values.push(total)
  }

  if (dates.length < MIN_DATES) return null

  return { dates, values, droppedDates, excludedSymbols }
}
