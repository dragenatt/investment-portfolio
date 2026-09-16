import { describe, it, expect } from 'vitest'
import {
  planRebalance,
  isCalendarDue,
  detectRiskDrift,
  simulateRebalance,
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
    expect(drift.reason).toMatch(/riesgo/i)
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

describe('simulateRebalance (P1-10)', () => {
  // Two assets: A is volatile, B is calm, lightly correlated.
  const cov = [
    [0.09, 0.006],
    [0.006, 0.01],
  ]
  const expectedReturns = [0.12, 0.04]
  const drifted: Holding[] = [
    { symbol: 'A', value: 7000 },
    { symbol: 'B', value: 3000 },
  ]
  const targets: TargetWeight[] = [
    { symbol: 'A', targetWeight: 0.5 },
    { symbol: 'B', targetWeight: 0.5 },
  ]

  it('reports the book before and after without touching anything', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    expect(sim.before.weights.A).toBeCloseTo(0.7)
    expect(sim.after.weights.A).toBeCloseTo(0.5)
    // The proposal is a proposal: the input is unchanged
    expect(drifted[0].value).toBe(7000)
  })

  it('lowers volatility when rebalancing away from the riskier holding', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    expect(sim.after.volatilityPct).toBeLessThan(sim.before.volatilityPct)
    expect(sim.delta.volatilityPp).toBeLessThan(0)
  })

  it('lowers expected return too — the trade the reader has to see', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    expect(sim.after.expectedReturnPct).toBeLessThan(sim.before.expectedReturnPct)
  })

  it('reports the Sharpe of both sides', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns, riskFreeRate: 0.04 })!
    expect(Number.isFinite(sim.before.sharpe!)).toBe(true)
    expect(Number.isFinite(sim.after.sharpe!)).toBe(true)
    expect(sim.delta.sharpe).toBeCloseTo(sim.after.sharpe! - sim.before.sharpe!, 10)
  })

  it('measures concentration with HHI and shows it falling', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    // 0.7^2 + 0.3^2 = 0.58 before; 0.5^2 + 0.5^2 = 0.50 after
    expect(sim.before.hhi).toBeCloseTo(0.58)
    expect(sim.after.hhi).toBeCloseTo(0.5)
    expect(sim.delta.hhi).toBeLessThan(0)
  })

  it('reports where the risk sits on both sides', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    const beforeA = sim.before.riskShare.find((r) => r.symbol === 'A')!
    const afterA = sim.after.riskShare.find((r) => r.symbol === 'A')!
    expect(beforeA.percentOfRisk).toBeGreaterThan(afterA.percentOfRisk)
  })

  it('carries the trades the plan would need', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    const sellA = sim.plan.actions.find((a) => a.symbol === 'A')!
    expect(sellA.action).toBe('sell')
    expect(sellA.tradeValue).toBeCloseTo(-2000)
  })

  it('estimates VaR on both sides', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    expect(sim.before.var95Pct).toBeGreaterThan(0)
    expect(sim.after.var95Pct).toBeLessThan(sim.before.var95Pct)
  })

  it('summarises the trade-off in words', () => {
    const sim = simulateRebalance(drifted, targets, { cov, expectedReturns })!
    expect(sim.summary.length).toBeGreaterThan(40)
    expect(sim.summary).toMatch(/riesgo|volatil/i)
  })

  it('refuses targets that do not describe a whole portfolio', () => {
    const bad: TargetWeight[] = [{ symbol: 'A', targetWeight: 0.5 }]
    expect(simulateRebalance(drifted, bad, { cov, expectedReturns })).toBeNull()
  })

  it('refuses a covariance matrix that does not match the holdings', () => {
    expect(simulateRebalance(drifted, targets, { cov: [[0.09]], expectedReturns })).toBeNull()
  })

  it('is deterministic', () => {
    const args = [drifted, targets, { cov, expectedReturns }] as const
    expect(simulateRebalance(...args)).toEqual(simulateRebalance(...args))
  })
})

// ─── Undoing price drift, and beta before/after (P1-10) ─────────────────────

import { driftTargets } from '@/lib/services/rebalance'

describe('driftTargets', () => {
  it('takes each holding price growth back out of the current weights', () => {
    // AAA grew 1.5x and is now 60%; BBB did not move and is 40%.
    const start = driftTargets([0.6, 0.4], [1.5, 1])!
    expect(start[0]).toBeCloseTo(0.5, 12)
    expect(start[1]).toBeCloseTo(0.5, 12)
  })

  it('refuses a growth factor that cannot be divided out', () => {
    expect(driftTargets([0.6, 0.4], [0, 1])).toBeNull()
    expect(driftTargets([0.6, 0.4], [Number.NaN, 1])).toBeNull()
    expect(driftTargets([0.6, 0.4], [1])).toBeNull()
  })
})

describe('simulateRebalance reports beta before and after', () => {
  const holdings = [
    { symbol: 'AAA', value: 7000 },
    { symbol: 'BBB', value: 3000 },
  ]
  const targets = [
    { symbol: 'AAA', targetWeight: 0.5 },
    { symbol: 'BBB', targetWeight: 0.5 },
  ]
  const inputs = {
    cov: [[0.09, 0.01], [0.01, 0.01]],
    expectedReturns: [0.12, 0.04],
    riskFreeRate: 0.02,
    assetBetas: [1.4, 0.4],
  }

  it('computes the book beta as the weighted sum of its holdings betas', () => {
    const sim = simulateRebalance(holdings, targets, inputs)!
    expect(sim.before.beta).toBeCloseTo(0.7 * 1.4 + 0.3 * 0.4, 12)
    expect(sim.after.beta).toBeCloseTo(0.5 * 1.4 + 0.5 * 0.4, 12)
    expect(sim.delta.beta).toBeCloseTo(sim.after.beta! - sim.before.beta!, 12)
    // Moving weight out of the high-beta holding lowers the book beta.
    expect(sim.delta.beta!).toBeLessThan(0)
  })

  it('leaves beta null, not zero, when there was no benchmark to measure against', () => {
    const sim = simulateRebalance(holdings, targets, { ...inputs, assetBetas: null })!
    expect(sim.before.beta).toBeNull()
    expect(sim.delta.beta).toBeNull()
  })
})
