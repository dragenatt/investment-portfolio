// Aligning holdings onto the dates they all share — pure, no I/O.
//
// Anything that compares allocations of the same book (the efficient frontier,
// the allocation strategies, the scenario comparison) needs the holdings'
// returns on identical dates. Optimising or simulating across assets observed
// on different days would compare their behaviour on days some of them were
// not being watched.
//
// This used to live inline in the optimization route. The scenario comparison
// (E2) needs exactly the same preparation, so it lives here once.

import { calculateDailyReturns } from './analytics'

export type HoldingQuantity = { symbol: string; quantity: number }
export type PriceRow = { symbol: string; date: string; close: number }

export type CommonHistory = {
  /** Holdings that have a price series, in position order. */
  symbols: string[]
  commonDates: string[]
  /** One daily return series per symbol, all the same length. */
  returnsMatrix: number[][]
  /** Market-value weights at the last common date, or undefined if the book is worth nothing. */
  currentWeights: number[] | undefined
  /** Quantity times close on the last common date, summed over the priced holdings. */
  bookValue: number
  lastDate: string
}

export type AlignOptions = {
  /** Fewest daily returns worth estimating a covariance from. */
  minObservations: number
}

export function alignCommonHistory(
  positions: HoldingQuantity[],
  history: PriceRow[],
  options: AlignOptions,
): CommonHistory | { message: string } {
  // One holding has no allocation problem to solve.
  if (positions.length < 2) {
    return { message: 'Se necesitan al menos dos posiciones para comparar asignaciones.' }
  }

  const bySymbol = new Map<string, Map<string, number>>()
  for (const row of history) {
    let closes = bySymbol.get(row.symbol)
    if (!closes) {
      closes = new Map<string, number>()
      bySymbol.set(row.symbol, closes)
    }
    closes.set(row.date, row.close)
  }

  const priced = positions.filter((p) => (bySymbol.get(p.symbol)?.size ?? 0) > 0)
  if (priced.length < 2) {
    return { message: 'No hay suficiente historial de precios para estas posiciones.' }
  }

  const allDates = [...new Set(history.map((h) => h.date))].sort()
  const commonDates = allDates.filter((d) => priced.every((p) => bySymbol.get(p.symbol)!.has(d)))

  if (commonDates.length < options.minObservations + 1) {
    return {
      message: `Se necesitan al menos ${options.minObservations} días de historial común; hay ${Math.max(0, commonDates.length - 1)}.`,
    }
  }

  const returnsMatrix = priced.map((p) =>
    calculateDailyReturns(commonDates.map((d) => bySymbol.get(p.symbol)!.get(d)!)),
  )

  const lastDate = commonDates[commonDates.length - 1]
  const marketValues = priced.map((p) => p.quantity * (bySymbol.get(p.symbol)!.get(lastDate) ?? 0))
  const bookValue = marketValues.reduce((a, b) => a + b, 0)

  return {
    symbols: priced.map((p) => p.symbol),
    commonDates,
    returnsMatrix,
    currentWeights: bookValue > 0 ? marketValues.map((v) => v / bookValue) : undefined,
    bookValue,
    lastDate,
  }
}
