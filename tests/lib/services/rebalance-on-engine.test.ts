import { describe, it, expect } from 'vitest'
import { simulateRebalance } from '@/lib/services/rebalance'
import { scenarioFromEstimates, scenarioMoments, runScenario } from '@/lib/services/scenario-engine'
import { portfolioVolatility } from '@/lib/services/risk-attribution'

// 4.9 (3/4) — the rebalance panel builds its books as scenario-engine
// scenarios. A refactor: every figure it showed must come out the same.

const cov = [
  [0.09, 0.012, 0.004, 0],
  [0.012, 0.04, 0.006, 0],
  [0.004, 0.006, 0.01, 0],
  [0, 0, 0, 0], // cash-like: no variance at all
]
const expectedReturns = [0.12, 0.08, 0.05, 0.03]
const symbols = ['A', 'B', 'C', 'CASH']
const holdings = [
  { symbol: 'A', value: 50_000 },
  { symbol: 'B', value: 25_000 },
  { symbol: 'C', value: 15_000 },
  { symbol: 'CASH', value: 10_000 },
]
const targets = symbols.map((symbol) => ({ symbol, targetWeight: 0.25 }))

describe('a book as an engine scenario', () => {
  it('has the moments of the direct formulas', () => {
    const weights = [0.5, 0.25, 0.15, 0.1]
    const moments = scenarioMoments(scenarioFromEstimates({ capital: 1, symbols, weights, cov, expectedReturns }))!
    expect(moments.volatility).toBeCloseTo(portfolioVolatility(weights, cov)!, 12)
    expect(moments.expectedReturn).toBeCloseTo(0.5 * 0.12 + 0.25 * 0.08 + 0.15 * 0.05 + 0.1 * 0.03, 12)
    moments.cov.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(cov[i][j], 14)))
  })

  it('refuses a risk model that does not match the weights', () => {
    const spec = scenarioFromEstimates({ capital: 1, symbols, weights: [0.5, 0.5], cov, expectedReturns })
    expect(scenarioMoments(spec)).toBeNull()
  })
})

describe('the rebalance simulation on engine scenarios', () => {
  const simulation = simulateRebalance(holdings, targets, { cov, expectedReturns, riskFreeRate: 0.04 })!

  it('reports the figures the panel always reported', () => {
    const before = [0.5, 0.25, 0.15, 0.1]
    const after = [0.25, 0.25, 0.25, 0.25]
    expect(simulation.before.volatilityPct).toBeCloseTo(portfolioVolatility(before, cov)! * 100, 10)
    expect(simulation.after.volatilityPct).toBeCloseTo(portfolioVolatility(after, cov)! * 100, 10)
    expect(simulation.after.expectedReturnPct).toBeCloseTo((0.12 + 0.08 + 0.05 + 0.03) / 4 * 100, 10)
  })

  it('carries the two books as scenarios the engine can run as they are', () => {
    expect(simulation.scenarios.after.holdings.map((h) => h.weight)).toEqual([0.25, 0.25, 0.25, 0.25])
    const projected = runScenario({ ...simulation.scenarios.after, capital: 100_000, simulations: 50, seed: 1 })
    expect('errors' in projected).toBe(false)
  })
})
