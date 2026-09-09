import { describe, it, expect } from 'vitest'
import {
  classifyJumps,
  adjustForSplits,
  returnBasisSeries,
  adjustSeriesBySymbol,
  type RawBar,
} from '@/lib/services/corporate-actions'

/** A series that trades at `before` up to `splitAt`, then at `before / ratio`. */
function splitSeries(days: number, splitAt: number, before: number, ratio: number): RawBar[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2024-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: i < splitAt ? before : before / ratio,
  }))
}

describe('classifyJumps', () => {
  it('finds nothing in a series that only drifts', () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      close: 100 + i,
    }))
    expect(classifyJumps(bars)).toEqual({ splits: [], anomalies: [] })
  })

  it('reads a persistent halving as a 2:1 split', () => {
    const { splits, anomalies } = classifyJumps(splitSeries(40, 20, 100, 2))
    expect(splits).toHaveLength(1)
    expect(splits[0].ratio).toBeCloseTo(2)
    expect(anomalies).toEqual([])
  })

  it('reads a spike that snaps back as an anomaly, not a split', () => {
    const bars = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 100 },
      { date: '2024-01-03', close: 25 }, // one bad print at exactly 1/4
      { date: '2024-01-04', close: 100 },
      { date: '2024-01-05', close: 100 },
    ]
    const { splits, anomalies } = classifyJumps(bars)
    expect(splits).toEqual([])
    expect(anomalies).toEqual(['2024-01-03'])
  })

  it('ignores a large move that is not near a corporate-action ratio', () => {
    const bars = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 41 }, // -59%: a crash, ratio 2.44 matches nothing
      { date: '2024-01-03', close: 41 },
    ]
    const { splits } = classifyJumps(bars)
    expect(splits).toEqual([])
  })
})

describe('adjustForSplits', () => {
  it('leaves a clean series untouched', () => {
    const bars = splitSeries(30, 30, 100, 1)
    const result = adjustForSplits(bars)
    expect(result.splits).toEqual([])
    expect(result.bars.map((b) => b.adjustedClose)).toEqual(bars.map((b) => b.close))
  })

  it('removes the artificial jump a 2:1 split creates in the return series', () => {
    const raw = splitSeries(40, 20, 100, 2)
    const { bars } = adjustForSplits(raw)
    const closes = bars.map((b) => b.adjustedClose!)
    // Every consecutive pair is now flat — the -50% print is gone
    for (let i = 1; i < closes.length; i++) {
      expect(closes[i] / closes[i - 1]).toBeCloseTo(1)
    }
  })

  it('leaves the most recent price alone and scales the history', () => {
    const raw = splitSeries(40, 20, 400, 4) // AAPL 2020-08-31 shape: 4:1
    const { bars } = adjustForSplits(raw)
    expect(bars[bars.length - 1].adjustedClose).toBe(100)
    expect(bars[0].adjustedClose).toBe(100)
    expect(bars[0].close).toBe(400) // the raw price is preserved alongside
  })

  it('handles a 10:1 split (NVDA 2024-06-10 shape)', () => {
    const raw = splitSeries(40, 25, 1200, 10)
    const { bars, splits } = adjustForSplits(raw)
    expect(splits[0].ratio).toBeCloseTo(10)
    expect(bars[0].adjustedClose).toBeCloseTo(120)
    expect(bars[bars.length - 1].adjustedClose).toBeCloseTo(120)
  })

  it('leaves a 3:2 split alone — a 33% move is not separable from a bad day', () => {
    // Documented limitation: only splits that move the price more than 50% can
    // be recovered from raw prices. Catching 3:2 would mean rescaling real
    // crashes. A provider adjusted close is the only fix for these.
    const raw = splitSeries(40, 20, 150, 1.5)
    const { splits } = adjustForSplits(raw)
    expect(splits).toEqual([])
  })

  it('compounds two splits in the same window', () => {
    const bars: RawBar[] = [
      ...Array(10).fill(0).map((_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, close: 400 })),
      ...Array(10).fill(0).map((_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, close: 200 })),
      ...Array(10).fill(0).map((_, i) => ({ date: `2024-03-${String(i + 1).padStart(2, '0')}`, close: 100 })),
    ]
    const result = adjustForSplits(bars)
    expect(result.splits).toHaveLength(2)
    // The oldest price is divided by both ratios: 400 / (2 * 2)
    expect(result.bars[0].adjustedClose).toBeCloseTo(100)
  })

  it('does not touch a series whose jump snaps back', () => {
    const bars: RawBar[] = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 50 },
      { date: '2024-01-03', close: 100 },
    ]
    const result = adjustForSplits(bars)
    expect(result.splits).toEqual([])
    expect(result.bars.map((b) => b.adjustedClose)).toEqual([100, 50, 100])
  })

  it('carries a provider-supplied adjusted close through untouched', () => {
    // Yahoo already adjusts for splits and dividends; when it answers, trust it
    const raw: RawBar[] = [
      { date: '2024-01-01', close: 400, adjClose: 99 },
      { date: '2024-01-02', close: 400, adjClose: 99.5 },
      { date: '2024-01-03', close: 100, adjClose: 100 },
    ]
    const result = adjustForSplits(raw)
    expect(result.source).toBe('provider')
    expect(result.bars.map((b) => b.adjustedClose)).toEqual([99, 99.5, 100])
    expect(result.splits).toEqual([])
  })

  it('says when it derived the adjustment itself', () => {
    expect(adjustForSplits(splitSeries(40, 20, 100, 2)).source).toBe('derived')
  })

  it('skips unusable bars instead of dividing by them', () => {
    const bars: RawBar[] = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: null },
      { date: '2024-01-03', close: 0 },
      { date: '2024-01-04', close: 100 },
    ]
    const result = adjustForSplits(bars)
    expect(result.bars[1].adjustedClose).toBeNull()
    expect(result.bars[2].adjustedClose).toBeNull()
    expect(result.bars.every((b) => b.adjustedClose !== Infinity)).toBe(true)
  })
})

