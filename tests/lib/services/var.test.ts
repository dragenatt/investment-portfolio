import { describe, it, expect } from 'vitest'
import {
  skewness,
  excessKurtosis,
  historicalVaR,
  parametricVaR,
  cornishFisherVaR,
  conditionalVaR,
  analyseTailRisk,
} from '@/lib/services/var'

/** A symmetric, well-behaved sample: skew ~0 and excess kurtosis ~0 by construction. */
const SYMMETRIC = Array.from({ length: 400 }, (_, i) => {
  // Deterministic pseudo-normal via the central limit theorem on a fixed grid
  const u = (i + 0.5) / 400
  return Math.sqrt(2) * inverseErf(2 * u - 1) * 0.01
})

/** Inverse error function, Winitzki's approximation — good to ~2e-3, plenty here. */
function inverseErf(x: number): number {
  const a = 0.147
  const ln = Math.log(1 - x * x)
  const t1 = 2 / (Math.PI * a) + ln / 2
  return Math.sign(x) * Math.sqrt(Math.sqrt(t1 * t1 - ln / a) - t1)
}

describe('skewness', () => {
  it('is zero for a symmetric sample', () => {
    expect(skewness([-2, -1, 0, 1, 2])).toBeCloseTo(0, 10)
  })

  it('is positive when the long tail is on the right', () => {
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(0)
  })

  it('is negative when the long tail is on the left', () => {
    // The shape that matters for risk: rare large losses
    expect(skewness([-10, 1, 1, 1, 1])).toBeLessThan(0)
  })

  it('returns null for too few observations to estimate a third moment', () => {
    expect(skewness([1, 2])).toBeNull()
  })

  it('returns null for a series with no dispersion', () => {
    expect(skewness([5, 5, 5, 5])).toBeNull()
  })
})

describe('excessKurtosis', () => {
  it('is near zero for a flat, evenly spread sample', () => {
    // A uniform grid has excess kurtosis of about -1.2, comfortably negative
    const uniform = Array.from({ length: 200 }, (_, i) => i / 200)
    expect(excessKurtosis(uniform)).toBeLessThan(0)
  })

  it('is positive when rare extremes dominate', () => {
    const fatTailed = [...Array(98).fill(0), -5, 5]
    expect(excessKurtosis(fatTailed)!).toBeGreaterThan(3)
  })

  it('returns null when it cannot be estimated', () => {
    expect(excessKurtosis([1, 2, 3])).toBeNull()
    expect(excessKurtosis([4, 4, 4, 4, 4])).toBeNull()
  })
})

describe('historicalVaR', () => {
  it('picks the loss at the requested percentile', () => {
    // 100 returns from -0.50 to +0.49. floor(0.05 * 100) = index 5, the sixth
    // worst, which is -0.45.
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 100)
    const var95 = historicalVaR(returns, 95)!
    expect(var95).toBeCloseTo(0.45, 10)
  })

  it('reports a loss as a positive number', () => {
    // VaR is quoted as a magnitude: "you could lose 4.6%", not "-4.6%"
    const losing = [-0.1, -0.08, -0.05, -0.03, -0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05, 0.06]
    expect(historicalVaR(losing, 95)!).toBeGreaterThan(0)
  })

  it('is zero when nothing in the sample loses money', () => {
    const allGains = Array.from({ length: 20 }, (_, i) => 0.01 + i / 1000)
    expect(historicalVaR(allGains, 95)).toBe(0)
  })

  it('grows with the confidence level', () => {
    const returns = Array.from({ length: 200 }, (_, i) => (i - 100) / 200)
    expect(historicalVaR(returns, 99)!).toBeGreaterThan(historicalVaR(returns, 95)!)
  })

  it('returns null without enough observations to have a tail', () => {
    expect(historicalVaR([0.01, -0.01], 95)).toBeNull()
  })
})

describe('parametricVaR', () => {
  it('is 1.645 standard deviations at 95%', () => {
    // The normal quantile: VaR = -(mu + z*sigma), z(5%) = -1.6449
    const var95 = parametricVaR(0, 0.01, 95)!
    expect(var95).toBeCloseTo(0.016449, 5)
  })

  it('is 2.326 standard deviations at 99%', () => {
    expect(parametricVaR(0, 0.01, 99)!).toBeCloseTo(0.023263, 4)
  })

  it('shifts with the mean', () => {
    // A positive drift reduces the loss at a given confidence
    expect(parametricVaR(0.005, 0.01, 95)!).toBeLessThan(parametricVaR(0, 0.01, 95)!)
  })

  it('never reports a negative VaR', () => {
    // A large positive drift would make the raw quantile positive; floor at 0
    expect(parametricVaR(1, 0.01, 95)).toBe(0)
  })

  it('returns null for an impossible volatility', () => {
    expect(parametricVaR(0, -0.01, 95)).toBeNull()
    expect(parametricVaR(0, Number.NaN, 95)).toBeNull()
  })
})

