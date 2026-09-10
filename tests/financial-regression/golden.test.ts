// ─────────────────────────────────────────────────────────────────────────────
// Financial regression suite (P0-17)
//
// Every expectation here is derived by hand from a fixed dataset and written
// down with its derivation. That is the whole point: an ordinary unit test asks
// "does this still do what it did?", which passes happily when the previous
// answer was wrong. These ask "does this still produce the number the arithmetic
// says it should?".
//
// ── If a test in this file fails ─────────────────────────────────────────────
//
// Do NOT update the expected value to whatever the code now returns. Work out
// which of three things happened:
//
//   1. A CORRECTION. The old number was wrong and the new one is right. Change
//      the expectation AND the derivation comment above it, and say so in the
//      commit message.
//   2. An EXPECTED CHANGE. A deliberate model change moved the number — a new
//      annualisation convention, a different estimator. Same treatment, plus a
//      version bump wherever that model is versioned.
//   3. A REGRESSION. Nobody meant to move it. Fix the code.
//
// The derivations below are what make that decision possible. Deleting one to
// silence a failure removes the only reason this file exists.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateDailyReturns,
  calculateBetaAlpha,
} from '@/lib/services/analytics'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { portfolioVolatility, riskContributions } from '@/lib/services/risk-attribution'
import { analyseDrawdowns, recoveryRequired } from '@/lib/services/drawdown'
import {
  historicalVaR,
  parametricVaR,
  cornishFisherVaR,
  conditionalVaR,
} from '@/lib/services/var'
import { calculateTWR, calculateXIRR } from '@/lib/services/returns'
import { simulatePortfolioGBM } from '@/lib/services/monte-carlo'
import { toCents, allocateMoney, addMoney } from '@/lib/utils/money'
import { adjustForSplits } from '@/lib/services/corporate-actions'
import { buildScenarios, evaluarPlan } from '@/lib/services/advisor'

const TRADING_DAYS = 252

// ─── Dataset A: a price series with returns chosen to be exactly computable ──
//
// Closes: 100, 110, 99, 108.9, 100 ... produce daily returns of exactly
// +0.10, -0.10, +0.10, -0.0817..., which is deliberate: round returns make the
// mean and variance checkable on paper.
const DATASET_A = [100, 110, 99, 108.9, 98.01]

// Returns: +0.1, -0.1, +0.1, -0.1 exactly (each step is a clean ±10%).
const RETURNS_A = [0.1, -0.1, 0.1, -0.1]

// calculateBetaAlpha refuses to answer on fewer than 10 benchmark observations,
// so the beta cases use the same alternating pattern stretched to 12.
const RETURNS_LONG = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1))

describe('dataset A — daily returns', () => {
  it('turns closes into the returns the arithmetic gives', () => {
    // 110/100-1 = 0.1 · 99/110-1 = -0.1 · 108.9/99-1 = 0.1 · 98.01/108.9-1 = -0.1
    const returns = calculateDailyReturns(DATASET_A)
    expect(returns).toHaveLength(4)
    for (let i = 0; i < returns.length; i++) {
      expect(returns[i]).toBeCloseTo(RETURNS_A[i], 12)
    }
  })
})

describe('volatility', () => {
  it('annualises the sample standard deviation with the n-1 denominator', () => {
    // mean = 0. Sum of squares = 4 x 0.01 = 0.04. Sample variance = 0.04/3.
    // sd = sqrt(0.0133333) = 0.1154700538. Annualised = x sqrt(252) = 1.8330...
    const expected = Math.sqrt(0.04 / 3) * Math.sqrt(TRADING_DAYS)
    expect(calculateVolatility(RETURNS_A)).toBeCloseTo(expected, 12)
    expect(calculateVolatility(RETURNS_A)).toBeCloseTo(1.83302, 4)
  })

  it('is zero for a series with fewer than two returns', () => {
    expect(calculateVolatility([])).toBe(0)
    expect(calculateVolatility([0.05])).toBe(0)
  })
})