describe('returnBasisSeries', () => {
  it('hands back the adjusted closes a return series should be built from', () => {
    const raw = splitSeries(40, 20, 100, 2)
    const closes = returnBasisSeries(raw)
    expect(closes).toHaveLength(40)
    for (let i = 1; i < closes.length; i++) {
      expect(closes[i] / closes[i - 1]).toBeCloseTo(1)
    }
  })

  it('drops unusable observations rather than emitting NaN', () => {
    const closes = returnBasisSeries([
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: null },
      { date: '2024-01-03', close: 102 },
    ])
    expect(closes).toEqual([100, 102])
    expect(closes.every(Number.isFinite)).toBe(true)
  })

  it('returns an empty series for empty input', () => {
    expect(returnBasisSeries([])).toEqual([])
  })
})

describe('adjustSeriesBySymbol', () => {
  const rows = [
    { symbol: 'AAPL', date: '2024-01-01', close: 400 },
    { symbol: 'MSFT', date: '2024-01-01', close: 300 },
    { symbol: 'AAPL', date: '2024-01-02', close: 400 },
    { symbol: 'MSFT', date: '2024-01-02', close: 301 },
    { symbol: 'AAPL', date: '2024-01-03', close: 100 }, // 4:1 split
    { symbol: 'MSFT', date: '2024-01-03', close: 302 },
    { symbol: 'AAPL', date: '2024-01-04', close: 101 },
    { symbol: 'MSFT', date: '2024-01-04', close: 303 },
  ]

  it('adjusts each symbol on its own history', () => {
    const adjusted = adjustSeriesBySymbol(rows)
    const aapl = adjusted.filter((r) => r.symbol === 'AAPL').map((r) => r.close)
    expect(aapl).toEqual([100, 100, 100, 101])
  })

  it('leaves a symbol without corporate actions untouched', () => {
    const adjusted = adjustSeriesBySymbol(rows)
    const msft = adjusted.filter((r) => r.symbol === 'MSFT').map((r) => r.close)
    expect(msft).toEqual([300, 301, 302, 303])
  })

  it('returns every row it was given, sorted by date', () => {
    const adjusted = adjustSeriesBySymbol(rows)
    expect(adjusted).toHaveLength(rows.length)
    const dates = adjusted.map((r) => r.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('drops rows whose price cannot be used', () => {
    const adjusted = adjustSeriesBySymbol([
      { symbol: 'X', date: '2024-01-01', close: 10 },
      { symbol: 'X', date: '2024-01-02', close: 0 },
      { symbol: 'X', date: '2024-01-03', close: 11 },
    ])
    expect(adjusted.map((r) => r.close)).toEqual([10, 11])
  })

  it('handles an empty input', () => {
    expect(adjustSeriesBySymbol([])).toEqual([])
  })
})
