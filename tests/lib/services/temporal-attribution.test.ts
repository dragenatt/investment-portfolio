import { describe, it, expect } from 'vitest'
import {
  bucketOf,
  linkSubPeriods,
  subPeriodContributions,
  temporalAttribution,
  isGranularity,
  type SubPeriod,
} from '@/lib/services/temporal-attribution'
import { reconstructBookHistory, type BookTransaction } from '@/lib/services/portfolio-history'
import { calculateTWR } from '@/lib/services/returns'

const t = (date: string, type: BookTransaction['type'], symbol: string, quantity: number, price: number): BookTransaction => ({
  executed_at: `${date}T15:00:00Z`,
  type,
  symbol,
  quantity,
  price,
})

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('subPeriodContributions', () => {
  it('splits a sub-period return into holdings that add up to it', () => {
    // 100 in AAPL (+10%) and 100 in MSFT (-5%): the book returns +2.5%.
    const { periods } = subPeriodContributions({
      symbolSnapshots: [
        { date: '2026-03-02', values: { AAPL: 100, MSFT: 100 } },
        { date: '2026-03-03', values: { AAPL: 110, MSFT: 95 } },
      ],
      symbolFlows: [],
    })
    expect(periods).toHaveLength(1)
    expect(periods[0].portfolioReturn).toBeCloseTo(0.025, 12)
    expect(periods[0].contributions.AAPL).toBeCloseTo(0.05, 12)
    expect(periods[0].contributions.MSFT).toBeCloseTo(-0.025, 12)
    expect(periods[0].assetReturns).toEqual({ AAPL: expect.closeTo(0.1, 12), MSFT: expect.closeTo(-0.05, 12) })
    expect(periods[0].weights).toEqual({ AAPL: 0.5, MSFT: 0.5 })
  })

  it('does not count money added by a purchase as contribution', () => {
    // 100 in AAPL; on 03-02 another 100 goes in; the close doubles nothing.
    const { periods } = subPeriodContributions({
      symbolSnapshots: [
        { date: '2026-03-02', values: { AAPL: 100 } },
        { date: '2026-03-03', values: { AAPL: 200 } },
      ],
      symbolFlows: [{ date: '2026-03-02', symbol: 'AAPL', amount: 100 }],
    })
    expect(periods[0].portfolioReturn).toBe(0)
    expect(periods[0].contributions.AAPL).toBe(0)
  })

  it('skips the empty days between selling out and buying back', () => {
    const { periods, unmeasurable } = subPeriodContributions({
      symbolSnapshots: [
        { date: '2026-03-02', values: {} },
        { date: '2026-03-03', values: {} },
      ],
      symbolFlows: [],
    })
    expect(periods).toEqual([])
    expect(unmeasurable).toBe(0)
  })
})

describe('linkSubPeriods (Carino)', () => {
  const period = (start: string, end: string, contributions: Record<string, number>): SubPeriod => ({
    start,
    end,
    portfolioReturn: sum(Object.values(contributions)),
    contributions,
    weights: Object.fromEntries(Object.keys(contributions).map((s) => [s, 1 / Object.keys(contributions).length])),
    assetReturns: {},
  })

  it('makes linked contributions add up to the compounded return, with no residual', () => {
    const periods = [
      period('2026-01-02', '2026-01-05', { A: 0.03, B: 0.01 }),
      period('2026-01-05', '2026-01-06', { A: -0.02, B: 0.015 }),
      period('2026-01-06', '2026-01-07', { A: 0.04, B: -0.03 }),
    ]
    const linked = linkSubPeriods(periods)!
    const compounded = (1.04 * 0.995 * 1.01 - 1) * 100
    expect(linked.portfolioReturnPct).toBeCloseTo(compounded, 10)
    // Simply adding the raw contributions would give 4.5 points, not 4.5094...
    expect(sum(linked.holdings.map((h) => h.contributionPct))).toBeCloseTo(compounded, 10)
    expect(linked.subPeriods).toBe(3)
    expect(linked.start).toBe('2026-01-02')
    expect(linked.end).toBe('2026-01-07')
  })

  it('handles a flat sub-period (r = 0) without dividing by zero', () => {
    const linked = linkSubPeriods([period('a', 'b', { A: 0.02, B: -0.02 }), period('b', 'c', { A: 0.01 })])!
    expect(Number.isFinite(linked.portfolioReturnPct)).toBe(true)
    expect(sum(linked.holdings.map((h) => h.contributionPct))).toBeCloseTo(linked.portfolioReturnPct, 10)
  })

  it('refuses to link through a total loss, where the logarithm does not exist', () => {
    expect(linkSubPeriods([period('a', 'b', { A: -1 })])).toBeNull()
  })
})

