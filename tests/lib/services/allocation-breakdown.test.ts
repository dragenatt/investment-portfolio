import { describe, it, expect } from 'vitest'
import { summariseAllocation, UNKNOWN_SECTOR, type AllocationBreakdown } from '@/lib/services/allocation-breakdown'
import type { AllocationData } from '@/lib/hooks/use-analytics'

const positions = [
  { symbol: 'AAA', asset_type: 'stock', quantity: 10, avg_cost: 50 },
  { symbol: 'BBB', asset_type: 'stock', quantity: 4, avg_cost: 100 },
  { symbol: 'CCC', asset_type: 'etf', quantity: 2, avg_cost: 200 },
]
const NOW = new Date('2026-09-08T15:00:00Z')
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()
// AAA was read a minute ago, BBB on Friday; CCC has no quote at all.
const prices = { AAA: { price: 60, fetched_at: ago(60) }, BBB: { price: 100, fetched_at: ago(3 * 86400) } }
const sectors = { AAA: 'Technology', BBB: 'Technology' } // CCC has no sector

describe('summariseAllocation', () => {
  const result = summariseAllocation(positions, prices, sectors, NOW)

  it('values each holding at its quote, and at its cost when there is none', () => {
    expect(result.total).toBe(600 + 400 + 400)
    expect(result.bySymbol.map(({ symbol, value, pct }) => ({ symbol, value, pct }))).toEqual([
      { symbol: 'AAA', value: 600, pct: (600 / 1400) * 100 },
      { symbol: 'BBB', value: 400, pct: (400 / 1400) * 100 },
      { symbol: 'CCC', value: 400, pct: (400 / 1400) * 100 },
    ])
  })

  it('says how current each price is in freshness.ts terms, not as a yes or no', () => {
    // The flag this replaced was `quote === undefined`: BBB's Friday price
    // counted as current because a row existed.
    const status = Object.fromEntries(result.bySymbol.map((h) => [h.symbol, h.freshness.status]))
    expect(status).toEqual({ AAA: 'live', BBB: 'cached', CCC: 'unavailable' })
  })

  it('treats a stored row with no usable price as no quote', () => {
    const broken = summariseAllocation(
      [{ symbol: 'AAA', asset_type: 'stock', quantity: 10, avg_cost: 50 }],
      { AAA: { price: Number.NaN, fetched_at: ago(10) } },
      {},
      NOW,
    )
    expect(broken.total).toBe(500)
    expect(broken.bySymbol[0].freshness.status).toBe('unavailable')
  })

  it('groups by type and by sector, with the unknown sector named', () => {
    expect(result.byType).toEqual([
      { name: 'stock', value: 1000, pct: (1000 / 1400) * 100 },
      { name: 'etf', value: 400, pct: (400 / 1400) * 100 },
    ])
    expect(result.bySector).toEqual([
      { name: 'Technology', value: 1000, pct: (1000 / 1400) * 100 },
      { name: UNKNOWN_SECTOR, value: 400, pct: (400 / 1400) * 100 },
    ])
  })

  it('returns every breakdown for an empty book, not just some of them', () => {
    // The route used to answer { byType, bySymbol, total } with no bySector at
    // all, so "no sectors" was indistinguishable from "not computed".
    expect(summariseAllocation([], {}, {})).toEqual({ byType: [], bySector: [], bySymbol: [], total: 0 })
  })

  it('leaves out a position whose quantity or price is not a number', () => {
    const broken = summariseAllocation(
      [{ symbol: 'X', asset_type: 'stock', quantity: Number.NaN, avg_cost: 10 }],
      {}, {},
    )
    expect(broken.total).toBe(0)
    expect(broken.bySymbol).toEqual([])
  })

  it('never lets a percentage be NaN, even with nothing to divide by', () => {
    const zero = summariseAllocation(
      [{ symbol: 'X', asset_type: 'stock', quantity: 0, avg_cost: 0 }],
      {}, {},
    )
    for (const slice of [...zero.byType, ...zero.bySector]) expect(Number.isFinite(slice.pct)).toBe(true)
    for (const holding of zero.bySymbol) expect(Number.isFinite(holding.pct)).toBe(true)
  })
})

describe('contract: the allocation route and the analytics page agree', () => {
  // The bug this pins: the route built each slice's label as `name`, the hook
  // type called it `sector`, and the page rendered `s.sector`. TypeScript could
  // not catch it because the shape was written out three times by hand instead
  // of once. Assigning the engine's result to the type the page consumes makes
  // the compiler the thing that catches it next time.
  it('the shape the engine produces is assignable to the type the page reads', () => {
    const breakdown: AllocationBreakdown = summariseAllocation(positions, prices, sectors)
    const asPageReadsIt: Omit<AllocationData, '_meta'> = breakdown
    expect(asPageReadsIt.bySector[0].name).toBe('Technology')
  })

  it('every field the page renders exists on the slice it renders it from', () => {
    // analytics/page.tsx reads s.name and s.pct off bySector and byType, and
    // s.symbol, s.pct and s.freshness off bySymbol.
    for (const slice of [...result().byType, ...result().bySector]) {
      expect(Object.keys(slice).sort()).toEqual(['name', 'pct', 'value'])
    }
    for (const holding of result().bySymbol) {
      expect(Object.keys(holding).sort()).toEqual(['freshness', 'pct', 'symbol', 'value'])
      expect(Object.keys(holding.freshness)).toEqual(expect.arrayContaining(['status', 'label']))
    }
  })

  function result() {
    return summariseAllocation(positions, prices, sectors)
  }
})
