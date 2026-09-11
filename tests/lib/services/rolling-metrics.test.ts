import { describe, it, expect } from 'vitest'
import {
  rollingVolatility,
  rollingCorrelation,
  rollingSharpe,
  rollingRiskSeries,
  detectStressPeriods,
} from '@/lib/services/rolling-metrics'

/** Alternating +/- r: constant volatility, zero mean. */
const steady = (n: number, r = 0.01) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? r : -r))

/** Calm for `calm` bars, then `loud` bars of four times the amplitude. */
function regimeShift(calm: number, loud: number): number[] {
  return [...steady(calm, 0.005), ...steady(loud, 0.02)]
}

/** Calm, a short burst of four times the amplitude, then calm again. */
const stressBurst = () => [...steady(90, 0.005), ...steady(15, 0.02), ...steady(15, 0.005)]

const dates = (n: number, from = '2025-01-01') =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

describe('rollingVolatility', () => {
  it('reports null until a full window exists, never a partial number', () => {
    // The roadmap is explicit: do not return NaN silently when data is missing.
    // Null is the honest answer for a window that has not filled yet.
    const result = rollingVolatility(steady(10), 5)
    expect(result.slice(0, 4).every((v) => v === null)).toBe(true)
    expect(result[4]).not.toBeNull()
  })

  it('returns one value per input observation', () => {
    expect(rollingVolatility(steady(30), 10)).toHaveLength(30)
  })

  it('is constant for a series whose volatility does not change', () => {
    const result = rollingVolatility(steady(40), 10).filter((v): v is number => v !== null)
    const first = result[0]
    for (const value of result) expect(value).toBeCloseTo(first, 10)
  })

  it('rises when the series gets choppier', () => {
    const result = rollingVolatility(regimeShift(40, 40), 20)
    expect(result[39]).not.toBeNull()
    expect(result[79]).not.toBeNull()
    expect(result[79]!).toBeGreaterThan(result[39]! * 3)
  })

  it('annualises by default and can be asked not to', () => {
    const annual = rollingVolatility(steady(30), 10)[29]!
    const daily = rollingVolatility(steady(30), 10, { annualise: false })[29]!
    expect(annual / daily).toBeCloseTo(Math.sqrt(252), 8)
  })

  it('returns all nulls when the window is longer than the series', () => {
    expect(rollingVolatility(steady(5), 20).every((v) => v === null)).toBe(true)
  })

  it('refuses a window smaller than two observations', () => {
    expect(rollingVolatility(steady(10), 1).every((v) => v === null)).toBe(true)
  })

  it('never emits a non-finite number', () => {
    const messy = [0.01, Number.NaN, -0.01, 0.02, Number.POSITIVE_INFINITY, 0.01, -0.02, 0.01]
    for (const value of rollingVolatility(messy, 3)) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })
})

describe('rollingCorrelation', () => {
  it('is 1 for a series against itself', () => {
    const series = steady(30)
    const result = rollingCorrelation(series, series, 10)
    expect(result[29]!).toBeCloseTo(1, 8)
  })

  it('is -1 against its own negation', () => {
    const series = steady(30)
    const result = rollingCorrelation(series, series.map((r) => -r), 10)
    expect(result[29]!).toBeCloseTo(-1, 8)
  })

  it('stays inside -1 and 1 throughout', () => {
    const a = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 0.01)
    const b = Array.from({ length: 60 }, (_, i) => Math.cos(i / 5) * 0.015)
    for (const value of rollingCorrelation(a, b, 20)) {
      if (value === null) continue
      expect(value).toBeGreaterThanOrEqual(-1.000001)
      expect(value).toBeLessThanOrEqual(1.000001)
    }
  })

  it('reports null rather than a number when one side has no variation', () => {
    const flat = Array(30).fill(0.01)
    expect(rollingCorrelation(steady(30), flat, 10)[29]).toBeNull()
  })

  it('refuses series of different lengths', () => {
    expect(rollingCorrelation(steady(30), steady(20), 10)).toEqual([])
  })
})

describe('rollingSharpe', () => {
  it('is null while the window is not full', () => {
    expect(rollingSharpe(steady(20), 10, 0.04)[8]).toBeNull()
  })

  it('is negative when the series earns less than the risk-free rate', () => {
    // Zero mean return against a positive risk-free rate
    expect(rollingSharpe(steady(40), 20, 0.05)[39]!).toBeLessThan(0)
  })

  it('rises when the same return comes with less volatility', () => {
    const calm = Array.from({ length: 40 }, (_, i) => 0.001 + (i % 2 === 0 ? 0.001 : -0.001))
    const wild = Array.from({ length: 40 }, (_, i) => 0.001 + (i % 2 === 0 ? 0.01 : -0.01))
    expect(rollingSharpe(calm, 20, 0)[39]!).toBeGreaterThan(rollingSharpe(wild, 20, 0)[39]!)
  })

  it('reports null rather than dividing by a flat window', () => {
    expect(rollingSharpe(Array(30).fill(0.001), 10, 0)[29]).toBeNull()
  })
})