describe('bucketOf', () => {
  it('labels days, months, quarters and years', () => {
    expect(bucketOf('2026-09-14', 'day')).toEqual({ key: '2026-09-14', label: '14 sep 2026' })
    expect(bucketOf('2026-09-14', 'month')).toEqual({ key: '2026-09', label: 'sep 2026' })
    expect(bucketOf('2026-09-14', 'quarter')).toEqual({ key: '2026-Q3', label: 'T3 2026' })
    expect(bucketOf('2026-09-14', 'year')).toEqual({ key: '2026', label: '2026' })
  })

  it('uses ISO weeks, including across the year boundary', () => {
    expect(bucketOf('2026-09-14', 'week').key).toBe('2026-W38') // a Monday
    expect(bucketOf('2026-09-20', 'week').key).toBe('2026-W38') // the Sunday after
    expect(bucketOf('2027-01-01', 'week').key).toBe('2026-W53') // a Friday in the last ISO week of 2026
    expect(bucketOf('2025-12-29', 'week').key).toBe('2026-W01') // Monday of ISO week 1
  })

  it('validates granularity input', () => {
    expect(isGranularity('month')).toBe(true)
    expect(isGranularity('decade')).toBe(false)
  })
})

describe('temporalAttribution on a real book', () => {
  // Buys, a top-up and a partial sale across three months, two holdings.
  const prices: Record<string, Record<string, number>> = { AAPL: {}, MSFT: {} }
  const days: string[] = []
  for (const month of ['01', '02', '03']) {
    for (const day of ['05', '12', '19', '26']) days.push(`2026-${month}-${day}`)
  }
  days.forEach((date, i) => {
    prices.AAPL[date] = 100 * (1 + 0.02 * Math.sin(i) + 0.004 * i)
    prices.MSFT[date] = 200 * (1 - 0.015 * Math.cos(i) + 0.002 * i)
  })
  const transactions = [
    t('2026-01-05', 'buy', 'AAPL', 10, 100),
    t('2026-01-12', 'buy', 'MSFT', 5, 200),
    t('2026-02-12', 'buy', 'AAPL', 5, 101),
    t('2026-03-12', 'sell', 'MSFT', 2, 205),
  ]
  const history = reconstructBookHistory(transactions, prices)

  it('links the whole window to exactly the time-weighted return the returns route reports', () => {
    const result = temporalAttribution(history, 'month')
    expect(result.total!.portfolioReturnPct).toBeCloseTo(calculateTWR(history.snapshots, history.flows)!, 9)
  })

  it('gives each month contributions that add up to that month', () => {
    const result = temporalAttribution(history, 'month')
    expect(result.buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    for (const bucket of result.buckets) {
      expect(sum(bucket.holdings.map((h) => h.contributionPct))).toBeCloseTo(bucket.portfolioReturnPct, 9)
    }
  })

  it('files a sub-period under the day it ends: Jan 26 to Feb 5 is February', () => {
    const february = temporalAttribution(history, 'month').buckets.find((b) => b.key === '2026-02')!
    expect(february.start).toBe('2026-01-26')
    expect(february.end).toBe('2026-02-26')
  })

  it('compounds buckets back to the window return at every granularity', () => {
    for (const g of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      const result = temporalAttribution(history, g)
      const compounded = result.buckets.reduce((acc, b) => acc * (1 + b.portfolioReturnPct / 100), 1)
      expect((compounded - 1) * 100).toBeCloseTo(result.total!.portfolioReturnPct, 9)
    }
  })

  it('never returns NaN or Infinity', () => {
    const result = temporalAttribution(history, 'week')
    const numbers = result.buckets.flatMap((b) => [
      b.portfolioReturnPct,
      ...b.holdings.flatMap((h) => [h.contributionPct, h.averageWeightPct, h.assetReturnPct ?? 0]),
    ])
    expect(numbers.every(Number.isFinite)).toBe(true)
  })
})
