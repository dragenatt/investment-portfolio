import { describe, it, expect } from 'vitest'
import {
  calculateXIRR,
  calculateTWR,
  describeReturnDifference,
  type CashFlow,
} from '@/lib/services/returns'

/** Net present value of `flows` at an annual `rate`, the thing XIRR drives to zero. */
function npv(flows: CashFlow[], rate: number): number {
  const start = Date.parse(flows[0].date)
  return flows.reduce((sum, f) => {
    const years = (Date.parse(f.date) - start) / (365 * 86400000)
    return sum + f.amount / Math.pow(1 + rate, years)
  }, 0)
}

describe('calculateXIRR', () => {
  it('solves a one-year doubling as 100%', () => {
    const rate = calculateXIRR([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 200 },
    ])
    expect(rate).toBeCloseTo(100, 1)
  })

  it('solves a one-year halving as -50%', () => {
    const rate = calculateXIRR([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 50 },
    ])
    expect(rate).toBeCloseTo(-50, 1)
  })

  it('finds a rate that actually reprices the flows to zero', () => {
    // The defining property, checked directly rather than against a memorised number
    const flows: CashFlow[] = [
      { date: '2024-01-15', amount: -5000 },
      { date: '2024-04-02', amount: -1500 },
      { date: '2024-09-30', amount: -2200 },
      { date: '2025-02-11', amount: 900 },
      { date: '2026-01-05', amount: 9800 },
    ]
    const rate = calculateXIRR(flows)
    expect(rate).not.toBeNull()
    expect(Math.abs(npv(flows, rate! / 100))).toBeLessThan(0.01)
  })

  it('handles many small monthly contributions', () => {
    const flows: CashFlow[] = Array.from({ length: 24 }, (_, i) => ({
      date: `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      amount: -500,
    }))
    flows.push({ date: '2026-01-01', amount: 13500 })
    const rate = calculateXIRR(flows)
    expect(rate).not.toBeNull()
    expect(Math.abs(npv(flows, rate! / 100))).toBeLessThan(0.05)
  })

  it('survives an extreme return that Newton-Raphson alone overshoots', () => {
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: -100 },
      { date: '2025-02-01', amount: 900 },
    ]
    const rate = calculateXIRR(flows)
    expect(rate).not.toBeNull()
    expect(Number.isFinite(rate!)).toBe(true)
    expect(Math.abs(npv(flows, rate! / 100))).toBeLessThan(0.01)
  })

  it('says it cannot answer rather than reporting a flat zero', () => {
    // No sign change means no rate exists — 0% would be a lie, not a result
    expect(calculateXIRR([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: -100 },
    ])).toBeNull()
    expect(calculateXIRR([{ date: '2025-01-01', amount: -100 }])).toBeNull()
    expect(calculateXIRR([])).toBeNull()
  })

  it('returns null when every flow lands on the same day', () => {
    expect(calculateXIRR([
      { date: '2025-01-01', amount: -100 },
      { date: '2025-01-01', amount: 120 },
    ])).toBeNull()
  })

  it('is deterministic', () => {
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1150 },
    ]
    expect(calculateXIRR(flows)).toBe(calculateXIRR(flows))
  })
})

describe('calculateTWR', () => {
  it('chains sub-period returns across a contribution', () => {
    // +10%, then a 1000 contribution, then +10% again = 21%
    const twr = calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-06-01', value: 1100 },
        { date: '2025-12-01', value: 2310 },
      ],
      [{ date: '2025-06-01', amount: 1000 }],
    )
    expect(twr).toBeCloseTo(21, 4)
  })

  it('is unaffected by when the money arrived', () => {
    // The property that separates TWR from MWR: same underlying performance,
    // wildly different contribution timing, same time-weighted return.
    const early = calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-02-01', value: 1100 },
        { date: '2025-12-01', value: 11550 },
      ],
      [{ date: '2025-02-01', amount: 9400 }],
    )
    const late = calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-11-01', value: 1100 },
        { date: '2025-12-01', value: 11550 },
      ],
      [{ date: '2025-11-01', amount: 9400 }],
    )
    expect(early).toBeCloseTo(late!, 6)
  })

  it('says it cannot answer with fewer than two snapshots', () => {
    expect(calculateTWR([{ date: '2025-01-01', value: 1000 }], [])).toBeNull()
    expect(calculateTWR([], [])).toBeNull()
  })

  it('says it cannot answer when a sub-period starts from nothing', () => {
    // Dividing by a zero starting value would produce Infinity
    expect(calculateTWR(
      [
        { date: '2025-01-01', value: 0 },
        { date: '2025-06-01', value: 500 },
      ],
      [],
    )).toBeNull()
  })

  it('handles a portfolio with no cash flows at all', () => {
    expect(calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-12-01', value: 1250 },
      ],
      [],
    )).toBeCloseTo(25)
  })

  it('never returns a non-finite number', () => {
    const twr = calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-06-01', value: 1100 },
        { date: '2025-12-01', value: 900 },
      ],
      [{ date: '2025-06-01', amount: -1100 }], // withdrawing the whole book
    )
    expect(twr === null || Number.isFinite(twr)).toBe(true)
  })
})

describe('describeReturnDifference', () => {
  it('explains a money-weighted return that beat the strategy', () => {
    const text = describeReturnDifference(10, 18)
    expect(text).toMatch(/timing|momento/i)
    expect(text!.length).toBeGreaterThan(30)
  })

  it('explains a money-weighted return that lagged the strategy', () => {
    expect(describeReturnDifference(18, 10)!.length).toBeGreaterThan(30)
  })

  it('says so when the two agree', () => {
    expect(describeReturnDifference(12, 12.05)).toMatch(/agree|similar|coincid/i)
  })

  it('declines to compare when one side is missing', () => {
    expect(describeReturnDifference(null, 12)).toBeNull()
    expect(describeReturnDifference(12, null)).toBeNull()
    expect(describeReturnDifference(null, null)).toBeNull()
  })
})
