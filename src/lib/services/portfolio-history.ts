import {
  addQuantity,
  subtractQuantity,
  multiplyQuantity,
  isDustRemainder,
} from '@/lib/utils/quantity'

type HistoryTransaction = {
  executed_at: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  symbol: string
  quantity: number
  price: number
  /** The currency `price` was recorded in. Absent in callers that predate it. */
  currency?: string
}

export type DailySnapshot = {
  date: string // YYYY-MM-DD
  positions: Record<string, number> // symbol -> quantity
}

export function computeDailyPositions(transactions: HistoryTransaction[]): DailySnapshot[] {
  if (transactions.length === 0) return []

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  )

  const snapshots: DailySnapshot[] = []
  const currentPositions: Record<string, number> = {}

  for (const txn of sorted) {
    const date = txn.executed_at.slice(0, 10)

    switch (txn.type) {
      case 'buy':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) + txn.quantity
        break
      case 'sell':
        currentPositions[txn.symbol] = Math.max(0, (currentPositions[txn.symbol] || 0) - txn.quantity)
        break
      case 'split':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) * txn.quantity
        break
      case 'dividend':
        break
    }

    const existing = snapshots.find(s => s.date === date)
    if (existing) {
      existing.positions = { ...currentPositions }
    } else {
      snapshots.push({ date, positions: { ...currentPositions } })
    }
  }

  return snapshots
}

/**
 * The dates the chart has something to say about: those any holding actually
 * printed a close on, plus the last day of the window.
 *
 * The timeline used to walk every calendar day and carry the last close across
 * the ones the market was shut. Roughly two points in seven were that carry,
 * drawn as a flat step: a month showed nine of them and a week two, so the line
 * read as a staircase of pauses the portfolio never took. Those days hold no
 * information — the value did not stay the same, it was simply not observed.
 *
 * `endDate` is always kept, session or not: the right edge of the chart is
 * today, whether or not today has closed.
 */
function sessionDates(
  historicalPrices: Record<string, Record<string, number>>,
  startDate: string,
  endDate: string,
): string[] {
  const dates = new Set<string>()
  for (const prices of Object.values(historicalPrices)) {
    for (const date of Object.keys(prices)) {
      if (date >= startDate && date <= endDate) dates.add(date)
    }
  }
  if (dates.size === 0) return []
  dates.add(endDate)
  if (startDate <= endDate) dates.add(startDate)
  return [...dates].sort()
}

/** Every calendar day in the window — the fallback when no close is known at all. */
function calendarDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

export function buildDailyTimeline(
  snapshots: DailySnapshot[],
  historicalPrices: Record<string, Record<string, number>>,
  endDate: string,
  transactionPrices?: Record<string, number>
): Array<{ date: string; value: number }> {
  if (snapshots.length === 0) return []

  const startDate = snapshots[0].date
  const timeline: Array<{ date: string; value: number }> = []
  let currentPositions: Record<string, number> = {}
  const lastGoodPrice: Record<string, number> = {}

  // A book priced only from its execution prices — nothing stored, no provider
  // that quotes it — has no sessions to plot, and still deserves a line.
  const observed = sessionDates(historicalPrices, startDate, endDate)
  const dates = observed.length > 0 ? observed : calendarDates(startDate, endDate)

  let snapshotIdx = 0

  for (const dateStr of dates) {
    while (snapshotIdx < snapshots.length && snapshots[snapshotIdx].date <= dateStr) {
      currentPositions = { ...snapshots[snapshotIdx].positions }
      snapshotIdx++
    }

    let value = 0
    for (const [symbol, quantity] of Object.entries(currentPositions)) {
      if (quantity <= 0) continue
      const symbolPrices = historicalPrices[symbol] || {}
      let price = symbolPrices[dateStr] ?? findLastKnownPrice(symbolPrices, dateStr)
      if (!price && lastGoodPrice[symbol]) {
        price = lastGoodPrice[symbol]
      }
      if (!price && transactionPrices?.[symbol]) {
        price = transactionPrices[symbol]
      }
      if (price) lastGoodPrice[symbol] = price
      value += quantity * (price || 0)
    }

    timeline.push({ date: dateStr, value })
  }

  return timeline
}

/** Days a portfolio's first snapshot may start after the window does: a weekend, or a missed run. */
const SNAPSHOT_START_SLACK_DAYS = 3

/**
 * Whether stored nightly snapshots can draw the value chart for a window on
 * their own: every portfolio needs a snapshot within a few days of the window's
 * start. Counting rows was not enough — two portfolios reach seven rows in four
 * nights, and the chart would have begun wherever snapshots began instead of
 * where the range the reader picked begins.
 */
