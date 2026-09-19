// How the book divides up — by asset type, by sector and by holding.
//
// Extracted from the allocation route so the SHAPE of the answer is something a
// test can hold on to. It was built inline there, and the type the interface
// read was written out a second time by hand in the hook and a third time
// inline in the page. The three drifted: the route returned each slice's label
// as `name`, the hook called it `sector`, and the page rendered `s.sector` —
// which does not exist. Every sector row on the allocation tab drew an empty
// label and a React key of `undefined`, and no test noticed, because no test
// compared what the route returns with what the page reads.
//
// One pure function, one type, one set of field names.

import { freshnessOf, type Freshness } from './freshness'

export type AllocationSlice = {
  /** The group's label: an asset type, or a sector. */
  name: string
  value: number
  pct: number
}

export type HoldingSlice = {
  symbol: string
  value: number
  pct: number
  /**
   * How current the price behind `value` is, from freshness.ts. It replaced a
   * `stale: quote === undefined` flag that called a quote saved last Friday
   * current, and could only say "missing" or "fine".
   */
  freshness: Freshness
}

/** A current_prices row, as the route reads it. */
export type StoredQuote = { price: number; fetched_at?: string | null }

export type AllocationBreakdown = {
  byType: AllocationSlice[]
  bySector: AllocationSlice[]
  bySymbol: HoldingSlice[]
  total: number
}

export type AllocationPosition = {
  symbol: string
  asset_type: string
  quantity: number
  avg_cost: number
}

/** What a holding with no sector on file is grouped under. */
export const UNKNOWN_SECTOR = 'Unknown'

function toSlices(totals: Map<string, number>, total: number): AllocationSlice[] {
  return [...totals.entries()].map(([name, value]) => ({
    name,
    value,
    pct: total > 0 ? (value / total) * 100 : 0,
  }))
}

/**
 * The book's composition, valued at the last stored quote and falling back to
 * the average cost.
 *
 * An empty book returns every breakdown as an empty array rather than omitting
 * some of them: the route used to return `{ byType, bySymbol, total }` with no
 * `bySector` at all in that case, so a reader could not tell "no sectors" from
 * "sectors were not computed".
 *
 * `valuesInBase`, when given, is each position's value already in the
 * portfolio's currency (valueBookInBase), in the order of `positions`; it
 * replaces quantity × price, which for a book quoted in two currencies adds
 * pesos to dollars. The quote still decides each holding's freshness.
 */
export function summariseAllocation(
  positions: AllocationPosition[],
  quoteBySymbol: Record<string, StoredQuote>,
  sectorBySymbol: Record<string, string>,
  asOf: Date = new Date(),
  valuesInBase?: number[],
): AllocationBreakdown {
  const byType = new Map<string, number>()
  const bySector = new Map<string, number>()
  const bySymbol: HoldingSlice[] = []
  let total = 0

  positions.forEach((position, i) => {
    const stored = quoteBySymbol[position.symbol]
    const quote = stored && Number.isFinite(stored.price) ? stored : undefined
    const price = quote?.price ?? position.avg_cost
    if (!Number.isFinite(position.quantity) || !Number.isFinite(price)) return

    const value = valuesInBase ? valuesInBase[i] : position.quantity * price
    if (!Number.isFinite(value)) return
    total += value

    byType.set(position.asset_type, (byType.get(position.asset_type) ?? 0) + value)
    const sector = sectorBySymbol[position.symbol] || UNKNOWN_SECTOR
    bySector.set(sector, (bySector.get(sector) ?? 0) + value)
    // A quote with no row is classified unavailable, which is what the average
    // cost standing in for it is.
    bySymbol.push({ symbol: position.symbol, value, pct: 0, freshness: freshnessOf(quote, { asOf }) })
  })

  for (const holding of bySymbol) holding.pct = total > 0 ? (holding.value / total) * 100 : 0

  return {
    byType: toSlices(byType, total),
    bySector: toSlices(bySector, total),
    bySymbol: bySymbol.sort((a, b) => b.value - a.value),
    total,
  }
}
