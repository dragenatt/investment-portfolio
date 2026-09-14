import { describe, it, expect } from 'vitest'
import { mulberry32, standardNormal, createNormalSampler } from '@/lib/utils/random'
import { buildScenarios } from '@/lib/services/advisor'

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('stays in [0, 1)', () => {
    const random = mulberry32(7)
    for (let i = 0; i < 5000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('pins the first draws, so extracting it changed nothing downstream', () => {
    // These are the values the two private copies produced before they were
    // merged. If this ever changes, every seeded projection in the app changes
    // with it, including the worked example in ADVISOR_FINANCIAL_MODEL.md.
    const random = mulberry32(42)
    expect(random()).toBeCloseTo(0.6011037519201636, 15)
    expect(random()).toBeCloseTo(0.44829055899754167, 15)
  })
})

describe('standardNormal', () => {
  it('has roughly zero mean and unit variance', () => {
    const random = mulberry32(1)
    const n = 20_000
    const draws = Array.from({ length: n }, () => standardNormal(random))
    const mean = draws.reduce((a, b) => a + b, 0) / n
    const variance = draws.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(variance - 1)).toBeLessThan(0.04)
  })

  it('never returns a non-finite value, even if the generator hits zero', () => {
    expect(Number.isFinite(standardNormal(() => 0))).toBe(true)
  })

  it('still drives the advisor scenarios exactly as before', () => {
    // buildScenarios now imports these instead of owning a private copy.
    const scenarios = buildScenarios({ months: 3, simulations: 2, seed: 42 })
    const random = mulberry32(42)
    expect(scenarios.shocks[0][0]).toBeCloseTo(standardNormal(random), 12)
  })
})

describe('createNormalSampler', () => {
  it('uses both halves of each Box-Muller pair', () => {
    // Different stream consumption from standardNormal on purpose: this is the
    // variant the portfolio Monte Carlo has always used, kept bit-identical.
    const sampler = createNormalSampler(9)
    const random = mulberry32(9)
    const u = random()
    const v = random()
    const radius = Math.sqrt(-2 * Math.log(u))
    expect(sampler()).toBeCloseTo(radius * Math.cos(2 * Math.PI * v), 12)
    expect(sampler()).toBeCloseTo(radius * Math.sin(2 * Math.PI * v), 12)
  })

  it('is deterministic for a seed', () => {
    const a = createNormalSampler(3)
    const b = createNormalSampler(3)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })
})
