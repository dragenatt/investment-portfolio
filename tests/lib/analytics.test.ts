import { describe, it, expect } from 'vitest'
import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateDailyReturns,
  calculateBetaAlpha,
} from '@/lib/services/analytics'

describe('calculateDailyReturns', () => {
  it('computes daily returns from close prices', () => {
    const closes = [100, 110, 105]
    const returns = calculateDailyReturns(closes)
    expect(returns).toHaveLength(2)
    expect(returns[0]).toBeCloseTo(0.1)   // (110-100)/100
    expect(returns[1]).toBeCloseTo(-0.04545, 4) // (105-110)/110
  })

  it('returns empty array for single data point', () => {
    expect(calculateDailyReturns([100])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(calculateDailyReturns([])).toEqual([])
  })
})

describe('calculateVolatility', () => {
  it('returns 0 for fewer than 2 data points', () => {
    expect(calculateVolatility([])).toBe(0)
    expect(calculateVolatility([0.05])).toBe(0)
  })

  it('calculates annualized volatility for known data', () => {
    // Constant returns = zero volatility
    const constantReturns = [0.01, 0.01, 0.01, 0.01]
    expect(calculateVolatility(constantReturns)).toBeCloseTo(0)
  })

  it('produces higher volatility for more variable returns', () => {
    const lowVol = [0.01, 0.02, 0.01, 0.02, 0.01]
    const highVol = [0.10, -0.10, 0.10, -0.10, 0.10]
    expect(calculateVolatility(highVol)).toBeGreaterThan(calculateVolatility(lowVol))
  })

  it('annualizes with sqrt(252)', () => {
    const returns = [0.01, -0.01]
    const vol = calculateVolatility(returns)
    // Daily std dev of [0.01, -0.01]: mean=0, variance = (0.0001+0.0001)/1 = 0.0002
    // daily vol = sqrt(0.0002) = 0.01414
    // annualized = 0.01414 * sqrt(252) = ~0.2245
    expect(vol).toBeCloseTo(0.01414 * Math.sqrt(252), 2)
  })
})

describe('calculateSharpeRatio', () => {
  it('returns 0 for fewer than 2 data points', () => {
    expect(calculateSharpeRatio([], 0.05)).toBe(0)
    expect(calculateSharpeRatio([0.01], 0.05)).toBe(0)
  })

  it('returns 0 when volatility is zero', () => {
    const constantReturns = [0.01, 0.01, 0.01]
    expect(calculateSharpeRatio(constantReturns, 0.05)).toBe(0)
  })

  it('computes Sharpe ratio for known values', () => {
    // Create returns with known mean and volatility
    const returns = [0.01, -0.01, 0.01, -0.01]
    const riskFreeRate = 0.0
    const sharpe = calculateSharpeRatio(returns, riskFreeRate)
    // mean daily return = 0, annualized = 0, numerator = 0 - 0 = 0
    expect(sharpe).toBeCloseTo(0)
  })

  it('produces positive Sharpe for positive excess returns', () => {
    const returns = [0.05, 0.06, 0.04, 0.05, 0.07]
    const sharpe = calculateSharpeRatio(returns, 0.02)
    expect(sharpe).toBeGreaterThan(0)
  })
})

describe('calculateMaxDrawdown', () => {
  it('returns 0 for fewer than 2 values', () => {
    expect(calculateMaxDrawdown([])).toBe(0)
    expect(calculateMaxDrawdown([100])).toBe(0)
  })

  it('returns 0 for monotonically increasing values', () => {
    expect(calculateMaxDrawdown([100, 110, 120, 130])).toBe(0)
  })

  it('detects drawdown as percentage', () => {
    const values = [100, 90, 80, 95]
    // peak = 100, lowest = 80, drawdown = 20/100 = 20%
    expect(calculateMaxDrawdown(values)).toBeCloseTo(20)
  })

  it('detects max drawdown across multiple peaks', () => {
    const values = [100, 120, 90, 130, 65]
    // First peak 120, drop to 90 = 25%
    // Second peak 130, drop to 65 = 50%
    expect(calculateMaxDrawdown(values)).toBeCloseTo(50)
  })

  it('handles flat values', () => {
    expect(calculateMaxDrawdown([100, 100, 100])).toBe(0)
  })
})

describe('calculateBetaAlpha', () => {
  const RISK_FREE = 0.0425

  // Deterministic benchmark, and portfolios derived from it so beta has a
  // closed form to check against.
  const benchmarkReturns = Array.from(
    { length: 60 },
    (_, i) => (Math.sin(i * 0.7) + Math.cos(i * 0.23)) / 200
  )

  it('gives beta 1 and no alpha for a portfolio that IS the benchmark', () => {
    const result = calculateBetaAlpha(benchmarkReturns, benchmarkReturns, 0)
    expect(result).not.toBeNull()
    expect(result!.beta).toBeCloseTo(1, 10)
    expect(result!.alpha).toBeCloseTo(0, 10)
    expect(result!.trackingError).toBeCloseTo(0, 10)
  })

  it('gives beta 2 for a portfolio that moves twice as much', () => {
    const doubled = benchmarkReturns.map((r) => r * 2)
    const result = calculateBetaAlpha(doubled, benchmarkReturns, 0)
    expect(result!.beta).toBeCloseTo(2, 10)
  })

  it('gives negative beta for a portfolio that moves against the benchmark', () => {
    const mirrored = benchmarkReturns.map((r) => -r)
    const result = calculateBetaAlpha(mirrored, benchmarkReturns, 0)
    expect(result!.beta).toBeCloseTo(-1, 10)
  })

  it('does not assume correlation 1 — a diversified book gets a beta below its vol ratio', () => {
    // Half the moves track the benchmark, half are idiosyncratic noise. The old
    // approximation (vol_portfolio / vol_benchmark) would report the vol ratio;
    // a real regression reports roughly the 0.5 loading.
    const idiosyncratic = Array.from({ length: 60 }, (_, i) => Math.sin(i * 3.1) / 200)
    const portfolio = benchmarkReturns.map((r, i) => 0.5 * r + idiosyncratic[i])

    const result = calculateBetaAlpha(portfolio, benchmarkReturns, 0)!
    const volRatio = calculateVolatility(portfolio) / calculateVolatility(benchmarkReturns)

    expect(result.beta).toBeCloseTo(0.5, 1)
    expect(result.beta).toBeLessThan(volRatio)
  })

  it('returns null when there is not enough benchmark history', () => {
    expect(calculateBetaAlpha(benchmarkReturns, benchmarkReturns.slice(0, 9), 0)).toBeNull()
    expect(calculateBetaAlpha(benchmarkReturns, [], 0)).toBeNull()
  })

  it('falls back to a neutral beta when the benchmark never moves', () => {
    const flat = new Array(60).fill(0.0004)
    const result = calculateBetaAlpha(benchmarkReturns, flat, 0)
    expect(result!.beta).toBe(1)
  })

  it('treats alpha as Jensen alpha: a risk-free rate shifts it by rf*(1-beta)', () => {
    const doubled = benchmarkReturns.map((r) => r * 2 + 0.0001)
    const simple = calculateBetaAlpha(doubled, benchmarkReturns, 0)!
    const jensen = calculateBetaAlpha(doubled, benchmarkReturns, RISK_FREE)!

    expect(jensen.beta).toBeCloseTo(simple.beta, 12)
    expect(jensen.alpha).toBeCloseTo(simple.alpha - RISK_FREE * 100 * (1 - simple.beta), 10)
  })
})

describe('calculateBetaAlpha — identical from both call sites', () => {
  // One dataset, fed through the two shapes that exist in the codebase:
  //
  //   risk/route.ts  portfolio values per day and raw benchmark closes from
  //                  price_history
  //   snapshots.ts   snapshot total_value and getBenchmarkSeries output, which
  //                  is normalised to start at 100
  //
  // If that normalisation (or the scale of the portfolio) moved the answer, the
  // two surfaces would report different betas for the same portfolio, which is
  // the bug this extraction exists to prevent.
  const benchmarkCloses = Array.from(
    { length: 40 },
    (_, i) => 400 + Math.sin(i * 0.6) * 12 + i * 0.5
  )
  const portfolioValues = Array.from(
    { length: 40 },
    (_, i) => 100000 + Math.sin(i * 0.6) * 4000 + Math.cos(i * 0.31) * 1500 + i * 60
  )

  const RISK_FREE = 0.0425

  function expectSame(a: ReturnType<typeof calculateBetaAlpha>, b: ReturnType<typeof calculateBetaAlpha>) {
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.beta).toBeCloseTo(b!.beta, 10)
    expect(a!.alpha).toBeCloseTo(b!.alpha, 10)
    expect(a!.trackingError).toBeCloseTo(b!.trackingError, 10)
    expect(a!.informationRatio).toBeCloseTo(b!.informationRatio, 10)
  }

  const portfolioReturns = calculateDailyReturns(portfolioValues)

  it('matches whether the benchmark series is raw or normalised to 100', () => {
    const fromRoute = calculateBetaAlpha(
      portfolioReturns,
      calculateDailyReturns(benchmarkCloses),
      RISK_FREE
    )

    // What getBenchmarkSeries hands snapshots.ts.
    const normalised = benchmarkCloses.map((close) => (close / benchmarkCloses[0]) * 100)
    const fromSnapshots = calculateBetaAlpha(
      portfolioReturns,
      calculateDailyReturns(normalised),
      RISK_FREE
    )

    expectSame(fromRoute, fromSnapshots)
  })

  it('does not depend on the absolute scale of the portfolio', () => {
    const scaled = portfolioValues.map((value) => value / 20)
    expectSame(
      calculateBetaAlpha(portfolioReturns, calculateDailyReturns(benchmarkCloses), RISK_FREE),
      calculateBetaAlpha(
        calculateDailyReturns(scaled),
        calculateDailyReturns(benchmarkCloses),
        RISK_FREE
      )
    )
  })

  it('is a pure function: repeated calls on the same input agree exactly', () => {
    const benchmarkReturns = calculateDailyReturns(benchmarkCloses)
    expect(calculateBetaAlpha(portfolioReturns, benchmarkReturns, RISK_FREE)).toEqual(
      calculateBetaAlpha(portfolioReturns, benchmarkReturns, RISK_FREE)
    )
  })
})
