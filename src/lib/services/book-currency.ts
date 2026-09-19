// A book's transactions and closes in one currency — pure, no I/O.
//
// Returns are ratios, and a ratio of two amounts in different units is not a
// return. The returns route compared the book's value — units × a DOLLAR close
// — with what was paid for it — units × a PESO price — and reported a book
// that had moved a fraction of a percent as down 94%. The time-weighted chain
// broke the same way: a purchase entered at its peso price, the next day's
// book was valued in dollars.
//
// Everything is brought into the portfolio's base currency first: each close
// at its own date's rate, each transaction price at the rate of the day it was
// executed. A figure whose rate is unknown stays as it was and is NAMED in
// `unconverted`, rather than silently mixed in or dropped.

import type { BookTransaction, PriceMap } from './portfolio-history'
import type { Conversion } from './fx'

export type BookInBase<T extends BookTransaction> = {
  transactions: T[]
  prices: PriceMap
  unconverted: string[]
}

export function bookInBase<T extends BookTransaction>(
  transactions: T[],
  prices: PriceMap,
  conversion: Pick<Conversion, 'factor' | 'unknownCurrency' | 'missingRate'>,
  cashFactor: (currency: string, date: string) => number | null,
): BookInBase<T> {
  const unconverted = new Set<string>()

  const converted: PriceMap = {}
  for (const [symbol, closes] of Object.entries(prices)) {
    converted[symbol] = {}
    for (const [date, close] of Object.entries(closes)) converted[symbol][date] = close * conversion.factor(symbol, date)
    if (conversion.unknownCurrency.includes(symbol) || conversion.missingRate.includes(symbol)) unconverted.add(symbol)
  }

  const txns = transactions.map((txn) => {
    // A split's "price" is not money, and a transaction without a currency has
    // nothing to convert from.
    if (txn.type === 'split' || !txn.currency) return txn
    const factor = cashFactor(txn.currency, txn.executed_at.slice(0, 10))
    if (factor === null) {
      unconverted.add(txn.symbol)
      return txn
    }
    return { ...txn, price: txn.price * factor }
  })

  return { transactions: txns, prices: converted, unconverted: [...unconverted] }
}
