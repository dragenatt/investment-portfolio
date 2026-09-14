import { describe, it, expect } from 'vitest'
import {
  runFactorRegression,
  FACTOR_DEFINITIONS,
  describeFactorExposure,
  buildFactorReturns,
  type FactorBar,
} from '@/lib/services/factors'

/** Deterministic pseudo-normal noise — no Math.random in a test, ever. */
function noise(n: number, scale: number, seed: number): number[] {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: n }, () => {
    const u1 = Math.max(next(), 1e-12)
    const u2 = next()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale
  })
}

const marketFactor = noise(400, 0.01, 1)
const sizeFactor = noise(400, 0.006, 2)
const valueFactor = noise(400, 0.005, 3)

describe('FACTOR_DEFINITIONS', () => {
  it('documents what every factor is built from', () => {
    expect(FACTOR_DEFINITIONS.length).toBeGreaterThanOrEqual(3)
    for (const factor of FACTOR_DEFINITIONS) {
      expect(factor.construction.length).toBeGreaterThan(30)
      expect(factor.meaning.length).toBeGreaterThan(30)
      expect(factor.symbols.length).toBeGreaterThan(0)
    }
  })

  it('says plainly that these are ETF proxies, not the academic factors', () => {
    for (const factor of FACTOR_DEFINITIONS) {
      expect(factor.isProxy).toBe(true)
    }
  })

  it('gives every factor a unique id', () => {
    const ids = FACTOR_DEFINITIONS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('runFactorRegression', () => {
  it('recovers a single factor exactly when the relationship is exact', () => {
    const y = marketFactor.map((m) => 2 * m)
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!

    expect(result.loadings[0].coefficient).toBeCloseTo(2, 8)
    expect(result.rSquared).toBeCloseTo(1, 8)
    expect(result.alphaAnnualPct).toBeCloseTo(0, 6)
  })

  it('recovers several coefficients at once', () => {
    const y = marketFactor.map((m, i) => 1.2 * m - 0.4 * sizeFactor[i] + 0.3 * valueFactor[i])
    const result = runFactorRegression(y, [
      { name: 'market', returns: marketFactor },
      { name: 'size', returns: sizeFactor },
      { name: 'value', returns: valueFactor },
    ])!

    const by = Object.fromEntries(result.loadings.map((l) => [l.factor, l.coefficient]))
    expect(by.market).toBeCloseTo(1.2, 6)
    expect(by.size).toBeCloseTo(-0.4, 6)
    expect(by.value).toBeCloseTo(0.3, 6)
  })

  it('reports the standard error of the alpha, annualised like the alpha itself', () => {
    // Needed to draw a band around an alpha. Recovering it as alpha / tStat
    // divides by zero exactly when the estimated alpha is zero, which is the
    // most common and most important case to show.
    const noisy = marketFactor.map((m, i) => 0.9 * m + 0.004 * Math.sin(i * 1.7))
    const result = runFactorRegression(noisy, [{ name: 'market', returns: marketFactor }])!
    expect(result.alphaStandardErrorAnnualPct).toBeGreaterThan(0)
    expect(Number.isFinite(result.alphaStandardErrorAnnualPct)).toBe(true)
    if (result.alphaTStat !== null) {
      expect(result.alphaAnnualPct / result.alphaStandardErrorAnnualPct).toBeCloseTo(
        result.alphaTStat,
        8,
      )
    }
  })

  it('finds the intercept and annualises it', () => {
    // A constant 0.0002 daily edge on top of the factors
    const y = marketFactor.map((m) => 0.9 * m + 0.0002)
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!
    expect(result.alphaAnnualPct).toBeCloseTo(0.0002 * 252 * 100, 4)
  })

  it('recovers coefficients approximately when there is noise', () => {
    const disturbance = noise(400, 0.004, 99)
    const y = marketFactor.map((m, i) => 1.1 * m + disturbance[i])
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!

    expect(result.loadings[0].coefficient).toBeGreaterThan(0.9)
    expect(result.loadings[0].coefficient).toBeLessThan(1.3)
    expect(result.rSquared).toBeGreaterThan(0.3)
    expect(result.rSquared).toBeLessThan(1)
  })

  it('keeps R-squared inside 0 and 1', () => {
    const y = noise(400, 0.012, 55)
    const result = runFactorRegression(y, [
      { name: 'market', returns: marketFactor },
      { name: 'size', returns: sizeFactor },
    ])!
    expect(result.rSquared).toBeGreaterThanOrEqual(0)
    expect(result.rSquared).toBeLessThanOrEqual(1)
    expect(result.adjustedRSquared).toBeLessThanOrEqual(result.rSquared)
  })

  it('flags a loading that is indistinguishable from noise', () => {
    // A factor the series has nothing to do with should not read as exposure
    const y = noise(400, 0.01, 77)
    const result = runFactorRegression(y, [{ name: 'unrelated', returns: valueFactor }])!
    expect(result.loadings[0].significant).toBe(false)
  })

  it('flags a loading that is real', () => {
    const disturbance = noise(400, 0.002, 88)
    const y = marketFactor.map((m, i) => 1.4 * m + disturbance[i])
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!
    expect(result.loadings[0].significant).toBe(true)
    expect(Math.abs(result.loadings[0].tStat!)).toBeGreaterThan(2)
  })

  it('reports how much of the movement the factors do not explain', () => {
    const disturbance = noise(400, 0.005, 66)
    const y = marketFactor.map((m, i) => 1.0 * m + disturbance[i])
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!
    expect(result.residualVolatilityPct).toBeGreaterThan(0)
    expect(Number.isFinite(result.residualVolatilityPct)).toBe(true)
  })

  it('never emits a non-finite number', () => {
    const y = marketFactor.map((m) => 2 * m)
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!
    expect(Number.isFinite(result.alphaAnnualPct)).toBe(true)
    expect(Number.isFinite(result.rSquared)).toBe(true)
    expect(Number.isFinite(result.adjustedRSquared)).toBe(true)
    expect(Number.isFinite(result.residualVolatilityPct)).toBe(true)
    for (const loading of result.loadings) {
      expect(Number.isFinite(loading.coefficient)).toBe(true)
      expect(Number.isFinite(loading.standardError)).toBe(true)
      expect(loading.tStat === null || Number.isFinite(loading.tStat)).toBe(true)
    }
  })

  it('reports a perfect fit without producing an infinite t-statistic', () => {
    // Zero residual means zero standard error, and the naive ratio is Infinity.
    // That is significance in the limit, not a number to put on a screen.
    const y = marketFactor.map((m) => 2 * m)
    const result = runFactorRegression(y, [{ name: 'market', returns: marketFactor }])!
    expect(result.loadings[0].tStat === null || Number.isFinite(result.loadings[0].tStat)).toBe(true)
    expect(result.loadings[0].significant).toBe(true)
  })

  it('refuses two factors that are the same series', () => {
    // Perfectly collinear factors make the normal equations singular; there is
    // no unique answer and inventing one would be worse than refusing
    const y = marketFactor.map((m) => 2 * m)
    expect(
      runFactorRegression(y, [
        { name: 'a', returns: marketFactor },
        { name: 'b', returns: marketFactor },
      ]),
    ).toBeNull()
  })

  it('refuses a factor that never moves', () => {
    const y = marketFactor.map((m) => 2 * m)
    expect(
      runFactorRegression(y, [{ name: 'flat', returns: Array(400).fill(0.001) }]),
    ).toBeNull()
  })

  it('refuses too few observations for the number of factors', () => {
    const short = (n: number) => Array.from({ length: n }, (_, i) => i * 0.001)
    expect(
      runFactorRegression(short(4), [
        { name: 'a', returns: short(4) },
        { name: 'b', returns: short(4).map((v) => v * 2 + 0.001) },
        { name: 'c', returns: short(4).map((v) => v * 3) },
      ]),
    ).toBeNull()
  })

  it('refuses series of different lengths', () => {
    expect(
      runFactorRegression(marketFactor, [{ name: 'short', returns: sizeFactor.slice(0, 100) }]),
    ).toBeNull()
  })

  it('refuses a non-finite observation', () => {
    const broken = [...marketFactor]
    broken[7] = Number.NaN
    expect(runFactorRegression(broken, [{ name: 'market', returns: marketFactor }])).toBeNull()
  })

  it('refuses no factors at all', () => {
    expect(runFactorRegression(marketFactor, [])).toBeNull()
  })

  it('is deterministic', () => {
    const factors = [
      { name: 'market', returns: marketFactor },
      { name: 'size', returns: sizeFactor },
    ]
    expect(runFactorRegression(marketFactor, factors)).toEqual(
      runFactorRegression(marketFactor, factors),
    )
  })
})

describe('describeFactorExposure', () => {
  const base = {
    alphaAnnualPct: 1.2,
    alphaStandardErrorAnnualPct: 2.4,
    alphaTStat: 0.4,
    loadings: [
      { factor: 'market', coefficient: 1.1, standardError: 0.05, tStat: 22, significant: true },
      { factor: 'size', coefficient: 0.3, standardError: 0.2, tStat: 1.5, significant: false },
    ],
    rSquared: 0.82,
    adjustedRSquared: 0.81,
    residualVolatilityPct: 6.4,
    observations: 400,
  }

  it('names the factors that actually explain the portfolio', () => {
    const text = describeFactorExposure(base)
    expect(text.toLowerCase()).toMatch(/market|mercado/)
    expect(text.length).toBeGreaterThan(100)
  })

  it('refuses to present an insignificant alpha as skill', () => {
    const text = describeFactorExposure(base)
    // alpha t-stat of 0.4 is noise and the text must say so
    expect(text.toLowerCase()).toMatch(/no se distingue|ruido|casualidad|no es concluyente/)
  })

  it('reads a high R-squared differently from a low one', () => {
    const explained = describeFactorExposure(base)
    const unexplained = describeFactorExposure({ ...base, rSquared: 0.15, adjustedRSquared: 0.13 })
    expect(explained).not.toBe(unexplained)
  })

  it('mentions that these are ETF proxies', () => {
    expect(describeFactorExposure(base).toLowerCase()).toMatch(/etf|proxy|aproxima/)
  })

  it('handles a regression where nothing is significant', () => {
    const nothing = {
      ...base,
      loadings: base.loadings.map((l) => ({ ...l, significant: false, tStat: 0.2 })),
      rSquared: 0.05,
    }
    expect(describeFactorExposure(nothing).length).toBeGreaterThan(60)
  })
})

describe('buildFactorReturns', () => {
  /** Daily closes rising at a constant rate from a fixed start date. */
  function closes(start: number, rate: number, days = 12): FactorBar[] {
    const bars: FactorBar[] = []
    const cursor = new Date('2025-01-01T00:00:00Z')
    let close = start
    for (let i = 0; i < days; i++) {
      bars.push({ date: cursor.toISOString().slice(0, 10), close })
      close *= 1 + rate
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return bars
  }

  const full = () =>
    new Map<string, FactorBar[]>([
      ['SPY', closes(100, 0.002)],
      ['IWM', closes(100, 0.005)],
      ['IWD', closes(100, 0.003)],
      ['IWF', closes(100, 0.001)],
      ['MTUM', closes(100, 0.004)],
      ['QUAL', closes(100, 0.0025)],
      ['USMV', closes(100, 0.0015)],
    ])

  it('produces one aligned series per factor it can build', () => {
    const result = buildFactorReturns(full(), 0)!
    expect(result.factors.length).toBe(FACTOR_DEFINITIONS.length)
    for (const factor of result.factors) {
      expect(factor.returns.length).toBe(result.dates.length)
    }
  })

  it('builds a pair factor as long minus short', () => {
    const result = buildFactorReturns(full(), 0)!
    const size = result.factors.find((f) => f.id === 'size')!
    // IWM rises 0.5% a day, SPY 0.2%: the difference is 0.3 points
    expect(size.returns[0]).toBeCloseTo(0.005 - 0.002, 10)
  })

  it('subtracts the risk-free rate from the market factor only', () => {
    const withRate = buildFactorReturns(full(), 0.0252)!
    const dailyRate = 0.0252 / 252
    const market = withRate.factors.find((f) => f.id === 'market')!
    const size = withRate.factors.find((f) => f.id === 'size')!

    expect(market.returns[0]).toBeCloseTo(0.002 - dailyRate, 12)
    // A long/short pair is already self-financing; subtracting the rate again
    // would charge for borrowing money the pair never borrows
    expect(size.returns[0]).toBeCloseTo(0.005 - 0.002, 12)
  })

  it('uses only the dates every required symbol has', () => {
    const prices = full()
    prices.set('IWM', closes(100, 0.005).slice(4))
    const result = buildFactorReturns(prices, 0)!
    // Eight bars remain in common, so seven returns
    expect(result.dates.length).toBe(7)
  })

  it('omits a factor whose symbols are missing rather than guessing it', () => {
    const prices = full()
    prices.delete('MTUM')
    const result = buildFactorReturns(prices, 0)!
    expect(result.factors.some((f) => f.id === 'momentum')).toBe(false)
    expect(result.factors.some((f) => f.id === 'market')).toBe(true)
  })

  it('returns null when the market factor itself cannot be built', () => {
    const prices = full()
    prices.delete('SPY')
    expect(buildFactorReturns(prices, 0)).toBeNull()
  })

  it('returns null when there is not enough common history', () => {
    const prices = new Map<string, FactorBar[]>()
    for (const [symbol, bars] of full()) prices.set(symbol, bars.slice(0, 2))
    expect(buildFactorReturns(prices, 0)).toBeNull()
  })

  it('never emits a non-finite return', () => {
    const prices = full()
    prices.set('QUAL', [
      { date: '2025-01-01', close: 0 },
      ...closes(100, 0.0025).slice(1),
    ])
    const result = buildFactorReturns(prices, 0)
    if (result) {
      for (const factor of result.factors) {
        for (const value of factor.returns) expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    expect(buildFactorReturns(full(), 0.03)).toEqual(buildFactorReturns(full(), 0.03))
  })
})
