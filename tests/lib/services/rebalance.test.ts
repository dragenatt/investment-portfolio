import { describe, it, expect } from 'vitest'
import {
  planRebalance,
  isCalendarDue,
  detectRiskDrift,
  type Holding,
  type TargetWeight,
} from '@/lib/services/rebalance'

const holdings: Holding[] = [
  { symbol: 'AAPL', value: 3630 },
  { symbol: 'MSFT', value: 2500 },
  { symbol: 'BND', value: 3870 },
]
const targets: TargetWeight[] = [
  { symbol: 'AAPL', targetWeight: 0.3 },
  { symbol: 'MSFT', targetWeight: 0.3 },
  { symbol: 'BND', targetWeight: 0.4 },
]

describe('planRebalance — deviation', () => {
  it('measures the drift of each holding in percentage points', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    const aapl = plan.actions.find((a) => a.symbol === 'AAPL')!
    expect(aapl.currentWeight).toBeCloseTo(0.363)
    expect(aapl.deviationPp).toBeCloseTo(6.3, 5)
  })

  it('triggers once a holding drifts past the threshold', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    expect(plan.triggered).toBe(true)
    expect(plan.trigger).toBe('deviation')
  })

  it('does not trigger when everything is inside the threshold', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 10 })
    expect(plan.triggered).toBe(false)
    expect(plan.trigger).toBe('none')
  })

  it('says what to buy and what to sell', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    const aapl = plan.actions.find((a) => a.symbol === 'AAPL')!
    const msft = plan.actions.find((a) => a.symbol === 'MSFT')!
    expect(aapl.action).toBe('sell')
    expect(aapl.tradeValue).toBeLessThan(0)
    expect(msft.action).toBe('buy')
    expect(msft.tradeValue).toBeGreaterThan(0)
  })

  it('produces trades that net to zero — a rebalance moves money, it does not add any', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    const net = plan.actions.reduce((s, a) => s + a.tradeValue, 0)
    expect(Math.abs(net)).toBeLessThan(0.01)
  })

  it('lands every holding exactly on its target weight', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    for (const action of plan.actions) {
      const after = action.currentValue + action.tradeValue
      expect(after / plan.totalValue).toBeCloseTo(action.targetWeight, 4)
    }
  })

  it('reports turnover as the share of the book that changes hands', () => {
    const plan = planRebalance(holdings, targets, { mode: 'deviation', thresholdPp: 5 })
    // 630 sold from AAPL, 500 bought into MSFT, 130 sold from BND -> 630 one way
    expect(plan.turnoverPct).toBeCloseTo(6.3, 1)
  })
})

describe('planRebalance — bands', () => {
  it('holds while inside the band even though it has drifted', () => {
    // Target 30%, actual 36.3%, band +/- 7pp -> inside
    const plan = planRebalance(holdings, targets, { mode: 'band', bandPp: 7 })
    expect(plan.triggered).toBe(false)
  })

  it('triggers once outside the band', () => {
    const plan = planRebalance(holdings, targets, { mode: 'band', bandPp: 5 })
    expect(plan.triggered).toBe(true)
    expect(plan.trigger).toBe('band')
  })

  it('names the band in the explanation', () => {
    const plan = planRebalance(holdings, targets, { mode: 'band', bandPp: 5 })
    expect(plan.reason).toMatch(/25|35|band/i)
  })
})

describe('planRebalance — edge cases', () => {
  it('treats a target with no holding as a full buy', () => {
    const plan = planRebalance(
      [{ symbol: 'AAPL', value: 10000 }],
      [
        { symbol: 'AAPL', targetWeight: 0.5 },
        { symbol: 'NEW', targetWeight: 0.5 },
      ],
      { mode: 'deviation', thresholdPp: 5 },
    )
    const fresh = plan.actions.find((a) => a.symbol === 'NEW')!
    expect(fresh.currentValue).toBe(0)
    expect(fresh.action).toBe('buy')
    expect(fresh.tradeValue).toBeCloseTo(5000)
  })

  it('treats a holding with no target as a full exit', () => {
    const plan = planRebalance(
      [
        { symbol: 'AAPL', value: 5000 },
        { symbol: 'OLD', value: 5000 },
      ],
      [{ symbol: 'AAPL', targetWeight: 1 }],
      { mode: 'deviation', thresholdPp: 5 },
    )
    const exit = plan.actions.find((a) => a.symbol === 'OLD')!
    expect(exit.targetWeight).toBe(0)
    expect(exit.action).toBe('sell')
    expect(exit.tradeValue).toBeCloseTo(-5000)
  })

  it('refuses to plan against targets that do not sum to 100%', () => {
    const plan = planRebalance(holdings, [{ symbol: 'AAPL', targetWeight: 0.5 }], {
      mode: 'deviation',
      thresholdPp: 5,
    })
    expect(plan.triggered).toBe(false)
    expect(plan.reason).toMatch(/100%|sum/i)
    expect(plan.actions).toEqual([])
  })

  it('handles an empty book without dividing by zero', () => {
    const plan = planRebalance([], targets, { mode: 'deviation', thresholdPp: 5 })
    expect(plan.totalValue).toBe(0)
    expect(plan.triggered).toBe(false)
    expect(plan.actions.every((a) => Number.isFinite(a.tradeValue))).toBe(true)
  })
})

describe('isCalendarDue', () => {
  const asOf = new Date('2026-09-09T00:00:00Z')

  it('is due when a quarter has passed', () => {
    expect(isCalendarDue('2026-06-01', 'quarterly', asOf)).toBe(true)
  })

  it('is not due a month into a quarterly schedule', () => {
    expect(isCalendarDue('2026-08-15', 'quarterly', asOf)).toBe(false)
  })

  it('handles every supported frequency', () => {
    expect(isCalendarDue('2026-08-01', 'monthly', asOf)).toBe(true)
    expect(isCalendarDue('2026-05-01', 'semiannual', asOf)).toBe(false)
    expect(isCalendarDue('2026-01-01', 'semiannual', asOf)).toBe(true)
    expect(isCalendarDue('2025-01-01', 'annual', asOf)).toBe(true)
  })

  it('is due when there is no record of a previous rebalance', () => {
    expect(isCalendarDue(null, 'quarterly', asOf)).toBe(true)
  })

  it('is not due for an unparseable date rather than firing constantly', () => {
    expect(isCalendarDue('whenever', 'quarterly', asOf)).toBe(false)
  })
})

describe('detectRiskDrift', () => {
  it('flags a holding whose risk share outran its weight', () => {
    // Weight is on target, but volatility rose and it now carries the book
    const drift = detectRiskDrift(
      [
        { symbol: 'AAPL', weight: 0.3, percentOfRisk: 62 },
        { symbol: 'BND', weight: 0.7, percentOfRisk: 38 },
      ],
      { thresholdPp: 20 },
    )
    expect(drift.triggered).toBe(true)
    expect(drift.offenders.map((o) => o.symbol)).toContain('AAPL')
    expect(drift.reason).toMatch(/risk/i)
  })

  it('stays quiet when risk shares track their weights', () => {
    const drift = detectRiskDrift(
      [
        { symbol: 'AAPL', weight: 0.3, percentOfRisk: 33 },
        { symbol: 'BND', weight: 0.7, percentOfRisk: 67 },
      ],
      { thresholdPp: 20 },
    )
    expect(drift.triggered).toBe(false)
    expect(drift.offenders).toEqual([])
  })

  it('handles an empty book', () => {
    expect(detectRiskDrift([], { thresholdPp: 20 }).triggered).toBe(false)
  })
})
