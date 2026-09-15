import { describe, it, expect } from 'vitest'
import { alignRiskInputs, analyseRiskSources, MIN_RISK_OBSERVATIONS, MIN_SERIES_COVERAGE, realSector, sectorLabel, type RiskSourcesInput } from '@/lib/services/risk-sources'
import { runFactorRegression } from '@/lib/services/factors'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const T = 250

/** A seeded normal series with a given daily volatility. */
function noise(seed: number, sd: number, length = T): number[] {
  const random = mulberry32(seed)
  return Array.from({ length }, () => standardNormal(random) * sd)
}

const add = (...series: number[][]) => series[0].map((_, t) => series.reduce((sum, s) => sum + s[t], 0))
const scale = (series: number[], k: number) => series.map((v) => v * k)
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** A small book: two tech names driven by one shared shock, one bond-like holding, and a market series. */
function book(): RiskSourcesInput {
  const market = noise(1, 0.01)
  const tech = noise(2, 0.008)
  const aapl = add(scale(market, 1.1), tech, noise(3, 0.006))
  const msft = add(scale(market, 1.0), tech, noise(4, 0.006))
  const bond = add(scale(market, 0.1), noise(5, 0.002))
  return {
    symbols: ['AAPL', 'MSFT', 'BND'],
    weights: [0.4, 0.3, 0.3],
    returnsMatrix: [aapl, msft, bond],
    periodsPerYear: 252,
    sectors: { AAPL: 'Tecnología', MSFT: 'Tecnología', BND: 'Renta fija' },
    benchmark: { symbol: 'SPY', name: 'S&P 500', returns: market },
    factors: [
      { id: 'market', name: 'Mercado', returns: market },
      { id: 'tech', name: 'Tecnología (sintético)', returns: tech },
    ],
  }
}

describe('analyseRiskSources: every view adds up to the same risk', () => {
  const sources = analyseRiskSources(book())!

  it('splits the risk across holdings, summing to 100%', () => {
    expect(sources).not.toBeNull()
    expect(sum(sources.byAsset.map((a) => a.percentOfRisk))).toBeCloseTo(100, 2)
    expect(sources.byAsset.map((a) => a.symbol)).toEqual(['AAPL', 'MSFT', 'BND'])
  })

  it('adds holdings up by sector without losing anything', () => {
    expect(sum(sources.bySector.map((s) => s.percentOfRisk))).toBeCloseTo(100, 2)
    const tech = sources.bySector.find((s) => s.sector === 'Tecnología')!
    const expected = sources.byAsset.filter((a) => a.sector === 'Tecnología').reduce((acc, a) => acc + a.percentOfRisk, 0)
    expect(tech.percentOfRisk).toBeCloseTo(expected, 3)
    expect(tech.weightPct).toBeCloseTo(70, 3)
    // The two tech names hold 70% of the money and far more of the risk.
    expect(tech.percentOfRisk).toBeGreaterThan(90)
  })

  it('splits it across principal components, summing to 100%', () => {
    const components = sources.byComponent!.components
    expect(sum(components.map((c) => c.percentOfRisk))).toBeCloseTo(100, 2)
    expect(sum(components.map((c) => c.varianceExplainedPct))).toBeCloseTo(100, 2)
    // AAPL and MSFT share two drivers, so one direction carries most of the book.
    expect(components[0].percentOfRisk).toBeGreaterThan(80)
    expect(components[0].nearlyTied).toBe(false)
    expect(components[0].loadings.map((l) => l.symbol).slice(0, 2).sort()).toEqual(['AAPL', 'MSFT'])
    expect(sources.byComponent!.effectiveBets).toBeLessThan(2)
  })

  it('splits it into factors plus a specific part, and the factor share is the regression R²', () => {
    const f = sources.byFactor!
    expect(f.explainedPct + f.specificPct).toBeCloseTo(100, 6)
    expect(sum(f.factors.map((x) => x.percentOfRisk))).toBeCloseTo(f.explainedPct, 3)

    const input = book()
    const portfolio = input.returnsMatrix[0].map((_, t) => sum(input.weights.map((w, i) => w * input.returnsMatrix[i][t])))
    const regression = runFactorRegression(portfolio, input.factors!.map((x) => ({ name: x.name, returns: x.returns })))!
    expect(f.explainedPct).toBeCloseTo(regression.rSquared * 100, 4)
  })

  it('reports the market share as the squared correlation, and beta as cov / var', () => {
    const m = sources.market!
    // Both are rounded to four decimals, so they agree to about a hundredth of a point.
    expect(m.systematicPct).toBeCloseTo(m.correlation * m.correlation * 100, 1)
    expect(m.systematicPct + m.specificPct).toBeCloseTo(100, 6)
    // Weighted market loadings: 0.4·1.1 + 0.3·1.0 + 0.3·0.1 = 0.77, before sampling noise.
    expect(m.beta).toBeGreaterThan(0.65)
    expect(m.beta).toBeLessThan(0.9)
  })

  it('answers the question in sentences built from those numbers, with no advice in them', () => {
    expect(sources.findings.length).toBeGreaterThanOrEqual(4)
    expect(sources.findings[0]).toContain('AAPL')
    expect(sources.findings.join(' ')).toContain('Tecnología')
    expect(sources.findings.join(' ').toLowerCase()).not.toMatch(/\b(compra|vende|deberías|recomend)/)
  })
})

