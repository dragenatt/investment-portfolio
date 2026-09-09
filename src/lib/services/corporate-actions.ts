// Corporate actions — pure functions, no I/O.
//
// A stock split is not a market move, but a raw price series cannot tell the
// difference: NVDA's 10:1 split in June 2024 reads as a -90% day, which then
// dominates volatility, ruins the Sharpe ratio, invents a max drawdown and
// miscalibrates every Monte Carlo drawn from those returns.
//
// Providers that publish an adjusted close have already solved this, and when
// one answers we use it. When none does — the app's price_history table stores
// raw OHLC — a split can still be undone from the raw series alone, because a
// split leaves a clean, persistent multiple-of-price step that a real market
// move does not. Dividends cannot: see the limitation note at the bottom.
//
// See docs/DATA_QUALITY.md.

export type RawBar = {
  date: string
  close: number | null
  /** Provider-supplied adjusted close, when the provider publishes one. */
  adjClose?: number | null
  [key: string]: unknown
}

export type AdjustedBar = RawBar & {
  /** The close a return series should be built from. Null when unusable. */
  adjustedClose: number | null
}

export type DetectedSplit = {
  date: string
  /** Old price over new price: 4 for a 4:1 split, 0.5 for a 1:2 reverse split. */
  ratio: number
}

export type AdjustmentResult = {
  bars: AdjustedBar[]
  splits: DetectedSplit[]
  /** Where the adjusted closes came from. */
  source: 'provider' | 'derived' | 'none'
}

/** A one-day move past this is either a corporate action or a data problem. */
const JUMP_THRESHOLD = 0.5

/**
 * Ratios a clean corporate action produces. Anything else of that size is a
 * crash or a bad print, and must not be silently "adjusted" away.
 *
 * Every entry moves the price by more than JUMP_THRESHOLD, which is what makes
 * it detectable at all. Small splits — 3:2, 5:4 — move the price by a third or
 * less and are indistinguishable from an ordinary bad day, so they are left out
 * rather than caught by lowering the threshold onto real crashes. Recovering
 * those needs a provider adjusted close.
 */
const SPLIT_RATIOS = [2, 3, 4, 5, 6, 8, 10, 20, 0.5, 1 / 3, 0.25, 0.2, 0.125, 0.1, 0.05]
const SPLIT_TOLERANCE = 0.02

function isUsable(close: number | null | undefined): close is number {
  return typeof close === 'number' && Number.isFinite(close) && close > 0
}

function nearestSplitRatio(ratio: number): number | null {
  for (const candidate of SPLIT_RATIOS) {
    if (Math.abs(ratio / candidate - 1) <= SPLIT_TOLERANCE) return candidate
  }
  return null
}

/**
 * Separate the large one-day jumps in a series into corporate actions and data
 * anomalies.
 *
 * The two look identical on the day itself and need opposite handling — a split
 * is real and the series is wrong, a bad print is noise and the day is wrong —
 * so they are told apart by what happens next. A split leaves the price at its
 * new level; a glitch snaps back. Only a jump that both persists and lands on a
 * recognised ratio is called a split.
 */
export function classifyJumps(bars: RawBar[]): { splits: DetectedSplit[]; anomalies: string[] } {
  const usable = bars
    .filter((b) => isUsable(b.close))
    .map((b) => ({ date: b.date, close: b.close as number }))

  const splits: DetectedSplit[] = []
  const anomalies: string[] = []
  let lastAnomaly = -1

  for (let i = 1; i < usable.length; i++) {
    const previous = usable[i - 1].close
    const current = usable[i].close
    if (Math.abs(current / previous - 1) < JUMP_THRESHOLD) continue

    // A single bad print makes two jumps: the drop and the bounce back. The
    // bounce persists and often lands on a clean ratio, so without this it gets
    // read as a split and the whole history is rescaled off one bad tick.
    const recoversPreviousAnomaly =
      lastAnomaly === i - 1 &&
      i >= 2 &&
      Math.abs(current / usable[i - 2].close - 1) < JUMP_THRESHOLD
    if (recoversPreviousAnomaly) continue

    const persists =
      i + 1 >= usable.length || Math.abs(usable[i + 1].close / current - 1) < JUMP_THRESHOLD
    const ratio = persists ? nearestSplitRatio(previous / current) : null

    if (ratio !== null) {
      splits.push({ date: usable[i].date, ratio })
    } else {
      anomalies.push(usable[i].date)
      lastAnomaly = i
    }
  }

  return { splits, anomalies }
}

