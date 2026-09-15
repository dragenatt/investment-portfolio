import { describe, it, expect } from 'vitest'
import {
  closeReturn,
  diagnosePortfolio,
  DIAGNOSTIC_QUESTION_IDS,
  twrIndex,
  type DiagnosticInput,
} from '@/lib/services/portfolio-diagnostic'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { portfolioVolatility } from '@/lib/services/risk-attribution'
import type { TemporalAttribution } from '@/lib/services/temporal-attribution'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const T = 200
function noise(seed: number, sd: number): number[] {
  const random = mulberry32(seed)
  return Array.from({ length: T }, () => standardNormal(random) * sd)
}

/** Daily buckets from a list of returns in %, with holdings contributions split 60/40. */
function attributionFrom(returnsPct: number[]): TemporalAttribution {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
  const buckets = returnsPct.map((r, i) => ({
    key: day(i + 1),
    label: day(i + 1),
    start: day(i),
    end: day(i + 1),
    subPeriods: 1,
    portfolioReturnPct: r,
    holdings: [
      { symbol: 'AAA', contributionPct: r * 0.6, assetReturnPct: r, averageWeightPct: 60 },
      { symbol: 'BBB', contributionPct: r * 0.4, assetReturnPct: r, averageWeightPct: 40 },
    ],
  }))
  const growth = returnsPct.reduce((g, r) => g * (1 + r / 100), 1)
  return {
    granularity: 'day',
    buckets,
    total: {
      start: day(0),
      end: day(returnsPct.length),
      subPeriods: returnsPct.length,
      portfolioReturnPct: (growth - 1) * 100,
      holdings: [
        { symbol: 'AAA', contributionPct: (growth - 1) * 60, assetReturnPct: 0, averageWeightPct: 60 },
        { symbol: 'BBB', contributionPct: (growth - 1) * 40, assetReturnPct: 0, averageWeightPct: 40 },
      ],
    },
    unmeasurable: 0,
    unlinkable: 0,
  }
}

function input(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  const market = noise(1, 0.01)
  const returnsMatrix = [noise(2, 0.02).map((r, t) => r + market[t]), noise(3, 0.004).map((r, t) => r + 0.3 * market[t])]
  const holdings = [
    { symbol: 'AAA', weight: 0.6, companySector: 'Technology' },
    { symbol: 'BBB', weight: 0.4, companySector: 'Utilities' },
  ]
  const riskSources = analyseRiskSources({
    symbols: ['AAA', 'BBB'],
    weights: [0.6, 0.4],
    returnsMatrix,
    periodsPerYear: 252,
    sectors: { AAA: 'Technology', BBB: 'Utilities' },
  })!
  const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * 252))
  return {
    riskSources,
    holdings,
    cov,
    growth: [1.5, 1.0],
    windowStart: '2026-01-01',
    // Up 10%, down 20% over two days, back up to the old peak on the fourth.
    attribution: attributionFrom([10, -10, -11.1111111111, 25]),
    benchmark: { name: 'S&P 500', returnPct: 5 },
    ...overrides,
  }
}

