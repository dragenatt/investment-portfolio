import { describe, it, expect } from 'vitest'
import { buildScenarios } from '@/lib/services/advisor'
import { whatIf, describeWhatIf, type Scenario } from '@/lib/services/what-if'

// A: volatile grower. B: calm. C: middling. Lightly correlated.
const base: Scenario = {
  holdings: [
    { symbol: 'A', value: 50_000 },
    { symbol: 'B', value: 30_000 },
    { symbol: 'C', value: 20_000 },
  ],
  expectedReturns: [0.12, 0.04, 0.08],
  cov: [
    [0.09, 0.006, 0.02],
    [0.006, 0.01, 0.004],
    [0.02, 0.004, 0.04],
  ],
  riskFreeRate: 0.04,
  plan: {
    aportacionMensual: 5_000,
    años: 10,
    // Chosen to sit near the middle of the simulated distribution. A goal the
    // book cannot reach gives every variant a probability of zero, and a test
    // comparing zero to zero proves nothing.
    meta: 1_200_000,
  },
}

const scenarios = buildScenarios({ months: 240, simulations: 300, seed: 77 })

describe('whatIf — baseline', () => {
  it('reports the book as it stands when nothing changes', () => {
    const result = whatIf(base, {}, scenarios)!
    expect(result.before.volatilityPct).toBeCloseTo(result.after.volatilityPct, 10)
    expect(result.delta.volatilityPp).toBeCloseTo(0, 10)
    expect(result.changed).toBe(false)
  })

  it('measures the book it was given', () => {
    const result = whatIf(base, {}, scenarios)!
    expect(result.before.totalValue).toBe(100_000)
    expect(result.before.weights.A).toBeCloseTo(0.5)
    expect(result.before.volatilityPct).toBeGreaterThan(0)
  })

  it('reports concentration and where the risk sits', () => {
    const result = whatIf(base, {}, scenarios)!
    // 0.5^2 + 0.3^2 + 0.2^2 = 0.38
    expect(result.before.hhi).toBeCloseTo(0.38, 6)
    expect(result.before.riskShare.length).toBe(3)
  })
})

describe('whatIf — changing the book', () => {
  it('shows what selling out of the riskiest holding does', () => {
    const result = whatIf(base, { weights: { A: 0.2, B: 0.5, C: 0.3 } }, scenarios)!
    expect(result.after.volatilityPct).toBeLessThan(result.before.volatilityPct)
    expect(result.after.expectedReturnPct).toBeLessThan(result.before.expectedReturnPct)
    expect(result.changed).toBe(true)
  })

  it('shows concentrating into one holding raising both risk and HHI', () => {
    const result = whatIf(base, { weights: { A: 0.9, B: 0.05, C: 0.05 } }, scenarios)!
    expect(result.after.volatilityPct).toBeGreaterThan(result.before.volatilityPct)
    expect(result.after.hhi).toBeGreaterThan(result.before.hhi)
  })

  it('drops a holding and re-spreads its weight', () => {
    const result = whatIf(base, { removeSymbols: ['A'] }, scenarios)!
    expect(result.after.weights.A ?? 0).toBe(0)
    const remaining = (result.after.weights.B ?? 0) + (result.after.weights.C ?? 0)
    expect(remaining).toBeCloseTo(1, 6)
  })

  it('refuses weights that do not describe a whole portfolio', () => {
    expect(whatIf(base, { weights: { A: 0.5, B: 0.2, C: 0.1 } }, scenarios)).toBeNull()
  })

  it('refuses a weight for a symbol the book does not hold', () => {
    expect(whatIf(base, { weights: { A: 0.5, Z: 0.5 } }, scenarios)).toBeNull()
  })
})

describe('whatIf — changing the plan', () => {
  it('raises the probability when the contribution goes up', () => {
    const result = whatIf(base, { aportacionMensual: 12_000 }, scenarios)!
    expect(result.after.goalProbabilityPct!).toBeGreaterThan(result.before.goalProbabilityPct!)
  })

  it('raises it when the horizon lengthens', () => {
    const result = whatIf(base, { años: 18 }, scenarios)!
    expect(result.after.goalProbabilityPct!).toBeGreaterThan(result.before.goalProbabilityPct!)
  })

  it('lowers it when the goal rises', () => {
    const result = whatIf(base, { meta: 5_000_000 }, scenarios)!
    expect(result.after.goalProbabilityPct!).toBeLessThan(result.before.goalProbabilityPct!)
  })

  it('compares against the same shocks, so the difference is the change', () => {
    const twice = whatIf(base, { aportacionMensual: 8_000 }, scenarios)!
    const again = whatIf(base, { aportacionMensual: 8_000 }, scenarios)!
    expect(twice).toEqual(again)
  })

  it('leaves goal figures null when the scenario has no plan', () => {
    const noPlan: Scenario = { ...base, plan: undefined }
    const result = whatIf(noPlan, { weights: { A: 0.4, B: 0.4, C: 0.2 } }, scenarios)!
    expect(result.before.goalProbabilityPct).toBeNull()
    expect(result.after.finalValueMedian).toBeNull()
  })
})

describe('whatIf — changing the assumptions', () => {
  it('shows what two extra points of expected return are worth', () => {
    const result = whatIf(base, { expectedReturnShift: 0.02 }, scenarios)!
    expect(result.after.expectedReturnPct).toBeCloseTo(result.before.expectedReturnPct + 2, 6)
  })

  it('shows what more volatility costs', () => {
    const result = whatIf(base, { volatilityMultiplier: 1.5 }, scenarios)!
    expect(result.after.volatilityPct).toBeGreaterThan(result.before.volatilityPct)
    expect(result.after.var95Pct).toBeGreaterThan(result.before.var95Pct)
  })

  it('refuses a volatility multiplier that is not positive', () => {
    expect(whatIf(base, { volatilityMultiplier: 0 }, scenarios)).toBeNull()
    expect(whatIf(base, { volatilityMultiplier: -1 }, scenarios)).toBeNull()
  })
})

describe('whatIf — safety', () => {
  it('never emits a non-finite number', () => {
    const result = whatIf(base, { weights: { A: 1, B: 0, C: 0 } }, scenarios)!
    for (const side of [result.before, result.after]) {
      for (const value of [side.volatilityPct, side.expectedReturnPct, side.hhi, side.var95Pct]) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('refuses a scenario whose covariance does not match its holdings', () => {
    expect(whatIf({ ...base, cov: [[0.09]] }, {}, scenarios)).toBeNull()
  })

  it('refuses an empty book', () => {
    expect(whatIf({ ...base, holdings: [], expectedReturns: [], cov: [] }, {}, scenarios)).toBeNull()
  })
})

describe('describeWhatIf', () => {
  it('names the trade the change makes', () => {
    const result = whatIf(base, { weights: { A: 0.2, B: 0.5, C: 0.3 } }, scenarios)!
    const text = describeWhatIf(result)
    expect(text.length).toBeGreaterThan(50)
    expect(text).toMatch(/riesgo|volatil/i)
  })

  it('says nothing changed when nothing did', () => {
    expect(describeWhatIf(whatIf(base, {}, scenarios)!)).toMatch(/no cambia|sin cambio/i)
  })

  it('never declares one side the winner', () => {
    const result = whatIf(base, { weights: { A: 0.2, B: 0.5, C: 0.3 } }, scenarios)!
    expect(describeWhatIf(result)).not.toMatch(/mejor opcion|deberias|recomendamos/i)
  })
})
