import { describe, it, expect } from 'vitest'
import { assessPriceHistory, type PriceBar } from '@/lib/services/data-quality'

/** A clean run of consecutive business days ending on `end`, all priced at `close`. */
function cleanSeries(days: number, close = 100, end = '2026-09-04'): PriceBar[] {
  const bars: PriceBar[] = []
  const cursor = new Date(`${end}T00:00:00Z`)
  while (bars.length < days) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      bars.unshift({ date: cursor.toISOString().slice(0, 10), close })
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return bars
}

const ASOF = new Date('2026-09-07T00:00:00Z')

describe('assessPriceHistory', () => {
  it('gives a clean series a perfect score', () => {
    const report = assessPriceHistory('AAPL', cleanSeries(120), { asOf: ASOF })
    expect(report.score).toBe(100)
    expect(report.issues).toEqual([])
    expect(report.symbol).toBe('AAPL')
    expect(report.observations).toBe(120)
  })

  it('reports the covered range', () => {
    const bars = cleanSeries(30)
    const report = assessPriceHistory('AAPL', bars, { asOf: ASOF })
    expect(report.from).toBe(bars[0].date)
    expect(report.to).toBe(bars[bars.length - 1].date)
  })

  it('flags an empty series as unusable', () => {
    const report = assessPriceHistory('GHOST', [], { asOf: ASOF })
    expect(report.score).toBe(0)
    expect(report.issues.map((i) => i.code)).toContain('no-data')
  })
})

describe('assessPriceHistory — detectors', () => {
  it('flags missing closes', () => {
    const bars = cleanSeries(60)
    bars[10] = { ...bars[10], close: null }
    bars[11] = { ...bars[11], close: Number.NaN }
    const report = assessPriceHistory('AAPL', bars, { asOf: ASOF })
    const issue = report.issues.find((i) => i.code === 'missing-close')
    expect(issue).toBeDefined()
    expect(issue!.count).toBe(2)
    expect(report.score).toBeLessThan(100)
  })

  it('flags non-positive prices', () => {
    const bars = cleanSeries(60)
    bars[5] = { ...bars[5], close: -3 }
    bars[6] = { ...bars[6], close: 0 }
    const issue = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.find(
      (i) => i.code === 'non-positive-close',
    )
    expect(issue?.count).toBe(2)
    expect(issue?.severity).toBe('critical')
  })

  it('flags duplicate dates', () => {
    const bars = cleanSeries(60)
    bars.push({ ...bars[59] })
    const issue = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.find(
      (i) => i.code === 'duplicate-date',
    )
    expect(issue?.count).toBe(1)
  })

  it('flags calendar gaps longer than a long weekend', () => {
    const bars = cleanSeries(60)
    // Drop two full weeks from the middle
    bars.splice(20, 10)
    const issue = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.find(
      (i) => i.code === 'calendar-gap',
    )
    expect(issue).toBeDefined()
  })

  it('does not treat a normal weekend as a gap', () => {
    const report = assessPriceHistory('AAPL', cleanSeries(200), { asOf: ASOF })
    expect(report.issues.map((i) => i.code)).not.toContain('calendar-gap')
  })

  it('flags an absurd one-day move', () => {
    const bars = cleanSeries(60)
    bars[30] = { ...bars[30], close: 175 } // +75% in a day, not a round split ratio
    const issue = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.find(
      (i) => i.code === 'extreme-move',
    )
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('reads a clean halving as a suspected split, not an absurd move', () => {
    const bars = cleanSeries(60)
    // Every bar from index 30 onward trades at half price: a 2:1 split
    for (let i = 30; i < bars.length; i++) bars[i] = { ...bars[i], close: 50 }
    const codes = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.map((i) => i.code)
    expect(codes).toContain('suspected-split')
    expect(codes).not.toContain('extreme-move')
  })

  it('flags a series that stopped updating', () => {
    const bars = cleanSeries(60, 100, '2026-07-01')
    const issue = assessPriceHistory('AAPL', bars, { asOf: ASOF }).issues.find(
      (i) => i.code === 'stale',
    )
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('critical')
  })

  it('flags a history too short to measure risk on', () => {
    const issue = assessPriceHistory('IPO', cleanSeries(8), { asOf: ASOF }).issues.find(
      (i) => i.code === 'short-history',
    )
    expect(issue).toBeDefined()
  })

  it('flags a price that never moves', () => {
    // A long flat line usually means a stale feed rather than a real quote
    const issue = assessPriceHistory('DEAD', cleanSeries(60), { asOf: ASOF, requireMovement: true })
      .issues.find((i) => i.code === 'flat-line')
    expect(issue).toBeDefined()
  })
})

describe('assessPriceHistory — scoring', () => {
  it('never scores below zero however many problems pile up', () => {
    const bars: PriceBar[] = [
      { date: '2020-01-02', close: -1 },
      { date: '2020-01-02', close: null },
      { date: '2024-06-01', close: 900 },
    ]
    const report = assessPriceHistory('BROKEN', bars, { asOf: ASOF })
    expect(report.score).toBe(0)
    expect(report.score).toBeGreaterThanOrEqual(0)
  })

  it('grades the score', () => {
    expect(assessPriceHistory('AAPL', cleanSeries(120), { asOf: ASOF }).grade).toBe('excellent')
    expect(assessPriceHistory('BROKEN', [], { asOf: ASOF }).grade).toBe('unusable')
  })

  it('explains every problem it found in plain language', () => {
    const bars = cleanSeries(60)
    bars[5] = { ...bars[5], close: null }
    const report = assessPriceHistory('AAPL', bars, { asOf: ASOF })
    for (const issue of report.issues) {
      expect(issue.message.length).toBeGreaterThan(10)
      expect(issue.penalty).toBeGreaterThan(0)
    }
  })

  it('is deterministic for the same input', () => {
    const bars = cleanSeries(60)
    bars[7] = { ...bars[7], close: 0 }
    const a = assessPriceHistory('AAPL', bars, { asOf: ASOF })
    const b = assessPriceHistory('AAPL', bars, { asOf: ASOF })
    expect(a).toEqual(b)
  })
})