describe('rollingRiskSeries', () => {
  const returns = regimeShift(60, 60)
  const points = dates(120)

  it('pairs every metric with the date it belongs to', () => {
    const result = rollingRiskSeries(points, returns, { window: 30 })!
    expect(result.points).toHaveLength(120)
    expect(result.points[0].date).toBe(points[0])
    expect(result.window).toBe(30)
  })

  it('leaves the warmup explicitly empty rather than guessing', () => {
    const result = rollingRiskSeries(points, returns, { window: 30 })!
    expect(result.points[0].volatilityPct).toBeNull()
    expect(result.points[29].volatilityPct).not.toBeNull()
    expect(result.observationsUsed).toBe(120 - 29)
  })

  it('includes a benchmark correlation when a benchmark is supplied', () => {
    const benchmark = steady(120, 0.008)
    const result = rollingRiskSeries(points, returns, { window: 30, benchmarkReturns: benchmark })!
    expect(result.points[119].correlation).not.toBeNull()
  })

  it('leaves correlation null when no benchmark is supplied', () => {
    const result = rollingRiskSeries(points, returns, { window: 30 })!
    expect(result.points[119].correlation).toBeNull()
  })

  it('refuses a series whose dates and returns do not line up', () => {
    expect(rollingRiskSeries(dates(50), returns, { window: 30 })).toBeNull()
  })

  it('refuses a series too short for even one window', () => {
    expect(rollingRiskSeries(dates(10), steady(10), { window: 30 })).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { window: 30 }
    expect(rollingRiskSeries(points, returns, opts)).toEqual(
      rollingRiskSeries(points, returns, opts),
    )
  })
})

describe('detectStressPeriods', () => {
  const returns = stressBurst()
  const points = dates(120)

  it('finds the stretch where volatility spiked', () => {
    const series = rollingRiskSeries(points, returns, { window: 30 })!
    const periods = detectStressPeriods(series)
    expect(periods.length).toBeGreaterThan(0)
    // The burst starts at index 90; the window means it is detected after that
    expect(periods[0].fromDate >= points[90]).toBe(true)
  })

  it('does not call a permanent change of regime a stress period', () => {
    // A series that is calm for half its life and four times louder for the
    // other half has no single "normal" to spike above — the median lands inside
    // the transition, and the loud half IS the new normal. Reporting that as
    // stress would be describing a regime change as a passing episode. Rolling
    // volatility already shows the shift; this function is for spikes.
    const series = rollingRiskSeries(points, regimeShift(60, 60), { window: 30 })!
    expect(detectStressPeriods(series)).toEqual([])
  })

  it('finds nothing in a series whose volatility never changes', () => {
    const calm = rollingRiskSeries(dates(120), steady(120), { window: 30 })!
    expect(detectStressPeriods(calm)).toEqual([])
  })

  it('reports how far above normal each stretch ran', () => {
    const series = rollingRiskSeries(points, returns, { window: 30 })!
    for (const period of detectStressPeriods(series)) {
      expect(period.peakVolatilityPct).toBeGreaterThan(period.medianVolatilityPct)
      expect(period.multipleOfNormal).toBeGreaterThan(1)
    }
  })

  it('gives each stretch a readable label', () => {
    const series = rollingRiskSeries(points, returns, { window: 30 })!
    for (const period of detectStressPeriods(series)) {
      expect(period.label.length).toBeGreaterThan(20)
    }
  })

  it('handles a series with no usable points', () => {
    expect(detectStressPeriods({ window: 30, observationsUsed: 0, points: [] })).toEqual([])
  })
})

describe('annualisation follows the data, not a constant', () => {
  it('scales by the periods per year it is given', () => {
    // The risk endpoint was fed WEEKLY bars and annualised them by 252,
    // rendering a portfolio at 224% volatility and calling a 30-week window
    // "30 days". Nothing here may hardcode the trading year any more.
    const weeklyish = rollingVolatility(steady(60), 20, { periodsPerYear: 52 })[59]!
    const dailyish = rollingVolatility(steady(60), 20, { periodsPerYear: 252 })[59]!
    expect(dailyish / weeklyish).toBeCloseTo(Math.sqrt(252 / 52), 8)
  })

  it('still defaults to the trading year', () => {
    const explicit = rollingVolatility(steady(60), 20, { periodsPerYear: 252 })[59]!
    expect(rollingVolatility(steady(60), 20)[59]!).toBeCloseTo(explicit, 12)
  })

  it('carries the same scaling into Sharpe', () => {
    const weekly = rollingSharpe(steady(60, 0.01), 20, 0.05, 52)[59]
    const daily = rollingSharpe(steady(60, 0.01), 20, 0.05, 252)[59]
    expect(weekly).not.toBeCloseTo(daily!, 6)
  })

  it('refuses a nonsensical periods-per-year rather than producing a number', () => {
    expect(rollingVolatility(steady(60), 20, { periodsPerYear: 0 }).every((v) => v === null)).toBe(true)
    expect(rollingVolatility(steady(60), 20, { periodsPerYear: -12 }).every((v) => v === null)).toBe(true)
  })
})