export function snapshotsCoverWindow(
  rows: Array<{ portfolio_id: string; snapshot_date: string }>,
  portfolioIds: string[],
  cutoff: string,
): boolean {
  if (portfolioIds.length === 0) return false
  const latestStart = new Date(`${cutoff}T00:00:00Z`)
  latestStart.setUTCDate(latestStart.getUTCDate() + SNAPSHOT_START_SLACK_DAYS)
  const limit = latestStart.toISOString().slice(0, 10)

  const firstDate = new Map<string, string>()
  for (const row of rows) {
    if (row.snapshot_date < cutoff) continue
    const first = firstDate.get(row.portfolio_id)
    if (!first || row.snapshot_date < first) firstDate.set(row.portfolio_id, row.snapshot_date)
  }
  return portfolioIds.every((id) => {
    const first = firstDate.get(id)
    return first !== undefined && first <= limit
  })
}

const CURRENCY_CODE = /^[A-Z]{3}$/

/**
 * The currency the value chart is drawn in: the one the reader is looking at.
 *
 * The screen says which (`requested`, from the display-currency selector),
 * because the chart sits under a header already converted to it and the two
 * must be the same unit. Without it, the saved preference; without that, the
 * book's own currency. The route used to look the preference up by a column
 * profiles does not have, so it always fell through to the book's currency and
 * drew pesos under a header in dollars.
 */
export function chartCurrency(
  requested: string | null | undefined,
  savedPreference: string | null | undefined,
  bookCurrency: string | null | undefined,
): string {
  const asked = requested?.trim().toUpperCase()
  if (asked && CURRENCY_CODE.test(asked)) return asked
  return String(savedPreference || bookCurrency || 'USD').toUpperCase()
}

/**
 * Whether stored snapshots can be summed into a chart in `currency` as they are.
 *
 * Each snapshot is valued in its own portfolio's base currency (migration 024).
 * Adding them up is only a sum in one unit when every portfolio shares that
 * currency and it is the one the chart is drawn in; otherwise the book is
 * rebuilt and converted date by date instead.
 */
export function snapshotsInCurrency(portfolios: Array<{ base_currency?: string | null }>, currency: string): boolean {
  return portfolios.length > 0 && portfolios.every((p) => String(p.base_currency ?? 'USD').toUpperCase() === currency)
}

function findLastKnownPrice(prices: Record<string, number>, targetDate: string): number {
  const dates = Object.keys(prices).filter(d => d <= targetDate).sort()
  return dates.length > 0 ? prices[dates[dates.length - 1]] : 0
}

// ─── Book history for the time-weighted return ──────────────────────────────

export type BookTransaction = HistoryTransaction

/** symbol -> date (YYYY-MM-DD) -> close. Raw closes, not split-adjusted. */
export type PriceMap = Record<string, Record<string, number>>

export type BookHistory = {
  /** The book's value on each trading date, BEFORE that date's trades. */
  snapshots: Array<{ date: string; value: number }>
  /** Buys positive, sales negative, valued at the snapshot's close. */
  flows: Array<{ date: string; amount: number }>
  /**
   * The same snapshots split by holding: each symbol's value on each date,
   * before that date's trades (P2-4). Values sum to `snapshots[i].value`.
   */
  symbolSnapshots: Array<{ date: string; values: Record<string, number> }>
  /** The same flows split by holding. Amounts sum, per date, to `flows`. */
  symbolFlows: Array<{ date: string; symbol: string; amount: number }>
}

/** Last close on or before `date`, by binary search over ascending dates. */
function closeOnOrBefore(dates: string[], closes: Record<string, number>, date: string): number | null {
  let lo = 0
  let hi = dates.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] <= date) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found >= 0 ? closes[dates[found]] : null
}

/**
 * The snapshots and flows calculateTWR needs, rebuilt from the transactions.
 *
 * The returns route used to value every historical date at TODAY'S holdings
 * while the flows recorded when those holdings were actually bought, and passed
 * buys with XIRR's sign (negative) to a function that expects deposits
 * positive. The opening capital of the first purchase went negative and the TWR
 * came back null. This follows calculateTWR's own convention instead:
 *
 *   A snapshot on date D is the book BEFORE D's trades, valued at D's close.
 *   A trade dated D is a flow into the period that opens at snapshot D.
 *   Splits are not trades: they take effect before D is valued, because D's
 *   close is already the post-split price.
 *
 * Flows are valued at the same close the snapshots use, not at the price the
 * trade executed at. With execution prices, a full sale at 125 on a day that
 * closed at 118 leaves -70 of "opening capital" for a period that ends at 0,
 * and the chain collapses to null or -100%. At the close, a purchase adds
 * exactly what it adds to the next snapshot, so buying more is never mistaken
 * for performance; the gap between execution and close is slippage, which a
 * time-weighted return of the holdings deliberately leaves out.
 *
 * Transactions must be in the order they happened; ties on the same date keep
 * their input order. Quantities use the fixed-precision helpers and the same
 * dust rule as recalculatePosition.
 */
