import { describe, it, expect } from 'vitest'
import { backtestPortfolio, type Bar } from '@/lib/services/backtest'
import { replayScenario, runScenario, type ScenarioSpec } from '@/lib/services/scenario-engine'
import { DEFAULT_COST_MODEL } from '@/lib/services/costs'
import { MODEL_VERSIONS } from '@/lib/services/result-metadata'

// 4.9 (4/4) — the portfolio backtest is a scenario-engine policy replayed over
// history. Synthetic prices only.

const day = (d: number) => new Date(Date.UTC(2024, 0, 1) + d * 86_400_000).toISOString().slice(0, 10)
const bars = (prices: number[]): Bar[] => prices.map((close, d) => ({ date: day(d), close }))

describe('replayScenario', () => {
  // A doubles by day 40, B stays flat: a 50/50 book drifts to 2/3 – 1/3.
  const A = bars(Array.from({ length: 41 }, (_, d) => 100 + (100 * d) / 40))
  const B = bars(Array.from({ length: 41 }, () => 100))
  const policy = (costPct: number) => ({
    capital: 1_000,
    holdings: [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }],
    rebalance: 'monthly' as const,
    costs: { ...DEFAULT_COST_MODEL, commissionPct: costPct, source: 'prueba' },
  })

  it('pays the trade cost on both legs of a rebalance', () => {
    // Day 30: A is worth 1.75 of its start, the book 500·1.75 + 500 = 1,375.
    // Back to 50/50 means selling 187.50 of A and buying 187.50 of B: 375
    // traded, 1% on each leg — 1.875 each, which the cost model settles to the
    // cent per trade (1.88), so 3.76. Model 1.x charged 1.875 once.
    const replay = replayScenario(policy(1), { A, B })!
    expect(replay.rebalanceCount).toBe(1)
    expect(replay.totalCosts).toBeCloseTo(2 * 1.88, 10)
  })

  it('charges nothing without a cost, and opens the book at its weights', () => {
    const replay = replayScenario(policy(0), { A, B })!
    expect(replay.totalCosts).toBe(0)
    expect(replay.curve[0].value).toBeCloseTo(1_000, 10)
  })

  it('refuses a policy it cannot hold', () => {
    expect(replayScenario({ ...policy(0), holdings: [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.2 }] }, { A, B })).toBeNull()
    expect(replayScenario(policy(0), { A, B: [] })).toBeNull()
  })
})

describe('backtestPortfolio is the replay', () => {
  it('reports the replay\'s curve, costs and rebalances', () => {
    const A = bars(Array.from({ length: 200 }, (_, d) => 100 * (1 + 0.002 * d + 0.03 * Math.sin(d / 7))))
    const B = bars(Array.from({ length: 200 }, (_, d) => 100 * (1 + 0.001 * d - 0.02 * Math.cos(d / 5))))
    const result = backtestPortfolio({ A, B }, { A: 0.6, B: 0.4 }, { rebalance: 'quarterly', costPct: 0.2, initialCapital: 10_000 })!
    const replay = replayScenario(
      {
        capital: 10_000,
        holdings: [{ symbol: 'A', weight: 0.6 }, { symbol: 'B', weight: 0.4 }],
        rebalance: 'quarterly',
        costs: { ...DEFAULT_COST_MODEL, commissionPct: 0.2, source: 'prueba' },
      },
      { A, B },
    )!
    expect(result.rebalanceCount).toBe(replay.rebalanceCount)
    expect(result.totalCosts).toBeCloseTo(replay.totalCosts, 2)
    expect(result.finalValue).toBeCloseTo(replay.curve[replay.curve.length - 1].value, 2)
  })

  it('carries the new model version, because costs moved', () => {
    expect(MODEL_VERSIONS.backtest).toBe('2.0.0')
  })
})

describe('the simulated engine takes the same calendars', () => {
  const flat = (rebalance: ScenarioSpec['rebalance']): ScenarioSpec => ({
    capital: 1_000,
    holdings: [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }],
    horizonMonths: 12,
    risk: { expectedReturns: [0.2, 0], volatilities: [0, 0], correlation: [[1, 0], [0, 1]], source: 'prueba' },
    rebalance,
    simulations: 1,
    seed: 1,
  })

  it('rebalances quarterly and semiannually as well as monthly and annually', () => {
    const finals = (['none', 'monthly', 'quarterly', 'semiannual', 'annual'] as const).map((r) => {
      const result = runScenario(flat(r))
      if ('errors' in result) throw new Error(result.errors.join(' '))
      return result.final.nominal.p50
    })
    // With a rising asset and a flat one, rebalancing more often sells more of
    // the winner: the more frequent the calendar, the lower the final value.
    for (let i = 2; i < finals.length; i++) expect(finals[i]).toBeGreaterThanOrEqual(finals[i - 1] - 1e-9)
    expect(finals[0]).toBeGreaterThan(finals[1])
  })
})
