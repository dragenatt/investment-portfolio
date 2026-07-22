// Daily P&L calculations — pure functions, no I/O, fully unit-testable.
//
// The "daily change" of a position is measured against a fixed daily baseline
// (the previous close, regularMarketPreviousClose) rather than a snapshot taken
// at an arbitrary time. This makes the number reflect the real market move of the
// day and stay identical for every user. See migration 011_daily_baselines.

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
  const change = (currentPrice - previousClose) * quantity
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
  let change = 0
  let baseValue = 0
  for (const it of items) {
    if (it.previousClose != null && it.previousClose > 0 && Number.isFinite(it.currentPrice)) {
      change += (it.currentPrice - it.previousClose) * it.quantity
      baseValue += it.previousClose * it.quantity
    }
  }
  const changePct = baseValue > 0 ? (change / baseValue) * 100 : 0
  return { change, changePct }
}
