import { describe, it, expect } from 'vitest'
import { viewsFromInputs, describeView, impliedEquilibriumReturns, type ViewInput } from '@/lib/services/black-litterman'
import { compareModels, type ModelComparisonInput } from '@/lib/services/model-comparison'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { historicalExpectedReturns } from '@/lib/services/optimizer'
import { mulberry32, standardNormal } from '@/lib/utils/random'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

// 4.7. The model comparison ran Black-Litterman with no opinions, so it could
// only ever return the current book. Synthetic returns only.

const T = 300
function noise(seed: number, sd: number, drift = 0): number[] {
  const random = mulberry32(seed)
  return Array.from({ length: T }, () => drift + standardNormal(random) * sd)
}
const add = (...series: number[][]) => series[0].map((_, t) => series.reduce((s, x) => s + x[t], 0))

function input(views?: ViewInput[]): ModelComparisonInput {
  const market = noise(1, 0.009, 0.0003)
  const returnsMatrix = [
    add(market, noise(2, 0.012, 0.0006)),
    add(market, noise(3, 0.006, 0.0002)),
    add(noise(4, 0.003, 0.0001), market.map((m) => m * 0.1)),
    add(market, noise(5, 0.01, -0.0001)),
  ]
  const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * TRADING_DAYS_PER_YEAR))
  return {
    symbols: ['GROW', 'CORE', 'BOND', 'FLAT'],
    returnsMatrix,
    cov,
    estimatedReturns: historicalExpectedReturns(returnsMatrix)!,
    riskFreeRate: 0.04,
    currentWeights: [0.4, 0.3, 0.2, 0.1],
    views,
  }
}

describe('viewsFromInputs', () => {
  const symbols = ['A', 'B', 'C']
  const equilibrium = [0.05, 0.07, 0.03]

  it('reads "N points above what the market implies" against that asset\'s own equilibrium', () => {
    const { views } = viewsFromInputs([{ kind: 'vsEquilibrium', symbol: 'B', pct: 2, confidencePct: 60 }], symbols, equilibrium)
    expect(views).toEqual([{ symbols: ['B'], weights: [1], expectedReturn: 0.07 + 0.02, confidence: 0.6 }])
  })

  it('reads an absolute level and a relative view as the model expects them', () => {
    const { views } = viewsFromInputs(
      [
        { kind: 'absolute', symbol: 'A', pct: 9, confidencePct: 50 },
        { kind: 'outperform', symbol: 'A', other: 'C', pct: 3, confidencePct: 75 },
      ],
      symbols,
      equilibrium,
    )
    expect(views[0]).toEqual({ symbols: ['A'], weights: [1], expectedReturn: 0.09, confidence: 0.5 })
    expect(views[1]).toEqual({ symbols: ['A', 'C'], weights: [1, -1], expectedReturn: 0.03, confidence: 0.75 })
  })

  it('refuses, with a reason, what it cannot apply — never drops it silently', () => {
    const { views, rejected } = viewsFromInputs(
      [
        { kind: 'absolute', symbol: 'ZZZ', pct: 5, confidencePct: 50 },
        { kind: 'outperform', symbol: 'A', other: 'A', pct: 1, confidencePct: 50 },
        { kind: 'vsEquilibrium', symbol: 'A', pct: 1, confidencePct: 100 },
        { kind: 'vsEquilibrium', symbol: 'C', pct: -1, confidencePct: 40 },
      ],
      symbols,
      equilibrium,
    )
    expect(views).toHaveLength(1)
    expect(rejected.map((r) => r.index)).toEqual([0, 1, 2])
    expect(rejected[0].reason).toMatch(/ZZZ/)
    expect(rejected[2].reason).toMatch(/1% a 99%/)
  })

  it('says an opinion back in words', () => {
    expect(describeView({ kind: 'vsEquilibrium', symbol: 'AAPL', pct: 2, confidencePct: 60 })).toBe(
      'AAPL rendirá 2.0 puntos más de lo que el mercado implica (confianza 60%)',
    )
    expect(describeView({ kind: 'outperform', symbol: 'AAPL', other: 'MSFT', pct: -1.5, confidencePct: 25 })).toBe(
      'AAPL quedará detrás de MSFT por 1.5 puntos al año (confianza 25%)',
    )
  })
})

