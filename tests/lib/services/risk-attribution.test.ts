import { describe, it, expect } from 'vitest'
import {
  portfolioVolatility,
  riskContributions,
  diversificationRatio,
  describeRiskConcentration,
} from '@/lib/services/risk-attribution'

/** Covariance matrix from per-asset volatilities and a single shared correlation. */
function covFrom(vols: number[], correlation: number): number[][] {
  return vols.map((vi, i) =>
    vols.map((vj, j) => (i === j ? vi * vi : vi * vj * correlation)),
  )
}

describe('portfolioVolatility', () => {
  it('equals the asset volatility for a single holding', () => {
    expect(portfolioVolatility([1], [[0.04]])).toBeCloseTo(0.2)
  })

  it('equals the weighted average when everything moves together', () => {
    // Perfect correlation buys no diversification
    const cov = covFrom([0.2, 0.3], 1)
    expect(portfolioVolatility([0.5, 0.5], cov)).toBeCloseTo(0.25)
  })

  it('falls below the weighted average when assets are uncorrelated', () => {
    const cov = covFrom([0.2, 0.2], 0)
    // sqrt(0.5^2*0.04 + 0.5^2*0.04) = 0.1414 vs a 0.2 weighted average
    expect(portfolioVolatility([0.5, 0.5], cov)).toBeCloseTo(0.1414, 3)
  })

  it('collapses to nearly zero for a perfect hedge', () => {
    const cov = covFrom([0.2, 0.2], -1)
    expect(portfolioVolatility([0.5, 0.5], cov)).toBeCloseTo(0, 6)
  })

  it('returns null when the matrix does not match the weights', () => {
    expect(portfolioVolatility([0.5, 0.5], [[0.04]])).toBeNull()
    expect(portfolioVolatility([], [])).toBeNull()
  })

  it('never returns NaN from a degenerate matrix', () => {
    const result = portfolioVolatility([0.5, 0.5], [[Number.NaN, 0], [0, 0.04]])
    expect(result).toBeNull()
  })
})

describe('riskContributions', () => {
  it('splits risk evenly between identical uncorrelated holdings', () => {
    const cov = covFrom([0.2, 0.2], 0)
    const result = riskContributions(['A', 'B'], [0.5, 0.5], cov)
    expect(result).not.toBeNull()
    expect(result!.contributions[0].percentOfRisk).toBeCloseTo(50)
    expect(result!.contributions[1].percentOfRisk).toBeCloseTo(50)
  })

  it('adds up to the portfolio volatility — the property that makes it an attribution', () => {
    const cov = covFrom([0.15, 0.25, 0.4], 0.3)
    const weights = [0.5, 0.3, 0.2]
    const result = riskContributions(['A', 'B', 'C'], weights, cov)!
    const summed = result.contributions.reduce((s, c) => s + c.contribution, 0)
    expect(summed).toBeCloseTo(result.portfolioVolatility, 10)
  })

  it('percentages sum to 100', () => {
    const cov = covFrom([0.15, 0.25, 0.4], 0.3)
    const result = riskContributions(['A', 'B', 'C'], [0.5, 0.3, 0.2], cov)!
    const total = result.contributions.reduce((s, c) => s + c.percentOfRisk, 0)
    expect(total).toBeCloseTo(100, 8)
  })

  it('charges a small but volatile holding more risk than its weight', () => {
    // 10% of the book in something three times as volatile carries more than
    // 10% of the risk — the whole point of measuring risk rather than weight
    const cov = covFrom([0.1, 0.1, 0.45], 0.2)
    const result = riskContributions(['A', 'B', 'RISKY'], [0.45, 0.45, 0.1], cov)!
    const risky = result.contributions.find((c) => c.symbol === 'RISKY')!
    expect(risky.percentOfRisk).toBeGreaterThan(10)
    expect(risky.percentOfRisk).toBeGreaterThan(risky.weight * 100)
  })

  it('ranks contributions from largest to smallest', () => {
    const cov = covFrom([0.1, 0.5, 0.3], 0.2)
    const result = riskContributions(['A', 'B', 'C'], [0.33, 0.34, 0.33], cov)!
    const percents = result.contributions.map((c) => c.percentOfRisk)
    expect([...percents].sort((a, b) => b - a)).toEqual(percents)
  })

  it('separates diversifiable from undiversifiable risk', () => {
    const cov = covFrom([0.2, 0.2], 0)
    const result = riskContributions(['A', 'B'], [0.5, 0.5], cov)!
    // Standalone weighted risk is 0.2; the book only carries 0.1414
    expect(result.undiversifiedVolatility).toBeCloseTo(0.2)
    expect(result.diversificationBenefit).toBeCloseTo(0.2 - 0.1414, 3)
  })

  it('reports no diversification benefit when everything moves together', () => {
    const cov = covFrom([0.2, 0.3], 1)
    const result = riskContributions(['A', 'B'], [0.5, 0.5], cov)!
    expect(result.diversificationBenefit).toBeCloseTo(0, 6)
  })

  it('returns null rather than dividing by a zero-risk book', () => {
    expect(riskContributions(['A'], [1], [[0]])).toBeNull()
  })

  it('returns null on mismatched inputs', () => {
    expect(riskContributions(['A', 'B'], [1], covFrom([0.2, 0.2], 0))).toBeNull()
  })
})

describe('diversificationRatio', () => {
  it('is 1 when there is nothing to diversify', () => {
    expect(diversificationRatio([1], [[0.04]])).toBeCloseTo(1)
  })

  it('is 1 when assets are perfectly correlated', () => {
    expect(diversificationRatio([0.5, 0.5], covFrom([0.2, 0.3], 1))).toBeCloseTo(1, 6)
  })

  it('rises above 1 as correlation falls', () => {
    const correlated = diversificationRatio([0.5, 0.5], covFrom([0.2, 0.2], 0.8))!
    const independent = diversificationRatio([0.5, 0.5], covFrom([0.2, 0.2], 0))!
    expect(independent).toBeGreaterThan(correlated)
    expect(independent).toBeCloseTo(Math.sqrt(2), 3)
  })
})

describe('describeRiskConcentration', () => {
  it('names how much risk the top holdings carry', () => {
    const text = describeRiskConcentration([
      { symbol: 'AAPL', weight: 0.3, volatility: 0.3, marginalContribution: 0, contribution: 0, percentOfRisk: 32 },
      { symbol: 'MSFT', weight: 0.25, volatility: 0.28, marginalContribution: 0, contribution: 0, percentOfRisk: 15 },
      { symbol: 'BND', weight: 0.45, volatility: 0.05, marginalContribution: 0, contribution: 0, percentOfRisk: 53 },
    ])
    expect(text).toMatch(/%/)
    expect(text.length).toBeGreaterThan(20)
  })

  it('says nothing dramatic about an evenly spread book', () => {
    const even = Array.from({ length: 10 }, (_, i) => ({
      symbol: `S${i}`,
      weight: 0.1,
      volatility: 0.2,
      marginalContribution: 0,
      contribution: 0,
      percentOfRisk: 10,
    }))
    expect(describeRiskConcentration(even)).toMatch(/spread|even|no single/i)
  })

  it('handles an empty book', () => {
    expect(describeRiskConcentration([])).toMatch(/no/i)
  })
})