describe('analyseRiskSources: known cases', () => {
  it('gives two uncorrelated holdings of equal volatility and weight half the risk each', () => {
    const sources = analyseRiskSources({
      symbols: ['A', 'B'],
      weights: [1, 1],
      returnsMatrix: [noise(10, 0.01, 2000), noise(11, 0.01, 2000)],
      periodsPerYear: 252,
    })!
    expect(sources.byAsset[0].weightPct).toBeCloseTo(50, 6)
    for (const asset of sources.byAsset) expect(asset.percentOfRisk).toBeCloseTo(50, -0.5)
    expect(sources.byComponent!.effectiveBets).toBeGreaterThan(1.9)
    // Equal variances: the two directions are tied, so their split of the risk is not reported as a finding.
    expect(sources.byComponent!.components.every((c) => c.nearlyTied)).toBe(true)
    expect(sources.findings.join(' ')).not.toContain('una sola dirección')
    expect(sources.bySector).toEqual([expect.objectContaining({ sector: 'Sin clasificar', percentOfRisk: expect.closeTo(100, 3) })])
  })

  it('counts two holdings that move identically as one bet', () => {
    const series = noise(20, 0.01)
    const sources = analyseRiskSources({
      symbols: ['A', 'A2'],
      weights: [0.5, 0.5],
      returnsMatrix: [series, scale(series, 1)],
      periodsPerYear: 252,
    })!
    expect(sources.byComponent!.effectiveBets).toBeCloseTo(1, 4)
    expect(sources.byComponent!.components[0].percentOfRisk).toBeCloseTo(100, 4)
    expect(sources.correlation.highestPair).toEqual({ a: 'A', b: 'A2', correlation: 1 })
    expect(sources.findings.join(' ')).toContain('se movieron casi igual')
  })

  it('lets a hedge carry negative risk, and the rest more than 100%', () => {
    const base = noise(30, 0.01)
    const sources = analyseRiskSources({
      symbols: ['LONG', 'HEDGE'],
      weights: [0.8, 0.2],
      returnsMatrix: [base, add(scale(base, -0.5), noise(31, 0.002))],
      periodsPerYear: 252,
    })!
    const hedge = sources.byAsset.find((a) => a.symbol === 'HEDGE')!
    expect(hedge.percentOfRisk).toBeLessThan(0)
    expect(hedge.correlationWithPortfolio).toBeLessThan(0)
    expect(sum(sources.byAsset.map((a) => a.percentOfRisk))).toBeCloseTo(100, 2)
  })

  it('annualises volatility by the cadence it is given', () => {
    const series = noise(40, 0.02, 60)
    const daily = analyseRiskSources({ symbols: ['A', 'B'], weights: [1, 0], returnsMatrix: [series, noise(41, 0.01, 60)], periodsPerYear: 252 })!
    const weekly = analyseRiskSources({ symbols: ['A', 'B'], weights: [1, 0], returnsMatrix: [series, noise(41, 0.01, 60)], periodsPerYear: 52 })!
    expect(daily.portfolioVolatilityPct / weekly.portfolioVolatilityPct).toBeCloseTo(Math.sqrt(252 / 52), 4)
  })
})