describe('Sharpe ratio', () => {
  it('is annualised excess return over annualised volatility', () => {
    // mean daily return = 0, so annualised return = 0.
    // Sharpe = (0 - 0.04) / 1.83302 = -0.021822...
    const sharpe = calculateSharpeRatio(RETURNS_A, 0.04)
    expect(sharpe).toBeCloseTo(-0.04 / (Math.sqrt(0.04 / 3) * Math.sqrt(TRADING_DAYS)), 12)
    expect(sharpe).toBeCloseTo(-0.02182, 5)
  })

  it('returns zero for a flat series instead of dividing by float dust', () => {
    // A constant series has no risk, but summing and re-dividing identical
    // floats leaves a variance around 1e-17 rather than exactly 0. Before the
    // threshold guard this returned -15.96 for a portfolio that never moved.
    const flat = Array(50).fill(1 / TRADING_DAYS)
    expect(calculateSharpeRatio(flat, 1)).toBe(0)
    expect(calculateSharpeRatio(Array(50).fill(0), 0.04)).toBe(0)
  })
})

describe('beta and alpha', () => {
  it('gives beta 1 and alpha 0 against an identical benchmark', () => {
    // cov(x,x)/var(x) = 1 by definition, and alpha = Rp - 1*Rb - Rf*(1-1) = 0.
    const stats = calculateBetaAlpha(RETURNS_LONG, RETURNS_LONG, 0.04)!
    expect(stats.beta).toBeCloseTo(1, 12)
    expect(stats.alpha).toBeCloseTo(0, 10)
    expect(stats.trackingError).toBeCloseTo(0, 10)
  })

  it('gives beta 2 for a portfolio that moves twice as hard', () => {
    // cov(2b, b) = 2*var(b), so beta = 2 exactly.
    const doubled = RETURNS_LONG.map((r) => r * 2)
    expect(calculateBetaAlpha(doubled, RETURNS_LONG, 0)!.beta).toBeCloseTo(2, 12)
  })

  it('gives beta -1 for a perfect inverse', () => {
    const inverted = RETURNS_LONG.map((r) => -r)
    expect(calculateBetaAlpha(inverted, RETURNS_LONG, 0)!.beta).toBeCloseTo(-1, 12)
  })

  it('refuses to answer without enough benchmark history', () => {
    expect(calculateBetaAlpha(RETURNS_A, [0.01], 0.04)).toBeNull()
  })
})

describe('covariance', () => {
  it('puts the sample variance on the diagonal', () => {
    // Same n-1 denominator as calculateVolatility, before annualisation.
    const cov = calculateCovarianceMatrix([RETURNS_A])
    expect(cov[0][0]).toBeCloseTo(0.04 / 3, 12)
  })

  it('is symmetric and matches the hand-computed off-diagonal', () => {
    const other = [0.05, -0.05, 0.05, -0.05]
    // cov = sum((x-0)(y-0))/3 = (0.005*4)/3 = 0.0066667
    const cov = calculateCovarianceMatrix([RETURNS_A, other])
    expect(cov[0][1]).toBeCloseTo(0.02 / 3, 12)
    expect(cov[0][1]).toBe(cov[1][0])
  })
})

describe('portfolio volatility', () => {
  it('is the weighted average when correlation is 1', () => {
    // sigma_p = sqrt(0.5^2*0.04 + 0.5^2*0.09 + 2*0.5*0.5*0.06) = 0.25
    const cov = [
      [0.04, 0.06],
      [0.06, 0.09],
    ]
    expect(portfolioVolatility([0.5, 0.5], cov)).toBeCloseTo(0.25, 12)
  })

  it('is sigma/sqrt(N) for N identical uncorrelated assets', () => {
    // Four assets, each 20% vol, equal weights, zero correlation:
    // sqrt(4 * 0.25^2 * 0.04) = 0.2/2 = 0.1
    const cov = Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 4 }, (_, j) => (i === j ? 0.04 : 0)),
    )
    expect(portfolioVolatility([0.25, 0.25, 0.25, 0.25], cov)).toBeCloseTo(0.1, 12)
  })
})

describe('risk contributions', () => {
  it('sums to portfolio volatility — the Euler identity', () => {
    const cov = [
      [0.04, 0.012, 0.006],
      [0.012, 0.09, 0.018],
      [0.006, 0.018, 0.16],
    ]
    const result = riskContributions(['A', 'B', 'C'], [0.5, 0.3, 0.2], cov)!
    const summed = result.contributions.reduce((s, c) => s + c.contribution, 0)
    expect(summed).toBeCloseTo(result.portfolioVolatility, 12)
  })

  it('splits risk in the same proportion as weight when assets are identical', () => {
    const cov = [
      [0.04, 0.04],
      [0.04, 0.04],
    ]
    const result = riskContributions(['A', 'B'], [0.7, 0.3], cov)!
    expect(result.contributions.find((c) => c.symbol === 'A')!.percentOfRisk).toBeCloseTo(70, 10)
  })
})