/**
 * Produce the adjusted close each bar should be measured on.
 *
 * Prefers the provider's own adjusted series when there is one. Otherwise every
 * price before a detected split is divided by that split's ratio, compounding
 * backwards through multiple splits, so the newest price is left exactly as
 * quoted and the history is restated in today's share terms — the same
 * convention every data vendor uses.
 */
export function adjustForSplits(bars: RawBar[]): AdjustmentResult {
  if (bars.length === 0) return { bars: [], splits: [], source: 'none' }

  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date))

  const providerAdjusted = sorted.every((b) => isUsable(b.adjClose))
  if (providerAdjusted) {
    return {
      bars: sorted.map((b) => ({ ...b, adjustedClose: b.adjClose as number })),
      splits: [],
      source: 'provider',
    }
  }

  const { splits } = classifyJumps(sorted)
  if (splits.length === 0) {
    return {
      bars: sorted.map((b) => ({ ...b, adjustedClose: isUsable(b.close) ? b.close : null })),
      splits: [],
      source: 'derived',
    }
  }

  // Walk backwards so each older stretch carries the product of every split
  // that happened after it.
  const splitByDate = new Map(splits.map((s) => [s.date, s.ratio]))
  const factors = new Array<number>(sorted.length).fill(1)
  let cumulative = 1
  for (let i = sorted.length - 1; i >= 0; i--) {
    factors[i] = cumulative
    const ratio = splitByDate.get(sorted[i].date)
    if (ratio !== undefined) cumulative *= ratio
  }

  return {
    bars: sorted.map((bar, i) => ({
      ...bar,
      adjustedClose: isUsable(bar.close) ? bar.close / factors[i] : null,
    })),
    splits,
    source: 'derived',
  }
}

/**
 * The close series a return calculation should consume: split-adjusted, with
 * unusable observations dropped rather than emitted as NaN.
 *
 * Dropping rather than interpolating is deliberate. A gap makes the two prices
 * either side adjacent, which slightly overstates one day's move; interpolating
 * would invent a price that never traded and understate volatility across the
 * whole hole. The gap itself is reported separately by the data quality engine.
 */
export function returnBasisSeries(bars: RawBar[]): number[] {
  return adjustForSplits(bars)
    .bars.map((b) => b.adjustedClose)
    .filter((c): c is number => c !== null && Number.isFinite(c))
}

/**
 * Split-adjust a multi-symbol table of price rows, each symbol against its own
 * history. Rows whose price cannot be used are dropped rather than passed on as
 * a zero that would poison a return.
 *
 * Adjusting historical prices while valuing them at today's share count is the
 * right pairing: after a 4:1 split a holder owns four times the shares at a
 * quarter the price, so restating the old price in today's share terms keeps the
 * synthetic portfolio value continuous across the split.
 */
export function adjustSeriesBySymbol<T extends { symbol: string; date: string; close: number }>(
  rows: T[],
): T[] {
  if (rows.length === 0) return []

  const bySymbol = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = bySymbol.get(row.symbol)
    if (bucket) bucket.push(row)
    else bySymbol.set(row.symbol, [row])
  }

  const adjusted: T[] = []
  for (const symbolRows of bySymbol.values()) {
    for (const bar of adjustForSplits(symbolRows as unknown as RawBar[]).bars) {
      if (bar.adjustedClose === null) continue
      adjusted.push({ ...(bar as unknown as T), close: bar.adjustedClose })
    }
  }

  return adjusted.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Known limitation: dividends ────────────────────────────────────────────
//
// A dividend also drops the price on the ex-date without destroying value, but
// unlike a split it leaves no recognisable signature in the price series — a
// 0.5% drop is indistinguishable from an ordinary down day. Recovering it needs
// the dividend record itself, which none of the configured providers is asked
// for today.
//
// The consequence: everything measured here is a PRICE return, not a TOTAL
// return. For a high-yield holding that understates the return by roughly the
// dividend yield per year, and slightly overstates measured volatility. This is
// documented rather than silently ignored.
