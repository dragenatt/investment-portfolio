import { describe, it, expect } from 'vitest'
import { compareModels, describeModelComparison, evaluateWeights, MODEL_IDS, type ModelComparisonInput } from '@/lib/services/model-comparison'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { historicalExpectedReturns } from '@/lib/services/optimizer'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const T = 300

function noise(seed: number, sd: number, drift = 0): number[] {
  const random = mulberry32(seed)
  return Array.from({ length: T }, () => drift + standardNormal(random) * sd)
}
const add = (...series: number[][]) => series[0].map((_, t) => series.reduce((s, x) => s + x[t], 0))
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

function input(overrides: Partial<ModelComparisonInput> = {}): ModelComparisonInput {
  const market = noise(1, 0.009, 0.0003)
  const returnsMatrix = [
    add(market, noise(2, 0.012, 0.0006)), // volatile grower
    add(market, noise(3, 0.006, 0.0002)),
    add(noise(4, 0.003, 0.0001), market.map((m) => m * 0.1)), // defensive
    add(market, noise(5, 0.01, -0.0001)), // volatile and flat
  ]
  const symbols = ['GROW', 'CORE', 'BOND', 'FLAT']
  const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * 252))
  const estimatedReturns = historicalExpectedReturns(returnsMatrix)!
  const years = T / 252
  const ranges = symbols.map((symbol, i) => {
    const se = Math.sqrt(cov[i][i]) / Math.sqrt(years)
    return { symbol, low: estimatedReturns[i] - se, high: estimatedReturns[i] + se }
  })
  return {
    symbols,
    returnsMatrix,
    cov,
    estimatedReturns,
    riskFreeRate: 0.04,
    currentWeights: [0.4, 0.3, 0.2, 0.1],
    ranges,
    ...overrides,
  }
}

describe('compareModels', () => {
  const base = input()
  const comparison = compareModels(base)!
  const model = (id: string) => comparison.models.find((m) => m.id === id)!

  it('runs all five models and measures every one with the same ruler', () => {
    expect(comparison.models.map((m) => m.id)).toEqual([...MODEL_IDS])
    expect(comparison.unavailable).toEqual([])
    for (const m of comparison.models) {
      expect(sum(m.weights.map((w) => w.weight))).toBeCloseTo(1, 9)
      expect(m.weights.every((w) => w.weight >= 0)).toBe(true)
      for (const value of [m.estimatedReturnPct, m.volatilityPct, m.sharpe!, m.var95Pct!, m.cvar95Pct!, m.estimatedMaxDrawdownPct, m.concentration.hhi]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      // Expected shortfall is never smaller than the VaR it lies beyond.
      expect(m.cvar95Pct!).toBeGreaterThanOrEqual(m.var95Pct! - 1e-12)
    }
  })

  it('lets each model win on its own objective — which is why none is called superior', () => {
    const markowitz = model('markowitz')
    for (const m of comparison.models) expect(markowitz.sharpe!).toBeGreaterThanOrEqual(m.sharpe! - 0.02)
    expect(model('minCVaR').cvar95Pct!).toBeLessThanOrEqual(model('riskParity').cvar95Pct! + 1e-9)
  })

  it('gives risk parity equal risk contributions', () => {
    const w = model('riskParity').weights.map((x) => x.weight)
    const contributions = w.map((wi, i) => wi * base.cov[i].reduce((s, c, j) => s + c * w[j], 0))
    const mean = sum(contributions) / contributions.length
    for (const c of contributions) expect(c / mean).toBeCloseTo(1, 3)
  })

  it('returns the current weights from Black-Litterman with no views, as the model defines', () => {
    const bl = model('blackLitterman').weights.map((x) => x.weight)
    base.currentWeights!.forEach((w, i) => expect(bl[i]).toBeCloseTo(w, 3))
    comparison.current!.weights.forEach((x, i) => expect(x.weight).toBeCloseTo(base.currentWeights![i], 12))
  })

  it('reports how far the models disagree on each holding, widest first', () => {
    const spread = comparison.weightSpread
    expect(spread.map((s) => s.symbol).sort()).toEqual([...base.symbols].sort())
    for (let i = 1; i < spread.length; i++) expect(spread[i - 1].spreadPp).toBeGreaterThanOrEqual(spread[i].spreadPp)
    for (const s of spread) expect(s.spreadPp).toBeCloseTo(s.maxPct - s.minPct, 9)
  })

  it('describes agreement and disagreement without naming a winner or advising a trade', () => {
    expect(comparison.summary).toContain(comparison.weightSpread[0].symbol)
    expect(comparison.summary.toLowerCase()).not.toMatch(/mejor|superior|recomend|deber[ií]as|compra|vend/)
    expect(comparison.caveat).toContain('Ningún modelo es superior')
  })

  it('names the models it could not run, and why, instead of dropping them silently', () => {
    const partial = compareModels(input({ ranges: null, currentWeights: null }))!
    expect(partial.models.map((m) => m.id)).toEqual(['markowitz', 'minCVaR', 'riskParity'])
    expect(partial.unavailable.map((u) => u.id)).toEqual(['blackLitterman', 'robust'])
    expect(partial.unavailable.every((u) => u.reason.length > 10)).toBe(true)
    expect(partial.current).toBeNull()
  })

  it('needs at least two holdings', () => {
    const one = input()
    expect(compareModels({ ...one, symbols: ['GROW'], returnsMatrix: [one.returnsMatrix[0]], cov: [[one.cov[0][0]]], estimatedReturns: [one.estimatedReturns[0]] })).toBeNull()
  })
})

describe('evaluateWeights', () => {
  const base = input()

  it('computes volatility from the covariance and drawdown from the daily-rebalanced path', () => {
    const e = evaluateWeights(base, [1, 0, 0, 0])!
    expect(e.volatilityPct).toBeCloseTo(Math.sqrt(base.cov[0][0]) * 100, 9)
    expect(e.estimatedReturnPct).toBeCloseTo(base.estimatedReturns[0] * 100, 9)
    expect(e.concentration).toEqual({ hhi: 1, effectiveHoldings: 1, maxWeightPct: 100, maxWeightSymbol: 'GROW' })

    // Drawdown of the single-asset path, computed by hand.
    let value = 1
    let peak = 1
    let worst = 0
    for (const r of base.returnsMatrix[0]) {
      value *= 1 + r
      peak = Math.max(peak, value)
      worst = Math.max(worst, (peak - value) / peak)
    }
    expect(e.estimatedMaxDrawdownPct).toBeCloseTo(worst * 100, 9)
  })

  it('normalises weights and refuses shorts, NaN and an empty book', () => {
    expect(evaluateWeights(base, [2, 2, 2, 2])!.concentration.effectiveHoldings).toBeCloseTo(4, 9)
    expect(evaluateWeights(base, [1.2, -0.2, 0, 0])).toBeNull()
    expect(evaluateWeights(base, [NaN, 1, 0, 0])).toBeNull()
    expect(evaluateWeights(base, [0, 0, 0, 0])).toBeNull()
    expect(evaluateWeights(base, [1, 0])).toBeNull()
  })
})

describe('describeModelComparison', () => {
  it('says so when the models land in the same place', () => {
    const models = compareModels(input())!.models
    const flat = models.map((m) => ({ ...m }))
    const spread = [{ symbol: 'GROW', minPct: 24, maxPct: 27, spreadPp: 3 }]
    expect(describeModelComparison(flat, spread)).toContain('llegan a pesos parecidos')
  })
})