describe('drawdown', () => {
  it('reports the deepest fall from a running peak', () => {
    // Peak 120, trough 60: (120-60)/120 = 50%
    expect(calculateMaxDrawdown([100, 120, 60, 90])).toBeCloseTo(50, 12)
  })

  it('agrees with the episode analysis', () => {
    // Two implementations of the same idea must not drift apart
    const values = [100, 120, 60, 90, 130, 104]
    const legacy = calculateMaxDrawdown(values)
    const episodes = analyseDrawdowns(
      values.map((value, i) => ({ date: `2025-01-0${i + 1}`, value })),
    )
    expect(episodes.maxDrawdownPct).toBeCloseTo(legacy, 10)
  })

  it('states the recovery asymmetry exactly', () => {
    // 1/(1-0.5) - 1 = 1.0 -> +100% needed after a -50% fall
    expect(recoveryRequired(50)).toBeCloseTo(100, 12)
    // 1/(1-0.23) - 1 = 0.298701... -> the roadmap's -23% / +29.9% example
    expect(recoveryRequired(23)).toBeCloseTo(29.87012987, 8)
  })
})

describe('time-weighted return', () => {
  it('chains sub-periods and ignores contribution timing', () => {
    // 1.10 x 1.10 - 1 = 0.21 exactly
    const twr = calculateTWR(
      [
        { date: '2025-01-01', value: 1000 },
        { date: '2025-06-01', value: 1100 },
        { date: '2025-12-01', value: 2310 },
      ],
      [{ date: '2025-06-01', amount: 1000 }],
    )
    expect(twr).toBeCloseTo(21, 10)
  })
})

describe('XIRR', () => {
  it('solves a clean one-year doubling', () => {
    // -100 today, +200 in a year: (1+r)^1 = 2, r = 1 -> 100%
    expect(
      calculateXIRR([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: 200 },
      ]),
    ).toBeCloseTo(100, 4)
  })

  it('solves a two-year quadrupling', () => {
    // (1+r)^2 = 4 -> r = 1 -> 100% annually.
    // Dates deliberately avoid a leap year: XIRR divides elapsed days by 365, so
    // 2024-01-01 to 2026-01-01 is 731 days = 2.0027 years and lands on 99.81%.
    // That is the day-count convention working correctly, not an error.
    expect(
      calculateXIRR([
        { date: '2025-01-01', amount: -100 },
        { date: '2027-01-01', amount: 400 },
      ]),
    ).toBeCloseTo(100, 2)
  })
})

describe('money', () => {
  it('scales to cents without the float error', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1.005)).toBe(101)
    expect(addMoney(0.1, 0.2)).toBe(0.3)
  })

  it('splits a total without losing a cent', () => {
    const parts = allocateMoney(100, [1 / 3, 1 / 3, 1 / 3])
    expect(parts.reduce(addMoney, 0)).toBe(100)
  })
})

describe('corporate actions', () => {
  it('restates history in today share terms across a 4:1 split', () => {
    const bars = [
      { date: '2024-01-01', close: 400 },
      { date: '2024-01-02', close: 400 },
      { date: '2024-01-03', close: 100 },
      { date: '2024-01-04', close: 100 },
    ]
    const { bars: adjusted, splits } = adjustForSplits(bars)
    expect(splits[0].ratio).toBeCloseTo(4, 12)
    expect(adjusted.map((b) => b.adjustedClose)).toEqual([100, 100, 100, 100])
  })
})

describe('Monte Carlo determinism', () => {
  it('gives byte-identical results for the same seed', () => {
    const returnsA = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 0.01 : -0.004))
    const returnsB = Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? 0.02 : -0.005))
    const params = {
      assets: [
        { symbol: 'A', weight: 0.6, historicalReturns: returnsA },
        { symbol: 'B', weight: 0.4, historicalReturns: returnsB },
      ],
      weeks: 12,
      numSimulations: 200,
      seed: 12345,
    }
    expect(simulatePortfolioGBM(params)).toEqual(simulatePortfolioGBM(params))
  })

  it('gives a different answer for a different seed', () => {
    const base = {
      assets: [
        {
          symbol: 'A',
          weight: 1,
          historicalReturns: Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 0.01 : -0.004)),
        },
      ],
      weeks: 12,
      numSimulations: 200,
    }
    expect(simulatePortfolioGBM({ ...base, seed: 1 }).var95).not.toBe(
      simulatePortfolioGBM({ ...base, seed: 2 }).var95,
    )
  })
})

