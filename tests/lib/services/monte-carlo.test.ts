import { describe, it, expect } from 'vitest'
import { simulatePortfolioGBM, percentile } from '@/lib/services/monte-carlo'
import { calculateVolatility } from '@/lib/services/analytics'

const TRADING_DAYS = 252

/**
 * A deterministic pattern with mean 0 and sample standard deviation 1, so that
 * seriesWith() can dial in an exact annualised mu and sigma.
 */
function standardizedPattern(length: number): number[] {
  const raw = Array.from({ length }, (_, i) => Math.sin(i * 1.7) + Math.cos(i * 0.31))
  const mean = raw.reduce((a, b) => a + b, 0) / length
  const centered = raw.map((v) => v - mean)
  const sd = Math.sqrt(centered.reduce((a, b) => a + b * b, 0) / (length - 1))
  return centered.map((v) => v / sd)
}

/** Daily returns whose annualised mean is `annualMu` and annualised vol is `annualSigma`. */
function seriesWith(annualMu: number, annualSigma: number, pattern: number[]): number[] {
  return pattern.map((u) => annualMu / TRADING_DAYS + (annualSigma / Math.sqrt(TRADING_DAYS)) * u)
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdDev(values: number[]): number {
  const m = mean(values)
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
}

/**
 * Annualised volatility realised by the simulation: with weeks = 52 the horizon
 * is exactly one year, so sd(ln V_final) is the annual vol of the portfolio.
 */
function realisedAnnualVol(finalValues: number[]): number {
  return stdDev(finalValues.map((v) => Math.log(v)))
}

const pattern = standardizedPattern(500)

describe('simulatePortfolioGBM - single asset vs closed-form GBM', () => {
  // ln(S_T/S_0) ~ N((mu - sigma^2/2)*T, sigma^2*T). With T = 1: mean 0.06, sd 0.20.
  const MU = 0.08
  const SIGMA = 0.2

  const result = simulatePortfolioGBM({
    assets: [{ symbol: 'AAA', weight: 1, historicalReturns: seriesWith(MU, SIGMA, pattern) }],
    weeks: 52,
    numSimulations: 20000,
    seed: 42,
  })
  const logs = result.finalValueDistribution.map((v) => Math.log(v))

  it('estimates the asset inputs it was given', () => {
    const returns = seriesWith(MU, SIGMA, pattern)
    expect(calculateVolatility(returns)).toBeCloseTo(SIGMA, 10)
    expect(mean(returns) * TRADING_DAYS).toBeCloseTo(MU, 10)
  })

  it('converges to the theoretical mean of the log-price', () => {
    expect(mean(logs)).toBeCloseTo(MU - (SIGMA * SIGMA) / 2, 2) // 0.06
  })

  it('converges to the theoretical variance of the log-price', () => {
    expect(stdDev(logs)).toBeCloseTo(SIGMA, 2) // 0.20
  })

  it('puts the median at exp((mu - sigma^2/2)*T)', () => {
    const median = percentile(result.finalValueDistribution, 0.5)
    expect(median).toBeCloseTo(Math.exp(MU - (SIGMA * SIGMA) / 2), 1)
  })
})

describe('simulatePortfolioGBM - correlation drives portfolio volatility', () => {
  const SIGMA_A = 0.15
  const SIGMA_B = 0.35
  const MU = 0.05

  // Same driver for both assets => correlation exactly +1.
  const perfectlyCorrelated = simulatePortfolioGBM({
    assets: [
      { symbol: 'AAA', weight: 0.5, historicalReturns: seriesWith(MU, SIGMA_A, pattern) },
      { symbol: 'BBB', weight: 0.5, historicalReturns: seriesWith(MU, SIGMA_B, pattern) },
    ],
    weeks: 52,
    numSimulations: 8000,
    seed: 7,
  })

  // Mirrored driver => correlation exactly -1.
  const perfectlyAnticorrelated = simulatePortfolioGBM({
    assets: [
      { symbol: 'AAA', weight: 0.5, historicalReturns: seriesWith(MU, SIGMA_A, pattern) },
      {
        symbol: 'BBB',
        weight: 0.5,
        historicalReturns: seriesWith(MU, SIGMA_B, pattern.map((u) => -u)),
      },
    ],
    weeks: 52,
    numSimulations: 8000,
    seed: 7,
  })

  it('with correlation +1, portfolio vol equals the weighted average of the individual vols', () => {
    const weightedAverage = 0.5 * SIGMA_A + 0.5 * SIGMA_B // 0.25
    expect(realisedAnnualVol(perfectlyCorrelated.finalValueDistribution)).toBeCloseTo(
      weightedAverage,
      1
    )
  })

  it('with correlation -1, portfolio vol is below either asset on its own', () => {
    const portfolioVol = realisedAnnualVol(perfectlyAnticorrelated.finalValueDistribution)
    expect(portfolioVol).toBeLessThan(SIGMA_A)
    expect(portfolioVol).toBeLessThan(SIGMA_B)
    expect(portfolioVol).toBeGreaterThan(0)
  })

  it('diversification benefit: -1 is strictly calmer than +1', () => {
    expect(realisedAnnualVol(perfectlyAnticorrelated.finalValueDistribution)).toBeLessThan(
      realisedAnnualVol(perfectlyCorrelated.finalValueDistribution)
    )
  })
})

describe('simulatePortfolioGBM - shape and invariants', () => {
  const assets = [
    { symbol: 'AAA', weight: 0.6, historicalReturns: seriesWith(0.09, 0.18, pattern) },
    { symbol: 'BBB', weight: 0.4, historicalReturns: seriesWith(0.04, 0.28, pattern) },
  ]

  it('returns weeks + 1 bands, opening from a deterministic 1.0', () => {
    const r = simulatePortfolioGBM({ assets, weeks: 52, numSimulations: 500 })
    expect(r.weeklyBands).toHaveLength(53)
    expect(r.weeklyBands[0]).toEqual({ week: 0, p10: 1, p50: 1, p90: 1 })
    expect(r.weeklyBands[52].week).toBe(52)
  })

  it('keeps p10 <= p50 <= p90 on every week, and the cone widens', () => {
    const r = simulatePortfolioGBM({ assets, weeks: 52, numSimulations: 1500 })
    for (const band of r.weeklyBands) {
      expect(band.p10).toBeLessThanOrEqual(band.p50)
      expect(band.p50).toBeLessThanOrEqual(band.p90)
    }
    const firstWidth = r.weeklyBands[1].p90 - r.weeklyBands[1].p10
    const lastWidth = r.weeklyBands[52].p90 - r.weeklyBands[52].p10
    expect(lastWidth).toBeGreaterThan(firstWidth)
  })

  it('returns one final value per simulation, sorted ascending', () => {
    const r = simulatePortfolioGBM({ assets, weeks: 12, numSimulations: 400 })
    expect(r.finalValueDistribution).toHaveLength(400)
    for (let i = 1; i < r.finalValueDistribution.length; i++) {
      expect(r.finalValueDistribution[i]).toBeGreaterThanOrEqual(r.finalValueDistribution[i - 1])
    }
  })

  it('reports var95 as the loss at the 5th percentile of final values', () => {
    const r = simulatePortfolioGBM({ assets, weeks: 52, numSimulations: 2000 })
    expect(r.var95).toBeCloseTo(1 - percentile(r.finalValueDistribution, 0.05), 12)
  })

  it('is deterministic for a given seed and varies with a different one', () => {
    const a = simulatePortfolioGBM({ assets, weeks: 12, numSimulations: 300, seed: 1 })
    const b = simulatePortfolioGBM({ assets, weeks: 12, numSimulations: 300, seed: 1 })
    const c = simulatePortfolioGBM({ assets, weeks: 12, numSimulations: 300, seed: 2 })
    expect(a.finalValueDistribution).toEqual(b.finalValueDistribution)
    expect(a.finalValueDistribution).not.toEqual(c.finalValueDistribution)
  })

  it('normalises weights that do not sum to 1', () => {
    const raw = simulatePortfolioGBM({
      assets: assets.map((a) => ({ ...a, weight: a.weight * 100 })),
      weeks: 12,
      numSimulations: 300,
      seed: 3,
    })
    const normalised = simulatePortfolioGBM({ assets, weeks: 12, numSimulations: 300, seed: 3 })
    expect(raw.finalValueDistribution).toEqual(normalised.finalValueDistribution)
  })

  it('degrades safely on empty input', () => {
    expect(simulatePortfolioGBM({ assets: [] })).toEqual({
      weeklyBands: [],
      finalValueDistribution: [],
      var95: 0,
    })
    expect(simulatePortfolioGBM({ assets, weeks: 0 }).weeklyBands).toEqual([])
  })

  it('leaves a zero-volatility asset on its deterministic drift', () => {
    const flat = simulatePortfolioGBM({
      assets: [{ symbol: 'CASH', weight: 1, historicalReturns: new Array(300).fill(0.0002) }],
      weeks: 52,
      numSimulations: 200,
      seed: 5,
    })
    const spread =
      flat.finalValueDistribution[flat.finalValueDistribution.length - 1] -
      flat.finalValueDistribution[0]
    expect(spread).toBeCloseTo(0, 10)
    expect(flat.finalValueDistribution[0]).toBeCloseTo(Math.exp(0.0002 * TRADING_DAYS), 6)
  })
})

describe('percentile', () => {
  it('interpolates linearly between neighbours', () => {
    expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 12)
    expect(percentile([0, 10, 20, 30], 0.5)).toBeCloseTo(15, 12)
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5)
  })

  it('handles degenerate inputs', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([7], 0.9)).toBe(7)
  })
})
