// Daily P&L calculations — pure functions, no I/O, fully unit-testable.
//
// The "daily change" of a position is measured against a fixed daily baseline
// (the previous close, regularMarketPreviousClose) rather than a snapshot taken
// at an arbitrary time. This makes the number reflect the real market move of the
// day and stay identical for every user. See migration 011_daily_baselines.

import { fromCents, roundMoney, toCents } from '@/lib/utils/money'

export type DailyChange = { change: number; changePct: number }

/**
 * Daily change for a single position, anchored to its previous close.
 * Returns a zero change when no valid baseline is available (never throws).
 */
export function positionDailyChange(
  quantity: number,
  currentPrice: number,
  previousClose: number | null | undefined,
): DailyChange {
  if (previousClose == null || previousClose <= 0 || !Number.isFinite(currentPrice)) {
    return { change: 0, changePct: 0 }
  }
  const change = roundMoney((currentPrice - previousClose) * quantity)
  const changePct = ((currentPrice - previousClose) / previousClose) * 100
  return { change, changePct }
}

/**
 * The day's move in money for a holding worth `value` today, from the quote's
 * percentage move.
 *
 * The percentage is measured against the previous close, so the money it
 * stands for is a share of YESTERDAY's value: value − value / (1 + pct/100).
 * The screens that had only the percentage multiplied it by today's value
 * instead, which scales the move by today's price over yesterday's — a 2.00
 * gain on a +2% day shown as 2.04, and a loss understated the same way.
 *
 * Works in whatever currency `value` is in, so a caller can convert first.
 * A move of −100% or worse has no previous value to recover and returns zero.
 */
export function dailyChangeFromPct(value: number, changePct: number | null | undefined): number {
  if (changePct == null || !Number.isFinite(changePct) || !Number.isFinite(value) || changePct <= -100) return 0
  return value - value / (1 + changePct / 100)
}

/**
 * Aggregate daily change across positions. The percentage is weighted by the
 * baseline market value (Σ qty·previousClose), i.e. how much the whole book moved
 * today. Positions without a baseline are excluded from both numerator and
 * denominator so they don't distort the percentage.
 */
export function aggregateDailyChange(
  items: Array<{ quantity: number; currentPrice: number; previousClose: number | null | undefined }>,
): DailyChange {
  let changeCents = 0
  let baseValue = 0
  for (const it of items) {
    if (it.previousClose != null && it.previousClose > 0 && Number.isFinite(it.currentPrice)) {
      // Accumulate in integer cents: summing floats over a long book drifts.
      changeCents += toCents((it.currentPrice - it.previousClose) * it.quantity)
      baseValue += it.previousClose * it.quantity
    }
  }
  const change = fromCents(changeCents)
  const changePct = baseValue > 0 ? (change / baseValue) * 100 : 0
  return { change, changePct }
}

export type PositionValuation = {
  marketValue: number
  costBasis: number
  pnlAbsolute: number
  pnlPercent: number
}

/**
 * Value a single position against its average cost. Market value and cost basis
 * are money and settle on whole cents; the percentage is a ratio of the two and
 * is left unrounded for the caller to format.
 */
export function positionValuation(
  quantity: number,
  currentPrice: number,
  avgCost: number,
): PositionValuation {
  const marketCents = toCents(quantity * currentPrice)
  const costCents = toCents(quantity * avgCost)
  const pnlCents = marketCents - costCents
  return {
    marketValue: fromCents(marketCents),
    costBasis: fromCents(costCents),
    pnlAbsolute: fromCents(pnlCents),
    pnlPercent: costCents > 0 ? (pnlCents / costCents) * 100 : 0,
  }
}

/** A holding as the book records it: two amounts, not always one currency. */
export type PositionInBook = {
  quantity: number
  /** The average cost, in the currency the purchases were recorded in. */
  avgCost: number
  costCurrency: string
  /** The latest quote, in the currency the asset TRADES in. */
  currentPrice: number
  priceCurrency: string
}

export type DisplayedPosition = PositionValuation & {
  avgCost: number
  currentPrice: number
  /** The single currency every amount above is expressed in. */
  currency: string
}

/**
 * One holding, every amount in the display currency.
 *
 * A position has two currencies and they are routinely different: VOO trades
 * in dollars and was bought with pesos. A row on screen has one — the table
 * formats the cost, the price, the market value and the P&L with a single
 * currency field — so the conversion has to happen before the row is built,
 * not at render time.
 *
 * The portfolio detail page used to skip this, pass both raw amounts and
 * label the row with the PRICE currency. Two things went wrong at once: the
 * P&L compared a dollar price against a peso cost, and the renderer then
 * converted the peso cost again as though it were dollars. Every position in
 * a peso book holding dollar assets read as a 94% loss with an average cost
 * seventeen times too high, while the header above it said +0.64%.
 */
export function positionInDisplayCurrency(
  position: PositionInBook,
  toDisplay: (amount: number, from: string) => number,
  displayCurrency: string,
): DisplayedPosition {
  const avgCost = toDisplay(position.avgCost, position.costCurrency)
  const currentPrice = toDisplay(position.currentPrice, position.priceCurrency)
  return {
    ...positionValuation(position.quantity, currentPrice, avgCost),
    avgCost,
    currentPrice,
    currency: displayCurrency,
  }
}
