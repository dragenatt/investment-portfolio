import { describe, it, expect } from 'vitest'
import {
  HORIZONS,
  multiHorizonReturns,
  calculateSortinoRatio,
  assetRiskMetrics,
} from '@/lib/services/asset-metrics'
import type { PriceBar } from '@/lib/services/stress-testing'

/** Daily bars ending on `asOf`, compounding at a constant rate backwards. */
function history(asOf: string, days: number, endClose: number, dailyRate: number): PriceBar[] {
  const bars: PriceBar[] = []
  const cursor = new Date(`${asOf}T00:00:00Z`)
  let close = endClose
  for (let i = 0; i < days; i++) {
    bars.unshift({ date: cursor.toISOString().slice(0, 10), close })
    close /= 1 + dailyRate
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return bars
}

const ASOF = '2025-06-30'

describe('HORIZONS', () => {
  it('covers every window the roadmap asks for', () => {
    expect(HORIZONS.map((h) => h.id)).toEqual([
      '1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y',
    ])
  })

  it('gives each horizon a readable label', () => {
    for (const horizon of HORIZONS) expect(horizon.label.length).toBeGreaterThan(0)
  })
})

describe('multiHorizonReturns', () => {
  const bars = history(ASOF, 2000, 200, 0.0005)

  it('returns one entry per horizon', () => {
    expect(multiHorizonReturns(bars)).toHaveLength(HORIZONS.length)
  })

  it('measures the one-day move from the previous bar', () => {
    const result = multiHorizonReturns(bars).find((r) => r.id === '1D')!
    expect(result.returnPct!).toBeCloseTo(0.05, 6)
  })

  it('gives a larger number for a longer window when the trend is up', () => {
    const result = multiHorizonReturns(bars)
    const month = result.find((r) => r.id === '1M')!.returnPct!
    const year = result.find((r) => r.id === '1Y')!.returnPct!
    expect(year).toBeGreaterThan(month)
  })

  it('reports null for a window the history does not reach', () => {
    const short = history(ASOF, 40, 100, 0.001)
    const result = multiHorizonReturns(short)
    expect(result.find((r) => r.id === '1M')!.returnPct).not.toBeNull()
    expect(result.find((r) => r.id === '5Y')!.returnPct).toBeNull()
  })

  it('annualises the windows longer than a year and leaves the rest cumulative', () => {
    const result = multiHorizonReturns(bars)
    const threeYear = result.find((r) => r.id === '3Y')!
    expect(threeYear.annualisedPct).not.toBeNull()
    expect(result.find((r) => r.id === '1M')!.annualisedPct).toBeNull()
  })

  it('measures YTD from the last bar of the previous year', () => {
    const bars2025: PriceBar[] = [
      { date: '2024-12-31', close: 100 },
      { date: '2025-03-01', close: 120 },
      { date: '2025-06-30', close: 150 },
    ]
    const result = multiHorizonReturns(bars2025).find((r) => r.id === 'YTD')!
    expect(result.returnPct!).toBeCloseTo(50, 6)
  })

  it('never emits a non-finite number', () => {
    for (const entry of multiHorizonReturns(bars)) {
      expect(entry.returnPct === null || Number.isFinite(entry.returnPct)).toBe(true)
      expect(entry.annualisedPct === null || Number.isFinite(entry.annualisedPct)).toBe(true)
    }
  })

  it('returns all nulls rather than guessing from a single bar', () => {
    const result = multiHorizonReturns([{ date: ASOF, close: 100 }])
    expect(result.every((r) => r.returnPct === null)).toBe(true)
  })

  it('handles an empty history', () => {
    expect(multiHorizonReturns([]).every((r) => r.returnPct === null)).toBe(true)
  })

  it('refuses a zero starting price rather than dividing by it', () => {
    const broken: PriceBar[] = [
      { date: '2025-06-27', close: 0 },
      { date: '2025-06-30', close: 50 },
    ]
    expect(multiHorizonReturns(broken).find((r) => r.id === '1D')!.returnPct).toBeNull()
  })
})

describe('calculateSortinoRatio', () => {
  it('penalises only the downside, so it exceeds Sharpe when losses are rare', () => {
    // Mostly small gains with one loss: downside deviation is far below total
    const returns = Array.from({ length: 100 }, (_, i) => (i % 20 === 0 ? -0.02 : 0.002))
    expect(calculateSortinoRatio(returns, 0)).toBeGreaterThan(0)
  })

  it('is negative when the series loses to the risk-free rate', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.001 : -0.002))
    expect(calculateSortinoRatio(returns, 0.05)).toBeLessThan(0)
  })

  it('reports null rather than a number when nothing ever fell', () => {
    // No downside means no downside deviation; the ratio is undefined, and the
    // old code answered 3 or 0, which were both inventions
    expect(calculateSortinoRatio(Array(50).fill(0.001), 0)).toBeNull()
  })

  it('reports null for a series too short to say anything', () => {
    expect(calculateSortinoRatio([0.01], 0)).toBeNull()
  })

  it('never emits a non-finite number', () => {
    const value = calculateSortinoRatio(
      Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? -0.001 : 0.0005)),
      0.03,
    )
    expect(value === null || Number.isFinite(value)).toBe(true)
  })
})

describe('assetRiskMetrics', () => {
  const bars = history(ASOF, 400, 200, 0.0004)
  const benchmark = history(ASOF, 400, 500, 0.0003)

  it('reports every metric the roadmap asks for', () => {
    const result = assetRiskMetrics(bars, benchmark, 0.04)!
    expect(result).toHaveProperty('volatilityPct')
    expect(result).toHaveProperty('beta')
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('sortino')
    expect(result).toHaveProperty('maxDrawdownPct')
    expect(result).toHaveProperty('var95Pct')
  })

  it('reports a beta of roughly 1 against a series that moves with it', () => {
    const result = assetRiskMetrics(bars, bars, 0.04)!
    expect(result.beta!).toBeCloseTo(1, 4)
  })

  it('leaves beta null when there is no benchmark to compare against', () => {
    expect(assetRiskMetrics(bars, [], 0.04)!.beta).toBeNull()
  })

  it('reports a positive drawdown for a series that fell', () => {
    const falling: PriceBar[] = [
      ...history('2025-03-31', 100, 200, 0.001),
      ...history(ASOF, 90, 120, -0.001),
    ]
    expect(assetRiskMetrics(falling, [], 0.04)!.maxDrawdownPct).toBeGreaterThan(0)
  })

  it('never emits a non-finite number', () => {
    const result = assetRiskMetrics(bars, benchmark, 0.04)!
    for (const value of Object.values(result)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('returns null for a history too short to measure risk from', () => {
    expect(assetRiskMetrics(history(ASOF, 3, 100, 0.001), [], 0.04)).toBeNull()
  })

  it('is deterministic', () => {
    expect(assetRiskMetrics(bars, benchmark, 0.04)).toEqual(
      assetRiskMetrics(bars, benchmark, 0.04),
    )
  })
})