describe('model comparison with opinions', () => {
  it('without opinions, Black-Litterman hands the current book back and says so', () => {
    const result = compareModels(input())!
    const bl = result.models.find((m) => m.id === 'blackLitterman')!
    expect(bl.weights.map((w) => w.weight)).toEqual([0.4, 0.3, 0.2, 0.1].map((v) => expect.closeTo(v, 3)))
    expect(result.blackLitterman?.viewsApplied).toBe(0)
    expect(result.blackLitterman?.summary).toMatch(/Sin opiniones/)
  })

  it('an opinion moves the weights, and the explanation compares them with the equilibrium', () => {
    const result = compareModels(input([{ kind: 'vsEquilibrium', symbol: 'GROW', pct: 4, confidencePct: 75 }]))!
    const detail = result.blackLitterman!
    expect(detail.viewsApplied).toBe(1)
    const grow = detail.weightShifts.find((s) => s.symbol === 'GROW')!
    expect(grow.deltaPp).toBeGreaterThan(1)
    const growReturn = detail.returns.find((r) => r.symbol === 'GROW')!
    expect(growReturn.posteriorPct).toBeGreaterThan(growReturn.equilibriumPct)
    // The weights in the table are the model the comparison measured.
    const bl = result.models.find((m) => m.id === 'blackLitterman')!
    expect(bl.weights.find((w) => w.symbol === 'GROW')!.weight).toBeCloseTo(grow.blackLittermanWeight, 10)
    expect(detail.views).toEqual(['GROW rendirá 4.0 puntos más de lo que el mercado implica (confianza 75%)'])
    expect(detail.notes).toEqual([])
  })

  it('explains a weight that moves against the opinion, which is the model working', () => {
    // BOND is calm; CORE and FLAT move with it more than it moves with them
    // (cov with BOND above BOND's own variance). Raising BOND's expected return
    // raises theirs by more — exactly Σ_jB / Σ_BB times as much — and the
    // optimiser holds less BOND. Correct, and a reader would call it a bug.
    const result = compareModels(input([{ kind: 'vsEquilibrium', symbol: 'BOND', pct: 4, confidencePct: 75 }]))!
    const detail = result.blackLitterman!
    const bond = detail.weightShifts.find((s) => s.symbol === 'BOND')!
    const bondReturn = detail.returns.find((r) => r.symbol === 'BOND')!
    expect(bondReturn.posteriorPct).toBeGreaterThan(bondReturn.equilibriumPct)
    expect(bond.deltaPp).toBeLessThan(-1)
    expect(detail.notes).toHaveLength(1)
    expect(detail.notes[0]).toMatch(/no un error/)
    expect(detail.notes[0]).toMatch(/superará a/)
  })

  it('a relative opinion moves the pair the way it says', () => {
    const result = compareModels(input([{ kind: 'outperform', symbol: 'BOND', other: 'FLAT', pct: 6, confidencePct: 75 }]))!
    const shift = (s: string) => result.blackLitterman!.weightShifts.find((x) => x.symbol === s)!.deltaPp
    expect(shift('BOND')).toBeGreaterThan(shift('FLAT'))
  })

  it('reports an opinion it could not apply next to the result', () => {
    const result = compareModels(input([{ kind: 'absolute', symbol: 'NOPE', pct: 10, confidencePct: 50 }]))!
    expect(result.blackLitterman?.viewsApplied).toBe(0)
    expect(result.blackLitterman?.rejected[0].view).toMatch(/NOPE/)
  })

  it('reads "above the equilibrium" against the same equilibrium the model starts from', () => {
    const i = input()
    const equilibrium = impliedEquilibriumReturns(i.cov, i.currentWeights!)!
    const result = compareModels(input([{ kind: 'vsEquilibrium', symbol: 'CORE', pct: 0, confidencePct: 90 }]))!
    // An opinion that the asset returns exactly its equilibrium changes nothing.
    const core = result.blackLitterman!.returns.find((r) => r.symbol === 'CORE')!
    expect(core.posteriorPct).toBeCloseTo(equilibrium[1] * 100, 6)
  })
})
