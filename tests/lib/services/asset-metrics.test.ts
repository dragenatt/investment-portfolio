import { describe, it, expect } from 'vitest'
import {
  HORIZONS,
  multiHorizonReturns,
  calculateSortinoRatio,
  assetRiskMetrics,
  detectCadence,
  mergeHorizons,
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

// ─── Bar cadence ────────────────────────────────────────────────────────────
//
// Regression suite for a bug that reached production. The provider returns
// MONTHLY bars for any range long enough to cover five years, and every
// function here assumed daily. The S&P 500 was rendered at 70.7% annual
// volatility (sqrt(252) applied to monthly returns inflates by sqrt(21)),
// Sharpe 3.34, a VaR labelled "1 day" that was a month, and every horizon from
// 1M up reading n/d while five years of data sat right there.
//
// The tests passed because every fixture was daily.

/** Bars `stepDays` apart, ending on `asOf`. */
function spaced(asOf: string, count: number, stepDays: number, endClose: number, ratePerBar: number) {
  const bars: { date: string; close: number }[] = []
  const cursor = new Date(`${asOf}T00:00:00Z`)
  let close = endClose
  for (let i = 0; i < count; i++) {
    bars.unshift({ date: cursor.toISOString().slice(0, 10), close })
    close /= 1 + ratePerBar
    cursor.setUTCDate(cursor.getUTCDate() - stepDays)
  }
  return bars
}

const monthly = (count = 61) => spaced('2026-09-11', count, 30, 200, 0.01)
const daily = (count = 200) => spaced('2026-09-11', count, 1, 200, 0.001)

describe('detectCadence', () => {
  it('recognises daily bars', () => {
    const cadence = detectCadence(daily())!
    expect(cadence.periodsPerYear).toBe(252)
    expect(cadence.label).toMatch(/día/i)
  })

  it('recognises monthly bars', () => {
    const cadence = detectCadence(monthly())!
    expect(cadence.periodsPerYear).toBe(12)
    expect(cadence.label).toMatch(/mes/i)
  })

  it('recognises weekly bars', () => {
    expect(detectCadence(spaced('2026-09-11', 60, 7, 200, 0.002))!.periodsPerYear).toBe(52)
  })

  it('treats a daily series with weekend gaps as daily', () => {
    // Real daily market data has 3-day gaps every weekend; the median is 1.
    const bars: { date: string; close: number }[] = []
    const cursor = new Date('2025-01-01T00:00:00Z')
    for (let i = 0; i < 120; i++) {
      const day = cursor.getUTCDay()
      if (day !== 0 && day !== 6) bars.push({ date: cursor.toISOString().slice(0, 10), close: 100 + i })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    expect(detectCadence(bars)!.periodsPerYear).toBe(252)
  })

  it('returns null for a series too short to have a cadence', () => {
    expect(detectCadence([{ date: '2026-09-11', close: 100 }])).toBeNull()
  })
})

describe('assetRiskMetrics with monthly bars', () => {
  it('annualises by the actual cadence, not by 252', () => {
    // The bug: monthly returns annualised as daily inflate volatility by
    // sqrt(252/12) = sqrt(21) ~ 4.58. This pins that they no longer do.
    const monthlyMetrics = assetRiskMetrics(monthly(), [], 0.04)!
    const dailyMetrics = assetRiskMetrics(daily(), [], 0.04)!

    // Both series compound at a steady rate with tiny variation, so neither
    // should report a volatility anywhere near the 70% the bug produced.
    expect(monthlyMetrics.volatilityPct).toBeLessThan(20)
    expect(dailyMetrics.volatilityPct).toBeLessThan(20)
  })

  it('reports the cadence, so the interface can label VaR correctly', () => {
    // A VaR from monthly bars is a monthly VaR. Labelling it "1 day" in the UI
    // understates the loss by the square root of twenty-one.
    const metrics = assetRiskMetrics(monthly(), [], 0.04)!
    expect(metrics.cadence.periodsPerYear).toBe(12)
    expect(metrics.cadence.label).toMatch(/mes/i)
  })

  it('still reports daily cadence for daily bars', () => {
    expect(assetRiskMetrics(daily(), [], 0.04)!.cadence.periodsPerYear).toBe(252)
  })
})

describe('multiHorizonReturns with monthly bars', () => {
  it('reaches the long horizons it has the data for', () => {
    // Five years of monthly bars can absolutely answer "1 year" and "3 years".
    // The 7-day anchor tolerance rejected every one of them.
    const result = multiHorizonReturns(monthly())
    expect(result.find((r) => r.id === '1Y')!.returnPct).not.toBeNull()
    expect(result.find((r) => r.id === '3Y')!.returnPct).not.toBeNull()
  })

  it('refuses horizons shorter than its own resolution', () => {
    // "1 day" from monthly bars is not a one-day move. Reporting the last bar's
    // change under that label is the mislabelling that shipped.
    const result = multiHorizonReturns(monthly())
    expect(result.find((r) => r.id === '1D')!.returnPct).toBeNull()
    expect(result.find((r) => r.id === '1W')!.returnPct).toBeNull()
  })

  it('still answers the short horizons from daily bars', () => {
    const result = multiHorizonReturns(daily())
    expect(result.find((r) => r.id === '1D')!.returnPct).not.toBeNull()
    expect(result.find((r) => r.id === '1W')!.returnPct).not.toBeNull()
  })

  it('does not report the same number for two different horizons', () => {
    // 1D and 1W both reading +1.0% was the visible symptom.
    const result = multiHorizonReturns(daily())
    const oneDay = result.find((r) => r.id === '1D')!.returnPct
    const oneWeek = result.find((r) => r.id === '1W')!.returnPct
    expect(oneDay).not.toBeCloseTo(oneWeek!, 6)
  })
})

describe('mergeHorizons', () => {
  it('prefers the finer series where both can answer', () => {
    const fine = multiHorizonReturns(daily())
    const coarse = multiHorizonReturns(monthly())
    const merged = mergeHorizons(fine, coarse)

    const oneMonth = merged.find((r) => r.id === '1M')!
    const fineOneMonth = fine.find((r) => r.id === '1M')!
    expect(oneMonth.returnPct).toBe(fineOneMonth.returnPct)
  })

  it('falls back to the coarse series for horizons the fine one cannot reach', () => {
    const fine = multiHorizonReturns(daily(120))
    const coarse = multiHorizonReturns(monthly())
    const merged = mergeHorizons(fine, coarse)

    expect(fine.find((r) => r.id === '3Y')!.returnPct).toBeNull()
    expect(merged.find((r) => r.id === '3Y')!.returnPct).not.toBeNull()
  })

  it('keeps one entry per horizon, in order', () => {
    const merged = mergeHorizons(multiHorizonReturns(daily()), multiHorizonReturns(monthly()))
    expect(merged.map((r) => r.id)).toEqual(HORIZONS.map((h) => h.id))
  })

  it('handles a missing coarse series', () => {
    const fine = multiHorizonReturns(daily())
    expect(mergeHorizons(fine, null)).toEqual(fine)
  })
})

// ─── Anchoring, found by looking at the real page ───────────────────────────
//
// Two horizons read n/d on the live S&P 500 page while the data sat right
// there. Both were anchoring bugs, not missing data.

describe('horizon anchoring edge cases', () => {
  it('anchors YTD one bar back when a bar falls exactly on 1 January', () => {
    // The monthly series has a bar dated exactly 2026-01-01. The old code found
    // it, saw it was not in the previous year, and gave up — instead of
    // stepping back to the December bar, which is the anchor it wanted.
    const bars = [
      { date: '2025-11-01', close: 90 },
      { date: '2025-12-01', close: 100 },
      { date: '2026-01-01', close: 105 },
      { date: '2026-06-01', close: 120 },
      { date: '2026-09-11', close: 150 },
    ]
    const ytd = multiHorizonReturns(bars).find((r) => r.id === 'YTD')!
    expect(ytd.returnPct).not.toBeNull()
    // Measured from the last close of 2025, not from the January bar
    expect(ytd.fromDate).toBe('2025-12-01')
    expect(ytd.returnPct!).toBeCloseTo(50, 6)
  })

  it('still anchors YTD normally when no bar lands on 1 January', () => {
    const bars = [
      { date: '2025-12-31', close: 100 },
      { date: '2026-03-02', close: 110 },
      { date: '2026-09-11', close: 125 },
    ]
    const ytd = multiHorizonReturns(bars).find((r) => r.id === 'YTD')!
    expect(ytd.fromDate).toBe('2025-12-31')
    expect(ytd.returnPct!).toBeCloseTo(25, 6)
  })

  it('accepts an anchor just AFTER the target when none exists before it', () => {
    // Five years back from 2026-09-11 is 2021-09-11, and the earliest monthly
    // bar is 2021-10-01 — twenty days later, well inside the tolerance for
    // monthly data. Looking only backwards found nothing and reported n/d.
    const bars: { date: string; close: number }[] = []
    const cursor = new Date('2021-10-01T00:00:00Z')
    let close = 100
    while (cursor <= new Date('2026-09-11T00:00:00Z')) {
      bars.push({ date: cursor.toISOString().slice(0, 10), close })
      close *= 1.01
      cursor.setUTCDate(cursor.getUTCDate() + 30)
    }
    const fiveYear = multiHorizonReturns(bars).find((r) => r.id === '5Y')!
    expect(fiveYear.returnPct).not.toBeNull()
    expect(fiveYear.annualisedPct).not.toBeNull()
  })

  it('still refuses an anchor that is outside the tolerance', () => {
    // Eight months of daily data cannot answer "5 years" by stretching to its
    // own first bar. That was the original rule and it still holds.
    const short = history('2026-09-11', 240, 100, 0.001)
    expect(multiHorizonReturns(short).find((r) => r.id === '5Y')!.returnPct).toBeNull()
  })
})

describe('risk metrics carry their own window', () => {
  it('reports the dates the risk was actually measured over', () => {
    // The risk numbers come from a six-month DAILY series while the horizon
    // table reaches five years on a monthly one. Pairing the risk observation
    // count with the performance date range read as "127 daily periods from
    // 2021 to 2026", which is two different windows in one sentence.
    const bars = history('2026-09-11', 127, 200, 0.0004)
    const metrics = assetRiskMetrics(bars, [], 0.04)!
    expect(metrics.fromDate).toBe(bars[0].date)
    expect(metrics.toDate).toBe(bars[bars.length - 1].date)
  })
})