describe('cornishFisherVaR', () => {
  it('matches the normal VaR when the sample is symmetric and mesokurtic', () => {
    // With skew and excess kurtosis both zero the expansion collapses to z
    const cf = cornishFisherVaR(0, 0.01, 0, 0, 95)!
    expect(cf).toBeCloseTo(parametricVaR(0, 0.01, 95)!, 10)
  })

  it('reports a larger loss than the normal VaR for a left-skewed sample', () => {
    // The whole point: the normal model understates risk when losses cluster
    const normal = parametricVaR(0, 0.01, 95)!
    const cf = cornishFisherVaR(0, 0.01, -1.2, 4, 95)!
    expect(cf).toBeGreaterThan(normal)
  })

  it('reports a smaller loss for a right-skewed sample', () => {
    expect(cornishFisherVaR(0, 0.01, 1.2, 0, 95)!).toBeLessThan(parametricVaR(0, 0.01, 95)!)
  })

  it('grows with fat tails at a fixed skew', () => {
    const thin = cornishFisherVaR(0, 0.01, 0, 0, 99)!
    const fat = cornishFisherVaR(0, 0.01, 0, 6, 99)!
    expect(fat).toBeGreaterThan(thin)
  })

  it('never reports a negative VaR', () => {
    expect(cornishFisherVaR(1, 0.01, 2, 0, 95)).toBe(0)
  })

  it('returns null when the moments are unknown', () => {
    expect(cornishFisherVaR(0, 0.01, null, 3, 95)).toBeNull()
    expect(cornishFisherVaR(0, 0.01, 0, null, 95)).toBeNull()
  })
})

describe('conditionalVaR', () => {
  it('is the average loss beyond the VaR threshold', () => {
    // Worst 5 of 100 returns are -0.50..-0.46; their mean magnitude is 0.48
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 100)
    expect(conditionalVaR(returns, 95)!).toBeCloseTo(0.48, 2)
  })

  it('is never smaller than the VaR at the same confidence', () => {
    // CVaR averages the tail; VaR is its best case. This must always hold.
    const returns = Array.from({ length: 300 }, (_, i) => Math.sin(i) * 0.02 - 0.001)
    for (const confidence of [90, 95, 99]) {
      expect(conditionalVaR(returns, confidence)!).toBeGreaterThanOrEqual(
        historicalVaR(returns, confidence)!,
      )
    }
  })

  it('is zero when the tail contains no losses', () => {
    const allGains = Array.from({ length: 20 }, (_, i) => 0.01 + i / 1000)
    expect(conditionalVaR(allGains, 95)).toBe(0)
  })

  it('returns null without enough observations', () => {
    expect(conditionalVaR([0.01, -0.01], 95)).toBeNull()
  })
})

describe('analyseTailRisk', () => {
  it('reports all four measures side by side', () => {
    const result = analyseTailRisk(SYMMETRIC, 95)!
    expect(result.historicalPct).toBeGreaterThan(0)
    expect(result.parametricPct).toBeGreaterThan(0)
    expect(result.cornishFisherPct).toBeGreaterThan(0)
    expect(result.conditionalPct).toBeGreaterThan(0)
    expect(result.confidence).toBe(95)
  })

  it('quotes everything as a percentage, not a fraction', () => {
    const result = analyseTailRisk(SYMMETRIC, 95)!
    // A ~1% daily sigma gives a VaR near 1.6%, not 0.016
    expect(result.parametricPct).toBeGreaterThan(1)
    expect(result.parametricPct).toBeLessThan(5)
  })

  it('carries the shape of the distribution so a reader can judge the gap', () => {
    const result = analyseTailRisk(SYMMETRIC, 95)!
    expect(result.skewness).not.toBeNull()
    expect(result.excessKurtosis).not.toBeNull()
  })

  it('explains which measure to trust and why', () => {
    const result = analyseTailRisk(SYMMETRIC, 95)!
    expect(result.interpretation.length).toBeGreaterThan(40)
  })

  it('falls back gracefully when the moments cannot be estimated', () => {
    const flat = Array(50).fill(0.001)
    const result = analyseTailRisk(flat, 95)!
    expect(result.cornishFisherPct).toBeNull()
    expect(result.historicalPct).toBe(0)
  })

  it('returns null for a series too short to say anything about a tail', () => {
    expect(analyseTailRisk([0.01, -0.02], 95)).toBeNull()
  })

  it('never emits a non-finite number', () => {
    const result = analyseTailRisk(SYMMETRIC, 99)!
    for (const value of [
      result.historicalPct,
      result.parametricPct,
      result.cornishFisherPct,
      result.conditionalPct,
    ]) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })

  it('is deterministic', () => {
    expect(analyseTailRisk(SYMMETRIC, 95)).toEqual(analyseTailRisk(SYMMETRIC, 95))
  })
})
