import { describe, it, expect } from 'vitest'
import { portfolioValueSeries } from '@/lib/services/portfolio-series'

type Row = { symbol: string; date: string; close: number }

const holdings = [
  { symbol: 'AAA', quantity: 2 },
  { symbol: 'BBB', quantity: 3 },
]

/** Both symbols priced on every date. */
function complete(dates: string[], a: number[], b: number[]): Row[] {
  return dates.flatMap((date, i) => [
    { symbol: 'AAA', date, close: a[i] },
    { symbol: 'BBB', date, close: b[i] },
  ])
}

describe('portfolioValueSeries', () => {
  const dates = ['2026-01-02', '2026-01-03', '2026-01-04']

  it('sums quantity times price across the book', () => {
    const result = portfolioValueSeries(complete(dates, [10, 11, 12], [20, 20, 20]), holdings)!
    // 2*10 + 3*20 = 80
    expect(result.values[0]).toBeCloseTo(80, 10)
    expect(result.values[1]).toBeCloseTo(82, 10)
  })

  it('returns the dates in ascending order', () => {
    const scrambled = complete([...dates].reverse(), [12, 11, 10], [20, 20, 20])
    expect(portfolioValueSeries(scrambled, holdings)!.dates).toEqual(dates)
  })

  it('DROPS a date where any holding has no price', () => {
    // The bug this exists to prevent. Summing whatever happened to be present
    // made the book "lose" a position for one day and get it back the next: a
    // -60% day followed by a +150% day, out of nothing. Two such dates in 130
    // took a real 18% annual volatility to 178%.
    const rows = complete(dates, [10, 11, 12], [20, 20, 20]).filter(
      (r) => !(r.date === '2026-01-03' && r.symbol === 'BBB'),
    )
    const result = portfolioValueSeries(rows, holdings)!

    expect(result.dates).toEqual(['2026-01-02', '2026-01-04'])
    expect(result.droppedDates).toEqual(['2026-01-03'])
    // No 60% crater anywhere in the series
    expect(result.values).toEqual([80, 84])
  })

  it('reports how many dates it dropped, so a caller can say so', () => {
    const rows = complete(dates, [10, 11, 12], [20, 20, 20]).filter(
      (r) => !(r.date === '2026-01-03' && r.symbol === 'BBB'),
    )
    expect(portfolioValueSeries(rows, holdings)!.droppedDates).toHaveLength(1)
  })

  it('ignores rows for symbols the book does not hold', () => {
    const rows = [
      ...complete(dates, [10, 11, 12], [20, 20, 20]),
      { symbol: 'ZZZ', date: dates[0], close: 999 },
    ]
    expect(portfolioValueSeries(rows, holdings)!.values[0]).toBeCloseTo(80, 10)
  })

  it('ignores a holding that has no price data at all rather than dropping everything', () => {
    // A symbol the provider knows nothing about must not empty the whole series;
    // it is excluded, named, and the rest is measured without it.
    const withGhost = [...holdings, { symbol: 'GHOST', quantity: 5 }]
    const result = portfolioValueSeries(complete(dates, [10, 11, 12], [20, 20, 20]), withGhost)!

    expect(result.excludedSymbols).toEqual(['GHOST'])
    expect(result.dates).toEqual(dates)
    expect(result.values[0]).toBeCloseTo(80, 10)
  })

  it('never emits a non-finite value', () => {
    const rows = complete(dates, [10, Number.NaN, 12], [20, 20, 20])
    const result = portfolioValueSeries(rows, holdings)
    if (result) for (const v of result.values) expect(Number.isFinite(v)).toBe(true)
  })

  it('refuses a book with no holdings', () => {
    expect(portfolioValueSeries(complete(dates, [10, 11, 12], [20, 20, 20]), [])).toBeNull()
  })

  it('refuses when nothing is priced at all', () => {
    expect(portfolioValueSeries([], holdings)).toBeNull()
  })

  it('refuses when fewer than two dates survive', () => {
    // One point is not a series; returns need a previous bar.
    const rows = complete([dates[0]], [10], [20])
    expect(portfolioValueSeries(rows, holdings)).toBeNull()
  })

  it('is deterministic', () => {
    const rows = complete(dates, [10, 11, 12], [20, 20, 20])
    expect(portfolioValueSeries(rows, holdings)).toEqual(portfolioValueSeries(rows, holdings))
  })
})
