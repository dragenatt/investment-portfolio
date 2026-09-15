import { describe, it, expect } from 'vitest'
import {
  averageDailyVolumes,
  computePortfolioHealth,
  gradeLinear,
  MIN_COMPONENTS_FOR_SCORE,
  type HealthHolding,
  type HealthInput,
} from '@/lib/services/portfolio-health'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const T = 250
function noise(seed: number, sd: number): number[] {
  const random = mulberry32(seed)
  return Array.from({ length: T }, () => standardNormal(random) * sd)
}
const add = (a: number[], b: number[], k = 1) => a.map((v, t) => v + k * b[t])

const holding = (symbol: string, weight: number, over: Partial<HealthHolding> = {}): HealthHolding => ({
  symbol,
  weight,
  quantity: 10,
  assetType: 'stock',
  companySector: 'Technology',
  currency: 'USD',
  country: 'United States',
  averageDailyVolume: 5_000_000,
  ...over,
})

function build(
  holdings: HealthHolding[],
  returnsMatrix: number[][],
  benchmarkReturns: number[] | null,
  factors?: Array<{ id: string; name: string; returns: number[] }>,
): HealthInput {
  const riskSources = analyseRiskSources({
    symbols: holdings.map((h) => h.symbol),
    weights: holdings.map((h) => h.weight),
    returnsMatrix,
    periodsPerYear: 252,
    benchmark: benchmarkReturns ? { symbol: 'SPY', name: 'S&P 500', returns: benchmarkReturns } : null,
    factors,
  })!
  return { holdings, returnsMatrix, benchmarkReturns, benchmarkName: 'S&P 500', periodsPerYear: 252, riskSources }
}

const market = noise(1, 0.01)
type Health = NonNullable<ReturnType<typeof computePortfolioHealth>>
const component = (health: Health, id: string) => health.components.find((c) => c.id === id)!

describe('gradeLinear', () => {
  it('is 100 up to the full mark, 0 from the zero mark, linear between, in either direction', () => {
    expect(gradeLinear(5, 10, 40)).toBe(100)
    expect(gradeLinear(25, 10, 40)).toBe(50)
    expect(gradeLinear(60, 10, 40)).toBe(0)
    expect(gradeLinear(6, 5, 1)).toBe(100) // higher is better
    expect(gradeLinear(3, 5, 1)).toBe(50)
    expect(gradeLinear(NaN, 5, 1)).toBe(0)
  })
})