export function reconstructBookHistory(
  transactions: BookTransaction[],
  prices: PriceMap,
  options: { from?: string } = {},
): BookHistory {
  if (transactions.length === 0) return { snapshots: [], flows: [], symbolSnapshots: [], symbolFlows: [] }

  const txns = transactions
    .map((txn, index) => ({ ...txn, date: txn.executed_at.slice(0, 10), index }))
    .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date < b.date ? -1 : 1))

  const symbols = [...new Set(txns.map((txn) => txn.symbol))]
  const priceDates: Record<string, string[]> = {}
  for (const symbol of symbols) priceDates[symbol] = Object.keys(prices[symbol] ?? {}).sort()

  const firstTrade = txns[0].date
  const start = options.from && options.from > firstTrade ? options.from : firstTrade
  const valuationDates = [...new Set(symbols.flatMap((symbol) => priceDates[symbol]))]
    .filter((date) => date >= start)
    .sort()
  if (valuationDates.length === 0) return { snapshots: [], flows: [], symbolSnapshots: [], symbolFlows: [] }

  const holdings: Record<string, number> = {}
  const lastTradePrice: Record<string, number> = {}

  const priceOn = (symbol: string, date: string): number => {
    const close = closeOnOrBefore(priceDates[symbol], prices[symbol] ?? {}, date)
    if (close !== null && Number.isFinite(close) && close > 0) return close
    return lastTradePrice[symbol] ?? 0
  }

  const valuesBySymbol = (date: string): Record<string, number> => {
    const values: Record<string, number> = {}
    for (const [symbol, quantity] of Object.entries(holdings)) {
      if (quantity > 0) values[symbol] = quantity * priceOn(symbol, date)
    }
    return values
  }

  const snapshots: BookHistory['snapshots'] = []
  const flows: BookHistory['flows'] = []
  const symbolSnapshots: BookHistory['symbolSnapshots'] = []
  const symbolFlows: BookHistory['symbolFlows'] = []
  const recordFlowFor = (date: string, symbol: string, amount: number) => {
    flows.push({ date, amount })
    symbolFlows.push({ date, symbol, amount })
  }

  let next = 0
  // Trades dated before the first valuation build the opening holdings. Their
  // flows precede the first snapshot, where calculateTWR would ignore them.
  const apply = (txn: (typeof txns)[number], recordFlow: boolean) => {
    const held = holdings[txn.symbol] ?? 0
    if (txn.price > 0) lastTradePrice[txn.symbol] = txn.price
    switch (txn.type) {
      case 'buy': {
        holdings[txn.symbol] = addQuantity(held, txn.quantity)
        if (recordFlow) recordFlowFor(txn.date, txn.symbol, txn.quantity * priceOn(txn.symbol, txn.date))
        break
      }
      case 'sell': {
        const sold = Math.min(txn.quantity, held)
        let remaining = Math.max(0, subtractQuantity(held, sold))
        if (isDustRemainder(remaining, txn.price)) remaining = 0
        holdings[txn.symbol] = remaining
        const removed = held - remaining
        if (recordFlow && removed > 0) {
          recordFlowFor(txn.date, txn.symbol, -removed * priceOn(txn.symbol, txn.date))
        }
        break
      }
      case 'split':
        if (txn.quantity > 0) holdings[txn.symbol] = multiplyQuantity(held, txn.quantity)
        break
      case 'dividend':
        break
    }
  }

  // Trades before the first valuation date build the opening holdings. Any flow
  // among them precedes the first snapshot, where calculateTWR ignores it.
  while (next < txns.length && txns[next].date < valuationDates[0]) {
    apply(txns[next], txns[next].date >= start)
    next++
  }

  for (let d = 0; d < valuationDates.length; d++) {
    const date = valuationDates[d]
    const following = valuationDates[d + 1]

    // Splits dated today take effect before today is valued.
    for (let k = next; k < txns.length && txns[k].date === date; k++) {
      if (txns[k].type === 'split') apply(txns[k], false)
    }

    const values = valuesBySymbol(date)
    snapshots.push({ date, value: Object.values(values).reduce((sum, v) => sum + v, 0) })
    symbolSnapshots.push({ date, values })

    // Then today's trades, and those on any non-trading days before the next
    // valuation, all flowing into the period that opens here.
    while (next < txns.length && (following === undefined ? txns[next].date <= date : txns[next].date < following)) {
      const txn = txns[next]
      if (!(txn.type === 'split' && txn.date === date)) apply(txn, true)
      next++
    }
  }

  return { snapshots, flows, symbolSnapshots, symbolFlows }
}
