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

export type PortfolioTotals = {
  totalValue: number
  totalCost: number
  totalReturn: number
  totalReturnPct: number
}

/**
 * Roll a book of positions up into portfolio totals. Each position is valued
 * once, in cents, and the cents are summed, so the total is the exact sum of
 * the per-position figures the user sees rather than a float that drifts a cent
 * away from them.
 */
export function aggregatePositionValues(
  positions: Array<{ quantity: number; currentPrice: number; avgCost: number }>,
): PortfolioTotals {
  let valueCents = 0
  let costCents = 0
  for (const pos of positions) {
    valueCents += toCents(pos.quantity * pos.currentPrice)
    costCents += toCents(pos.quantity * pos.avgCost)
  }
  const returnCents = valueCents - costCents
  return {
    totalValue: fromCents(valueCents),
    totalCost: fromCents(costCents),
    totalReturn: fromCents(returnCents),
    totalReturnPct: costCents > 0 ? (returnCents / costCents) * 100 : 0,
  }
}