describe('diagnosePortfolio', () => {
  const diagnostic = diagnosePortfolio(input())
  const answer = (id: string) => diagnostic.answers.find((a) => a.id === id)!

  it('answers the nine questions, in order, each with a sentence and its figures', () => {
    expect(diagnostic.answers.map((a) => a.id)).toEqual([...DIAGNOSTIC_QUESTION_IDS])
    expect(diagnostic.answered).toBe(9)
    for (const a of diagnostic.answers) {
      expect(a.question.startsWith('¿')).toBe(true)
      expect(a.answer!.length).toBeGreaterThan(20)
    }
  })

  it('names where the risk and the return come from', () => {
    expect(answer('risk_concentration').answer).toContain('AAA')
    expect(answer('top_risk').answer).toContain('AAA')
    expect(answer('top_return').answer).toMatch(/^AAA, con \+/)
  })

  it('flags a sector only above the exposure threshold', () => {
    expect(answer('sector_overexposure').answer).toBe('Technology (60%) y Utilities (40%) pasan de 35% del portafolio.')
    const spread = diagnosePortfolio(input({ holdings: [
      { symbol: 'AAA', weight: 0.3, companySector: 'Technology' },
      { symbol: 'BBB', weight: 0.3, companySector: 'Utilities' },
      { symbol: 'CCC', weight: 0.4, companySector: null },
    ] }))
    const a = spread.answers.find((x) => x.id === 'sector_overexposure')!
    expect(a.answer).toContain('Ninguno pasa de 35%')
    expect(a.answer).toContain('solo se conoce para 60%')
  })

  it('compares the time-weighted return with the benchmark over the same dates', () => {
    const total = input().attribution!.total!
    const a = answer('vs_benchmark')
    expect(a.answer).toContain(`${total.start} y ${total.end}`)
    expect(a.figures.find((f) => f.label === 'Diferencia')!.value).toBe(`${total.portfolioReturnPct - 5 > 0 ? '+' : ''}${(total.portfolioReturnPct - 5).toFixed(2)} pp`)
  })

  it('finds the worst drawdown on the time-weighted index and how long the recovery took', () => {
    // 1 → 1.10 → 0.99 → 0.88 → 1.10: a 20% fall over two days, back at the old peak the next day.
    expect(answer('worst_drawdown').answer).toMatch(/^20\.0% desde el máximo del 2026-01-02 hasta el mínimo del 2026-01-04 \(2 días de caída\)/)
    expect(answer('recovery').answer).toMatch(/^1 día: el portafolio volvió al máximo previo el 2026-01-05\./)

    const underwater = diagnosePortfolio(input({ attribution: attributionFrom([10, -20]) }))
    expect(underwater.answers.find((a) => a.id === 'recovery')!.answer).toContain('Todavía no se recupera')
  })

  it('measures a 5-point shift between the most and least risk-moving weights, as a sensitivity', () => {
    const base = input()
    const a = answer('risk_levers')
    const after = portfolioVolatility([0.55, 0.45], base.cov!)!
    expect(a.answer).toContain('de AAA y el que menos, el de BBB')
    expect(a.answer).toContain(`a ${(after * 100).toFixed(1)}%`)
    expect(a.answer).toContain('no sugerencias')
  })

  it('undoes the drift prices caused, from the growth of each holding, without calling it the old book', () => {
    const a = answer('rebalance')
    // AAA grew 1.5×, BBB not at all: start weights 0.4 / 0.4 → normalised 0.5 / 0.5; rotation 10 points.
    expect(a.answer).toContain('rotaría 10.0 puntos')
    expect(a.answer).toContain('con tus cantidades actuales')
    expect(a.answer).toContain('nada se ejecuta')
    const still = diagnosePortfolio(input({ growth: [1.001, 1.0] }))
    expect(still.answers.find((x) => x.id === 'rebalance')!.answer).toMatch(/^Casi nada/)
  })

  it('says which answers it could not give, and why, instead of guessing', () => {
    const empty = diagnosePortfolio({ riskSources: null, holdings: null, cov: null, growth: null, windowStart: null, attribution: null, benchmark: null })
    expect(empty.answered).toBe(0)
    for (const a of empty.answers) {
      expect(a.answer).toBeNull()
      expect(a.unavailableReason!.length).toBeGreaterThan(10)
    }
    const noBenchmark = diagnosePortfolio(input({ benchmark: { name: 'S&P 500', returnPct: null } }))
    expect(noBenchmark.answers.find((a) => a.id === 'vs_benchmark')!.answer).toBeNull()
  })

  it('never tells the reader to trade', () => {
    const text = diagnostic.answers.map((a) => a.answer).join(' ').toLowerCase()
    expect(text).not.toMatch(/\bcompr(a|e|ar)\b|\bvend(e|er|a)\b|deber[ií]as|recomend/)
    expect(diagnostic.caveat).toContain('no ejecuta cambios ni recomienda')
  })
})

describe('twrIndex and closeReturn', () => {
  it('chains daily returns into an index starting at 1', () => {
    const index = twrIndex(attributionFrom([10, -10]))
    expect(index.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
    expect(index.map((p) => Number(p.value.toFixed(6)))).toEqual([1, 1.1, 0.99])
    expect(twrIndex(null)).toEqual([])
  })

  it('takes the last close on or before each date', () => {
    const closes = { '2026-01-02': 100, '2026-01-05': 110, '2026-01-09': 121 }
    expect(closeReturn(closes, '2026-01-03', '2026-01-08')).toBeCloseTo(10, 9)
    expect(closeReturn(closes, '2026-01-02', '2026-01-10')).toBeCloseTo(21, 9)
    expect(closeReturn(closes, '2026-01-01', '2026-01-08')).toBeNull()
  })
})
