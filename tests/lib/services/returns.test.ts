import { describe, it, expect } from 'vitest'
import { calculateSimpleReturn, calculateTWR, calculateMWR } from '@/lib/services/returns'
import { capitalWeightedAgeDays } from '@/lib/services/returns'

describe('calculateSimpleReturn', () => {
  it('calculates positive return', () => {
    expect(calculateSimpleReturn(11000, 10000)).toBeCloseTo(10, 1)
  })

  it('calculates negative return', () => {
    expect(calculateSimpleReturn(9000, 10000)).toBeCloseTo(-10, 1)
  })

  it('returns 0 when cost is 0', () => {
    expect(calculateSimpleReturn(100, 0)).toBe(0)
  })
})

describe('calculateTWR', () => {
  it('calculates TWR with no cash flows', () => {
    // Portfolio goes from 10000 to 11000 over 3 snapshots
    const snapshots = [
      { date: '2026-01-01', value: 10000 },
      { date: '2026-01-02', value: 10500 },
      { date: '2026-01-03', value: 11000 },
    ]
    const result = calculateTWR(snapshots, [])
    expect(result).toBeCloseTo(10, 0) // ~10% total return
  })

  it('calculates TWR ignoring cash flow timing', () => {
    // Deposit right before a drop, then recovery
    const snapshots = [
      { date: '2026-01-01', value: 10000 },
      { date: '2026-01-02', value: 10000 }, // value before deposit
      { date: '2026-01-03', value: 18000 }, // 20000 after deposit, dropped to 18000
      { date: '2026-01-04', value: 20000 }, // recovered
    ]
    const cashFlows = [
      { date: '2026-01-02', amount: 10000 }, // deposit of 10000
    ]
    const result = calculateTWR(snapshots, cashFlows)
    // Sub-period 1: 10000→10000 = 0%
    // Sub-period 2: 20000→18000 = -10% (value after deposit was 20000)
    // Sub-period 3: 18000→20000 = +11.1%
    // TWR = (1+0)(1-0.10)(1+0.111) - 1 ≈ 0%
    expect(result).toBeCloseTo(0, 0)
  })
})

describe('calculateMWR', () => {
  it('calculates MWR for simple growth', () => {
    const cashFlows = [
      { date: '2026-01-01', amount: -10000 }, // invest 10000
    ]
    const currentValue = 11000
    const endDate = new Date('2026-12-31')
    const result = calculateMWR(cashFlows, currentValue, endDate)
    expect(result).toBeGreaterThan(5) // should be ~10% annualized
    expect(result).toBeLessThan(15)
  })

  it('says it cannot answer when there are no cash flows', () => {
    // Previously 0, which on a dashboard reads as "you made nothing" rather
    // than "there is nothing to measure". Null is the honest answer.
    expect(calculateMWR([], 0, new Date())).toBeNull()
  })
})

describe('capitalWeightedAgeDays', () => {
  it('weights each contribution by its size', () => {
    // 10,000 invested 300 days ago and 30,000 invested 20 days ago: the money
    // has been at work for (10k x 300 + 30k x 20) / 40k = 90 days on average,
    // even though the first deposit is ten months old.
    const flows = [
      { date: '2025-11-17', amount: -10000 },
      { date: '2026-08-24', amount: -30000 },
    ]
    expect(capitalWeightedAgeDays(flows, new Date('2026-09-13'))).toBeCloseTo(90, 6)
  })

  it('ignores withdrawals, which are not capital put to work', () => {
    const flows = [
      { date: '2026-06-15', amount: -10000 },
      { date: '2026-07-15', amount: 4000 },
    ]
    expect(capitalWeightedAgeDays(flows, new Date('2026-09-13'))).toBeCloseTo(90, 6)
  })

  it('returns null with nothing invested', () => {
    expect(capitalWeightedAgeDays([], new Date('2026-09-13'))).toBeNull()
    expect(capitalWeightedAgeDays([{ date: '2026-01-01', amount: 500 }], new Date('2026-09-13'))).toBeNull()
  })

  it('never goes negative for a flow dated after the end', () => {
    const flows = [{ date: '2026-10-01', amount: -1000 }]
    expect(capitalWeightedAgeDays(flows, new Date('2026-09-13'))).toBe(0)
  })
})
