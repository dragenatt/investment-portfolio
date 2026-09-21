import { describe, it, expect } from 'vitest'
import {
  positionDailyChange,
  aggregateDailyChange,
  positionValuation,
  positionInDisplayCurrency,
  dailyChangeFromPct,
} from '@/lib/services/pnl'

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

describe('dailyChangeFromPct', () => {
  it('recovers the move against the previous close from the percentage alone', () => {
    // 1 share, 100 -> 102: the day made 2.00, not 2% of 102.
    expect(dailyChangeFromPct(102, 2)).toBeCloseTo(2, 10)
    expect(dailyChangeFromPct(102, 2)).toBeCloseTo(positionDailyChange(1, 102, 100).change, 10)
  })

  it('does not understate a down day', () => {
    // 10 shares, 100 -> 90: the day lost 100.
    expect(dailyChangeFromPct(900, -10)).toBeCloseTo(-100, 10)
  })

  it('returns zero with no percentage, or one with no yesterday to recover', () => {
    expect(dailyChangeFromPct(500, null)).toBe(0)
    expect(dailyChangeFromPct(500, undefined)).toBe(0)
    expect(dailyChangeFromPct(500, Number.NaN)).toBe(0)
    expect(dailyChangeFromPct(500, -100)).toBe(0)
  })

  it('makes the day\'s percentage on the book come back out exactly', () => {
    // The screens divide the summed change by (today − change) to get the
    // book's percentage; with the right change that is yesterday's value.
    const holdings = [{ value: 102, pct: 2 }, { value: 45, pct: -10 }]
    const change = holdings.reduce((sum, h) => sum + dailyChangeFromPct(h.value, h.pct), 0)
    const today = holdings.reduce((sum, h) => sum + h.value, 0)
    // yesterday: 100 + 50
    expect(today - change).toBeCloseTo(150, 10)
    expect((change / (today - change)) * 100).toBeCloseTo(((147 - 150) / 150) * 100, 10)
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

describe('money precision (P0-3)', () => {
  it('sums daily change to the cent across positions', () => {
    // (1.1 - 1.0) === 0.10000000000000009; three of them drift to 0.30000000000000027
    const positions = Array(3).fill({ quantity: 1, currentPrice: 1.1, previousClose: 1.0 })
    expect(aggregateDailyChange(positions).change).toBe(0.3)
  })

  it('anchors a single position change to whole cents', () => {
    expect(positionDailyChange(3, 19.99, 19.92).change).toBe(0.21)
  })
})

describe('positionValuation', () => {
  it('values a position at whole cents', () => {
    const v = positionValuation(3, 19.99, 15)
    expect(v.marketValue).toBe(59.97)
    expect(v.costBasis).toBe(45)
    expect(v.pnlAbsolute).toBe(14.97)
  })

  it('does not drift multiplying price by quantity', () => {
    // 3 * 0.07 === 0.21000000000000002
    const v = positionValuation(3, 0.07, 0.05)
    expect(v.marketValue).toBe(0.21)
    expect(v.costBasis).toBe(0.15)
    expect(v.pnlAbsolute).toBe(0.06)
  })

  it('reports P&L percent as a ratio of cost basis', () => {
    expect(positionValuation(1, 150, 100).pnlPercent).toBeCloseTo(50)
  })

  it('reports zero percent when there is no cost basis', () => {
    expect(positionValuation(1, 150, 0).pnlPercent).toBe(0)
  })

  it('supports fractional quantities', () => {
    const v = positionValuation(0.5, 150.25, 150.25)
    expect(v.marketValue).toBe(75.13)
    expect(v.pnlAbsolute).toBe(0)
  })
})
describe('positionInDisplayCurrency', () => {
  // The portfolio detail page showed every holding at a 94% loss with an
  // average cost seventeen times too high, under a header that said +0.64%.
  // A position has two currencies — VOO trades in dollars and was bought with
  // pesos — and a row on screen has one, so both amounts have to be put into
  // the display currency before the row is built. Synthetic figures.
  const RATES: Record<string, number> = { USD: 1, MXN: 17, EUR: 0.9 }
  const toMxn = (amount: number, from: string) => (amount / RATES[from]) * RATES.MXN

  it('puts the cost and the price into the same currency before comparing them', () => {
    // Bought at 10,000 pesos a share; now quoted at 600 dollars = 10,200 pesos.
    const row = positionInDisplayCurrency(
      { quantity: 2, avgCost: 10_000, costCurrency: 'MXN', currentPrice: 600, priceCurrency: 'USD' },
      toMxn,
      'MXN',
    )

    expect(row.avgCost).toBeCloseTo(10_000)
    expect(row.currentPrice).toBeCloseTo(10_200)
    expect(row.marketValue).toBeCloseTo(20_400)
    expect(row.pnlAbsolute).toBeCloseTo(400)
    expect(row.pnlPercent).toBeCloseTo(2)
  })

  it('labels the row with the display currency, so nothing converts it twice', () => {
    const row = positionInDisplayCurrency(
      { quantity: 1, avgCost: 10_000, costCurrency: 'MXN', currentPrice: 600, priceCurrency: 'USD' },
      toMxn,
      'MXN',
    )

    // The old row carried the PRICE currency, so the renderer took a peso cost
    // for dollars and multiplied it by the rate again: 10,000 became 170,000.
    expect(row.currency).toBe('MXN')
  })

  it('is a no-op when everything is already in the display currency', () => {
    const row = positionInDisplayCurrency(
      { quantity: 3, avgCost: 100, costCurrency: 'MXN', currentPrice: 110, priceCurrency: 'MXN' },
      toMxn,
      'MXN',
    )

    expect(row.avgCost).toBe(100)
    expect(row.currentPrice).toBe(110)
    expect(row.pnlPercent).toBeCloseTo(10)
  })

  it('reports no gain and no loss for a position with no cost', () => {
    const row = positionInDisplayCurrency(
      { quantity: 1, avgCost: 0, costCurrency: 'MXN', currentPrice: 600, priceCurrency: 'USD' },
      toMxn,
      'MXN',
    )

    expect(row.pnlPercent).toBe(0)
  })
})