describe('analyseRiskSources: nothing invalid reaches the interface', () => {
  const base = book()

  it('refuses too short a window, mismatched inputs and a worthless book', () => {
    const short = MIN_RISK_OBSERVATIONS - 1
    expect(analyseRiskSources({ ...base, returnsMatrix: base.returnsMatrix.map((r) => r.slice(0, short)) })).toBeNull()
    expect(analyseRiskSources({ ...base, weights: [1, 1] })).toBeNull()
    expect(analyseRiskSources({ ...base, weights: [0, 0, 0] })).toBeNull()
    expect(analyseRiskSources({ ...base, returnsMatrix: [base.returnsMatrix[0], base.returnsMatrix[1], [NaN, ...base.returnsMatrix[2].slice(1)]] })).toBeNull()
    expect(analyseRiskSources({ ...base, returnsMatrix: base.returnsMatrix.map((r) => r.map(() => 0)) })).toBeNull()
  })

  it('leaves out the market and factor views when their series do not line up', () => {
    const sources = analyseRiskSources({
      ...base,
      benchmark: { ...base.benchmark!, returns: base.benchmark!.returns.slice(1) },
      factors: base.factors!.map((f) => ({ ...f, returns: f.returns.slice(1) })),
    })!
    expect(sources.market).toBeNull()
    expect(sources.byFactor).toBeNull()
    expect(sources.byAsset.every((a) => a.betaToBenchmark === null)).toBe(true)
  })

  it('produces only finite numbers', () => {
    const sources = analyseRiskSources(base)!
    const numbers: number[] = []
    JSON.stringify(sources, (_, value) => {
      if (typeof value === 'number') numbers.push(value)
      return value
    })
    expect(numbers.length).toBeGreaterThan(20)
    expect(numbers.every(Number.isFinite)).toBe(true)
  })
})

describe('sectorLabel', () => {
  it('prefers the company sector, then the asset type in Spanish', () => {
    expect(sectorLabel('Technology', 'stock')).toBe('Technology')
    expect(sectorLabel(null, 'index')).toBe('Índices')
    expect(sectorLabel('  ', 'etf')).toBe('ETF')
    expect(sectorLabel(undefined, 'warrant')).toBe('Warrant')
    expect(sectorLabel(null, null)).toBe('Sin clasificar')
    // Some company data puts the asset class in the sector field.
    expect(sectorLabel('ETF', 'etf')).toBe('ETF')
    expect(sectorLabel('Index', 'index')).toBe('Índices')
    expect(realSector('ETF')).toBeNull()
    expect(realSector(' Technology ')).toBe('Technology')
  })
})

describe('alignRiskInputs', () => {
  const dates = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14']
  const returnsMatrix = [[0.01, 0.02, 0.03, 0.04]]

  it('takes the benchmark return over exactly each holding interval', () => {
    const closes = new Map([['2026-09-08', 100], ['2026-09-09', 101], ['2026-09-10', 99.99], ['2026-09-11', 102], ['2026-09-14', 102]])
    const aligned = alignRiskInputs({ dates, returnsMatrix, benchmarkCloses: closes })
    expect(aligned.intervalsUsed).toBe(4)
    expect(aligned.benchmarkReturns!.map((r) => Number(r.toFixed(4)))).toEqual([0.01, -0.01, 0.0201, 0])
    expect(aligned.returnsMatrix).toEqual(returnsMatrix)
  })

  it('uses a factor return only where the two dates are consecutive on the factor grid', () => {
    // 09-08 → 09-09: the grid has no day before 09-09. 09-11 → 09-14: the grid has 09-12 in between, so no
    // one-day factor return matches that interval. Only the two middle intervals line up.
    const factorGrid = {
      dates: ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-14'],
      factors: [{ id: 'market', name: 'Mercado', returns: [0.1, 0.2, 0.3, 0.4, 0.5] }],
    }
    const aligned = alignRiskInputs({ dates, returnsMatrix, factorGrid })
    // Two of four is under the coverage bar: the factors are left out, the holdings keep every interval.
    expect(MIN_SERIES_COVERAGE).toBeGreaterThan(0.5)
    expect(aligned.factors).toBeNull()
    expect(aligned.intervalsUsed).toBe(4)
    expect(aligned.omitted.factors).toContain('2 de 4')
  })

  it('drops the few intervals a well-covered series lacks, for every series at once', () => {
    const days = Array.from({ length: 41 }, (_, i) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10))
    const matrix = [days.slice(1).map((_, t) => t / 1000)]
    const closes = new Map(days.map((d, i) => [d, 100 + i]))
    closes.delete(days[20]) // one missing close costs the two intervals that touch it
    const aligned = alignRiskInputs({ dates: days, returnsMatrix: matrix, benchmarkCloses: closes })
    expect(aligned.intervalsAvailable).toBe(40)
    expect(aligned.intervalsUsed).toBe(38)
    expect(aligned.returnsMatrix[0]).toHaveLength(38)
    expect(aligned.benchmarkReturns).toHaveLength(38)
    expect(aligned.omitted).toEqual({})
  })
})