describe('computePortfolioHealth', () => {
  const returns = [
    add(noise(2, 0.006), market),
    add(noise(3, 0.006), market),
    add(noise(4, 0.004), market, 0.5),
    add(noise(5, 0.008), market, 1.2),
  ]
  const holdings = [
    holding('AAA', 0.25),
    holding('BBB', 0.25, { companySector: 'Health Care' }),
    holding('CCC', 0.25, { companySector: 'Utilities' }),
    holding('DDD', 0.25, { assetType: 'etf', companySector: null }),
  ]
  const health = computePortfolioHealth(build(holdings, returns, market))!

  it('averages the components that have data into one score with a band', () => {
    const scored = health.components.filter((c) => c.score !== null)
    expect(health.componentsScored).toBe(scored.length)
    expect(health.score).toBe(Math.round(scored.reduce((s, c) => s + c.score!, 0) / scored.length))
    expect(health.bandLabel).toBe(health.score! >= 75 ? 'Sólida' : health.score! >= 50 ? 'Mejorable' : 'Frágil')
    for (const c of health.components) {
      expect(c.threshold.length).toBeGreaterThan(10)
      expect(c.basis.length).toBeGreaterThan(10)
      if (c.score === null) expect(c.unavailableReason).toBeTruthy()
      else expect(c.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports what it could not measure instead of scoring it', () => {
    // No factor series were given.
    expect(component(health, 'factors').score).toBeNull()
    const unknownRegion = computePortfolioHealth(build(holdings.map((h) => ({ ...h, country: null })), returns, market))!
    expect(component(unknownRegion, 'geography').score).toBeNull()
    expect(component(unknownRegion, 'geography').unavailableReason).toContain('moneda')
  })

  it('grades concentration on single issuers only, with the UCITS limits as the full marks', () => {
    expect(component(health, 'concentration').measured).toContain('25.0%')
    // Largest 25% → (40−25)/30 = 50; 75% above 5% → (100−75)/60 ≈ 42; averaged → 46.
    expect(component(health, 'concentration').score).toBe(46)
    const funds = computePortfolioHealth(build(holdings.map((h) => ({ ...h, assetType: 'etf' })), returns, market))!
    expect(component(funds, 'concentration').score).toBe(100)
  })

  it('grades risk and drawdown against the benchmark, and tracking error against its own marks', () => {
    const same = computePortfolioHealth(
      build([holding('IDX', 0.5, { assetType: 'etf' }), holding('IDX2', 0.5, { assetType: 'etf' })], [market, market], market),
    )!
    expect(component(same, 'risk').score).toBe(100)
    expect(component(same, 'drawdown').score).toBe(100)
    expect(component(same, 'benchmark').score).toBe(100)
    expect(component(same, 'benchmark').measured).toContain('0.0%')

    const doubled = market.map((r) => 2 * r)
    const leveraged = computePortfolioHealth(
      build([holding('LEV', 0.5, { assetType: 'etf' }), holding('LEV2', 0.5, { assetType: 'etf' })], [doubled, doubled], market),
    )!
    expect(component(leveraged, 'risk').score).toBe(0)
    expect(component(leveraged, 'risk').measured).toContain('2.00 veces')
  })

  it('measures liquidity as the share of value sellable within three days at 20% of volume, leaving indices out', () => {
    const thin = computePortfolioHealth(
      build(
        [
          holding('BIG', 0.5, { quantity: 1_000_000, averageDailyVolume: 100_000 }), // 50 days
          holding('SMALL', 0.3, { quantity: 10, averageDailyVolume: 100_000 }),
          holding('^GSPC', 0.2, { assetType: 'index', averageDailyVolume: null }),
        ],
        [returns[0], returns[1], returns[2]],
        market,
      ),
    )!
    // Of the 80% that is tradable and measured, 30 points are liquid: 37.5%.
    expect(component(thin, 'liquidity').score).toBe(Math.round((0.3 / 0.8) * 100))
    expect(component(thin, 'liquidity').measured).toContain('BIG')

    const noVolume = computePortfolioHealth(build(holdings.map((h) => ({ ...h, averageDailyVolume: null })), returns, market))!
    expect(component(noVolume, 'liquidity').score).toBeNull()
  })

  it('needs half the portfolio to have a known sector before grading sectors', () => {
    const unknown = computePortfolioHealth(
      build(holdings.map((h, i) => ({ ...h, companySector: i === 0 ? 'Technology' : null })), returns, market),
    )!
    expect(component(unknown, 'sector').score).toBeNull()
    expect(component(health, 'sector').score).toBe(100) // 25% in the largest sector
  })

  it('counts strong, significant factor tilts outside the market', () => {
    const tilt = noise(9, 0.006)
    const tilted = [add(add(noise(10, 0.002), market), tilt, 0.9), add(add(noise(11, 0.002), market), tilt, 0.8)]
    const withFactors = computePortfolioHealth(
      build([holding('T1', 0.5), holding('T2', 0.5, { companySector: 'Energy' })], tilted, market, [
        { id: 'market', name: 'Mercado', returns: market },
        { id: 'value', name: 'Valor', returns: tilt },
      ]),
    )!
    expect(component(withFactors, 'factors').score).toBe(66)
    expect(component(withFactors, 'factors').measured).toContain('Valor')
  })

  it('withholds the overall score when fewer than four components could be measured', () => {
    const bare = computePortfolioHealth(
      build(
        [
          holding('X', 0.5, { companySector: null, country: null, averageDailyVolume: null }),
          holding('Y', 0.5, { companySector: null, country: null, averageDailyVolume: null }),
        ],
        [returns[0], returns[1]],
        null,
      ),
    )!
    expect(bare.componentsScored).toBeLessThan(MIN_COMPONENTS_FOR_SCORE)
    expect(bare.score).toBeNull()
    expect(bare.band).toBeNull()
    expect(bare.summary).toContain(`se necesitan ${MIN_COMPONENTS_FOR_SCORE}`)
  })

  it('says what lifts and lowers the score without advising a trade', () => {
    expect(health.summary).toContain(`${health.score} de 100`)
    const text = `${health.summary} ${health.components.map((c) => c.measured).join(' ')}`.toLowerCase()
    // "se vendería en 3 días" describes liquidity; an instruction to buy or sell would read "compra" or "vende".
    expect(text).not.toMatch(/compr(a|e|ar)|vend(e|er|a)|deber[ií]as|recomend/)
    expect(health.caveat).toContain('no predice su rendimiento ni es una recomendación')
  })

  it('refuses inputs that do not line up', () => {
    const input = build(holdings, returns, market)
    expect(computePortfolioHealth({ ...input, returnsMatrix: returns.slice(1) })).toBeNull()
    expect(computePortfolioHealth({ ...input, holdings: holdings.map((h) => ({ ...h, weight: NaN })) })).toBeNull()
  })
})

describe('averageDailyVolumes', () => {
  it('averages the most recent sessions per symbol, skipping empty volume', () => {
    const rows = [
      { symbol: 'A', date: '2026-09-10', volume: 300 },
      { symbol: 'A', date: '2026-09-14', volume: 100 },
      { symbol: 'A', date: '2026-09-11', volume: 200 },
      { symbol: 'A', date: '2026-09-09', volume: 0 },
      { symbol: '^IDX', date: '2026-09-14', volume: null },
    ]
    expect(averageDailyVolumes(rows, 2)).toEqual({ A: 150 })
  })
})
