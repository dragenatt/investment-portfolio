import { describe, it, expect } from 'vitest'
import { positionDailyChange, aggregateDailyChange } from '@/lib/services/pnl'

describe('positionDailyChange', () => {
  it('measures the move against the previous close', () => {
    // 10 shares, 100 -> 105 vs a 100 previous close
    const r = positionDailyChange(10, 105, 100)
    expect(r.change).toBeCloseTo(50) // (105-100)*10
    expect(r.changePct).toBeCloseTo(5) // +5%
  })

  it('handles a down day', () => {
    const r = positionDailyChange(4, 90, 100)
    expect(r.change).toBeCloseTo(-40)
    expect(r.changePct).toBeCloseTo(-10)
  })

  it('returns zero when no baseline is available', () => {
    expect(positionDailyChange(10, 105, null)).toEqual({ change: 0, changePct: 0 })
    expect(positionDailyChange(10, 105, undefined)).toEqual({ change: 0, changePct: 0 })
    expect(positionDailyChange(10, 105, 0)).toEqual({ change: 0, changePct: 0 })
  })

  it('does not depend on avg cost — only the daily anchor', () => {
    // Same intraday move regardless of what the position cost originally.
    const a = positionDailyChange(1, 210, 200)
    const b = positionDailyChange(1, 210, 200)
    expect(a).toEqual(b)
    expect(a.changePct).toBeCloseTo(5)
  })
})

describe('aggregateDailyChange', () => {
  it('sums change and weights the percentage by baseline value', () => {
    const r = aggregateDailyChange([
      { quantity: 10, currentPrice: 105, previousClose: 100 }, // +50 on base 1000
      { quantity: 5, currentPrice: 190, previousClose: 200 },  // -50 on base 1000
    ])
    expect(r.change).toBeCloseTo(0) // +50 - 50
    expect(r.changePct).toBeCloseTo(0) // 0 / 2000
  })

  it('excludes positions without a baseline from both change and denominator', () => {
    const r = aggregateDailyChange([
      { quantity: 10, currentPrice: 110, previousClose: 100 }, // +100 on base 1000
      { quantity: 3, currentPrice: 500, previousClose: null },  // ignored
    ])
    expect(r.change).toBeCloseTo(100)
    expect(r.changePct).toBeCloseTo(10) // 100 / 1000, unaffected by the baseline-less holding
  })

  it('returns zero for an empty book', () => {
    expect(aggregateDailyChange([])).toEqual({ change: 0, changePct: 0 })
  })
})
