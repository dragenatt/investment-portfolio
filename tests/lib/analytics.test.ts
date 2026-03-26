import { describe, it, expect } from 'vitest'
import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateDailyReturns,
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
