import { describe, it, expect } from 'vitest'
import { withLivePoint } from '@/lib/services/live-point'

// Measured on the dashboard, 2026-09-21: the 1M, 3M, 1Y and MAX ranges came
// back as two points, the 18th and the 21st, with the same value — "today" was
// valued at Friday's close because Monday's had not settled. Synthetic values.

const NOW = new Date('2026-09-21T18:30:00Z')

describe('withLivePoint', () => {
  it('replaces a daily series\' today with the live value', () => {
    const series = [
      { date: '2026-09-18', value: 1000 },
      { date: '2026-09-21', value: 1000 }, // still Friday's close
    ]

    expect(withLivePoint(series, 1023.5, NOW)).toEqual([
      { date: '2026-09-18', value: 1000 },
      { date: '2026-09-21', value: 1023.5 },
    ])
  })

  it('adds today to a daily series that stops before it', () => {
    const series = [{ date: '2026-09-17', value: 990 }, { date: '2026-09-18', value: 1000 }]

    expect(withLivePoint(series, 1010, NOW).at(-1)).toEqual({ date: '2026-09-21', value: 1010 })
    expect(withLivePoint(series, 1010, NOW)).toHaveLength(3)
  })

  it('ends an intraday series at this instant', () => {
    const series = [
      { date: '2026-09-21T13:30:00.000Z', value: 1000 },
      { date: '2026-09-21T18:25:00.000Z', value: 1004 },
    ]

    expect(withLivePoint(series, 1006, NOW)).toEqual([
      ...series,
      { date: '2026-09-21T18:30:00.000Z', value: 1006 },
    ])
  })

  it('leaves the series alone without a usable live value, or without a series', () => {
    const series = [{ date: '2026-09-18', value: 1000 }, { date: '2026-09-21', value: 1000 }]

    expect(withLivePoint(series, null, NOW)).toBe(series)
    expect(withLivePoint(series, Number.NaN, NOW)).toBe(series)
    expect(withLivePoint(series, 0, NOW)).toBe(series)
    expect(withLivePoint([], 1000, NOW)).toEqual([])
  })
})
