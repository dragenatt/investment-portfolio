import { describe, it, expect } from 'vitest'
import { buildIntradayTimeline, MIN_INTRADAY_POINTS } from '@/lib/services/portfolio-intraday'

const bar = (time: string, close: number) => ({ time, close })

describe('buildIntradayTimeline', () => {
  const snapshots = [{ date: '2026-03-02', positions: { AAA: 10 } }]

  it('draws a point at every instant a holding printed a price', () => {
    const points = buildIntradayTimeline({
      snapshots,
      bars: { AAA: [bar('2026-03-02T14:00:00.000Z', 100), bar('2026-03-02T14:05:00.000Z', 101), bar('2026-03-02T14:10:00.000Z', 99)] },
    })
    expect(points).toEqual([
      { date: '2026-03-02T14:00:00.000Z', value: 1000 },
      { date: '2026-03-02T14:05:00.000Z', value: 1010 },
      { date: '2026-03-02T14:10:00.000Z', value: 990 },
    ])
  })

  it('is the whole reason the 1D chart exists: a day of closes is two points, a day of bars is many', () => {
    const times = Array.from({ length: 78 }, (_, i) => {
      const at = new Date(Date.UTC(2026, 2, 2, 13, 30) + i * 5 * 60_000)
      return bar(at.toISOString(), 100 + Math.sin(i / 6))
    })
    const points = buildIntradayTimeline({ snapshots, bars: { AAA: times } })
    expect(points).toHaveLength(78)
    expect(points.length).toBeGreaterThan(MIN_INTRADAY_POINTS)
    expect(new Set(points.map((p) => p.value)).size).toBeGreaterThan(50)
  })

  it('holds the last print of a market that has already closed', () => {
    // BBB trades in Tokyo and is done by 06:30; AAA opens in New York at 13:30.
    // From 13:30 on, BBB is worth its last print — not nothing.
    const points = buildIntradayTimeline({
      snapshots: [{ date: '2026-03-02', positions: { AAA: 1, BBB: 2 } }],
      bars: {
        AAA: [bar('2026-03-02T13:30:00.000Z', 100), bar('2026-03-02T13:35:00.000Z', 110)],
        BBB: [bar('2026-03-02T00:00:00.000Z', 50), bar('2026-03-02T06:30:00.000Z', 60)],
      },
      previousCloses: { AAA: 90 },
    })
    expect(points).toEqual([
      // Tokyo open: AAA has not traded yet, so it is worth yesterday's close.
      { date: '2026-03-02T00:00:00.000Z', value: 90 + 100 },
      { date: '2026-03-02T06:30:00.000Z', value: 90 + 120 },
      { date: '2026-03-02T13:30:00.000Z', value: 100 + 120 },
      { date: '2026-03-02T13:35:00.000Z', value: 110 + 120 },
    ])
  })

  it('carries the first bar backwards when no previous close is known, rather than an old execution price', () => {
    // An execution price from months ago would open the line with a jump that
    // never happened.
    const points = buildIntradayTimeline({
      snapshots: [{ date: '2026-03-02', positions: { AAA: 1, BBB: 1 } }],
      bars: {
        AAA: [bar('2026-03-02T00:00:00.000Z', 10)],
        BBB: [bar('2026-03-02T13:30:00.000Z', 200)],
      },
      transactionPrices: { BBB: 5 },
    })
    expect(points[0]).toEqual({ date: '2026-03-02T00:00:00.000Z', value: 10 + 200 })
  })

  it('values a holding nobody quotes at the price it traded at, like the daily chart', () => {
    const points = buildIntradayTimeline({
      snapshots: [{ date: '2026-03-02', positions: { AAA: 1, NOQUOTE: 4 } }],
      bars: { AAA: [bar('2026-03-02T13:30:00.000Z', 100)] },
      transactionPrices: { NOQUOTE: 25 },
    })
    expect(points[0].value).toBe(100 + 100)
  })

  it('uses the holdings of each instant, so a purchase steps the line up on its own day', () => {
    const points = buildIntradayTimeline({
      snapshots: [
        { date: '2026-03-02', positions: { AAA: 1 } },
        { date: '2026-03-03', positions: { AAA: 3 } },
      ],
      bars: { AAA: [bar('2026-03-02T14:00:00.000Z', 100), bar('2026-03-03T14:00:00.000Z', 100)] },
    })
    expect(points.map((p) => p.value)).toEqual([100, 300])
  })

  it('does not draw a portfolio that did not exist yet', () => {
    // Zero is not what an empty book is worth; it is what no book is worth, and
    // plotting it makes the first purchase look like an infinite gain.
    const points = buildIntradayTimeline({
      snapshots: [{ date: '2026-03-03', positions: { AAA: 1 } }],
      bars: { AAA: [bar('2026-03-02T14:00:00.000Z', 100), bar('2026-03-03T14:00:00.000Z', 100)] },
    })
    expect(points).toEqual([{ date: '2026-03-03T14:00:00.000Z', value: 100 }])
  })

  it('sorts bars that arrive out of order and drops the ones with no price', () => {
    const points = buildIntradayTimeline({
      snapshots,
      bars: { AAA: [bar('2026-03-02T14:10:00.000Z', 99), bar('2026-03-02T14:00:00.000Z', 100), bar('2026-03-02T14:05:00.000Z', 0), bar('2026-03-02T14:15:00.000Z', Number.NaN)] },
    })
    expect(points.map((p) => p.date)).toEqual(['2026-03-02T14:00:00.000Z', '2026-03-02T14:10:00.000Z'])
  })

  it('has nothing to draw without bars or without holdings', () => {
    expect(buildIntradayTimeline({ snapshots, bars: {} })).toEqual([])
    expect(buildIntradayTimeline({ snapshots: [], bars: { AAA: [bar('2026-03-02T14:00:00.000Z', 1)] } })).toEqual([])
  })

  it('never lets an invalid value reach the chart', () => {
    const points = buildIntradayTimeline({
      snapshots: [{ date: '2026-03-02', positions: { AAA: 1, GHOST: 2 } }],
      bars: { AAA: [bar('2026-03-02T14:00:00.000Z', 100)] },
    })
    for (const point of points) expect(Number.isFinite(point.value)).toBe(true)
  })
})