describe('advisor projection', () => {
  it('matches the closed-form annuity with no randomness', () => {
    // FV = P(1+r)^n + C * ((1+r)^n - 1)/r, monthly r from (1.07)^(1/12) - 1
    const r = Math.pow(1.07, 1 / 12) - 1
    const n = 120
    const expected = 50000 * Math.pow(1 + r, n) + 1000 * ((Math.pow(1 + r, n) - 1) / r)

    const scenarios = buildScenarios({ months: 120, simulations: 10, seed: 1 })
    const result = evaluarPlan(
      {
        capitalInicial: 50000,
        aportacionMensual: 1000,
        años: 10,
        rendimientoAnual: 0.07,
        volatilidadAnual: 0.1,
      },
      null,
      scenarios,
    )
    // Cent-rounded, so compare to the cent rather than to the last bit.
    expect(result.proyeccionDeterminista.valorFinal).toBeCloseTo(expected, 1)
  })

  it('is reproducible from its recorded seed alone', () => {
    const params = {
      capitalInicial: 10000,
      aportacionMensual: 500,
      años: 5,
      rendimientoAnual: 0.07,
      volatilidadAnual: 0.12,
    }
    const first = evaluarPlan(params, 100000, buildScenarios({ months: 60, simulations: 300, seed: 99 }))
    const rebuilt = evaluarPlan(params, 100000, buildScenarios({ months: 60, simulations: 300, seed: 99 }))
    expect(rebuilt).toEqual(first)
  })
})

describe('value at risk', () => {
  it('takes the historical VaR at the floor of the tail index', () => {
    // 100 returns from -0.50 to +0.49. floor(0.05 * 100) = 5, so the sixth
    // worst observation: -0.45, reported as a positive magnitude.
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 100)
    expect(historicalVaR(returns, 95)).toBeCloseTo(0.45, 12)
  })

  it('puts the parametric VaR at 1.6449 sigma for 95%', () => {
    // The standard normal 5% quantile is -1.6448536...
    expect(parametricVaR(0, 0.01, 95)).toBeCloseTo(0.016448536, 8)
  })

  it('puts it at 2.3263 sigma for 99%', () => {
    expect(parametricVaR(0, 0.01, 99)).toBeCloseTo(0.023263479, 8)
  })

  it('collapses Cornish-Fisher to the normal quantile at zero skew and kurtosis', () => {
    // z_cf = z + (z^2-1)S/6 + (z^3-3z)K/24 - (2z^3-5z)S^2/36, and every
    // correction term carries an S or a K, so all three vanish.
    expect(cornishFisherVaR(0, 0.01, 0, 0, 95)).toBeCloseTo(parametricVaR(0, 0.01, 95)!, 14)
  })

  it('averages the tail for CVaR', () => {
    // Worst 6 of 100 (index 0..5) are -0.50..-0.45; their mean is -0.475
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 100)
    expect(conditionalVaR(returns, 95)).toBeCloseTo(0.475, 12)
  })

  it('keeps CVaR at or above VaR — an identity, not a coincidence', () => {
    const returns = Array.from({ length: 250 }, (_, i) => Math.cos(i * 1.7) * 0.015 - 0.0004)
    for (const confidence of [90, 95, 99]) {
      expect(conditionalVaR(returns, confidence)!).toBeGreaterThanOrEqual(
        historicalVaR(returns, confidence)!,
      )
    }
  })
})

describe('recovery asymmetry', () => {
  it('needs 66.67% back after a 40% fall', () => {
    // 1/(1-0.40) - 1 = 0.6666...
    expect(recoveryRequired(40)).toBeCloseTo(66.666666667, 8)
  })
})

// ── Not covered yet ──────────────────────────────────────────────────────────
//
// Markowitz (P1-31), Risk Parity and CVaR optimisation (P1-32), and the factor
// model (P1-26) have no implementation to pin. Add their derivations here when
// they land.
