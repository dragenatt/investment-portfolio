import { describe, it, expect } from 'vitest'
import {
  describeChange,
  formatChartDate,
  formatChartMoney,
  formatChartPercent,
  MAX_TABLE_ROWS,
  sampleEvenly,
  sampledNote,
  seriesTable,
} from '@/lib/utils/chart-accessibility'

describe('sampleEvenly', () => {
  it('returns short series unchanged', () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual({ rows: [1, 2, 3], sampled: false })
  })

  it('keeps the first and last point and at most max rows', () => {
    const points = Array.from({ length: 500 }, (_, i) => i)
    const { rows, sampled } = sampleEvenly(points, 60)
    expect(sampled).toBe(true)
    expect(rows.length).toBeLessThanOrEqual(60)
    expect(rows[0]).toBe(0)
    expect(rows[rows.length - 1]).toBe(499)
  })

  it('spaces rows evenly and never repeats one', () => {
    const points = Array.from({ length: 121 }, (_, i) => i)
    const { rows } = sampleEvenly(points, 5)
    expect(rows).toEqual([0, 30, 60, 90, 120])
    expect(new Set(sampleEvenly(Array.from({ length: 61 }, (_, i) => i), 60).rows).size).toBe(
      sampleEvenly(Array.from({ length: 61 }, (_, i) => i), 60).rows.length,
    )
  })

  it('defaults to a readable size', () => {
    expect(sampleEvenly(Array.from({ length: 1000 }, (_, i) => i)).rows.length).toBeLessThanOrEqual(MAX_TABLE_ROWS)
  })
})

describe('seriesTable', () => {
  it('says when the rows were sampled', () => {
    const table = seriesTable(Array.from({ length: 200 }, (_, i) => i), 'Serie', ['Día', 'Valor'], (p) => [String(p), String(p * 2)], 10)
    expect(table.rows.length).toBe(10)
    expect(table.note).toBe('Se muestran 10 de 200 puntos, espaciados de forma regular.')
    expect(seriesTable([1, 2], 'Serie', ['a', 'b'], (p) => [String(p), '']).note).toBeUndefined()
  })

  it('has no note when nothing was left out', () => {
    expect(sampledNote(5, 5)).toBeUndefined()
  })
})

describe('describeChange', () => {
  const money = (v: number) => formatChartMoney(v)

  it('says the direction in words, not only in colour', () => {
    expect(describeChange({ label: '1 ago 2026', value: 1000 }, { label: '14 sep 2026', value: 1200 }, money)).toBe(
      'de $1,000.00 USD el 1 ago 2026 a $1,200.00 USD el 14 sep 2026, un alza de 20.00%',
    )
    expect(describeChange({ label: 'a', value: 1000 }, { label: 'b', value: 900 }, money)).toContain('una baja de 10.00%')
    expect(describeChange({ label: 'a', value: 1000 }, { label: 'b', value: 1000 }, money)).toContain('sin cambio')
  })

  it('leaves the percentage out for values that include deposits', () => {
    // Seen on the dashboard: a book funded from $10 to $4,519 read as "un alza de 45084.03%".
    const text = describeChange({ label: 'a', value: 10 }, { label: 'b', value: 4519.65 }, money, { percent: false })
    expect(text).toBe('de $10.00 USD el a a $4,519.65 USD el b')
  })

  it('does not invent a percentage from zero or a non-number', () => {
    expect(describeChange({ label: 'a', value: 0 }, { label: 'b', value: 10 }, money)).not.toContain('%')
    expect(describeChange({ label: 'a', value: Number.NaN }, { label: 'b', value: 10 }, money)).not.toContain('NaN')
  })
})

describe('formatters', () => {
  it('formats dates in Spanish and leaves non-dates alone', () => {
    expect(formatChartDate('2026-09-14')).toMatch(/^14 \S+ 2026$/)
    expect(formatChartDate('Semana 3')).toBe('Semana 3')
  })

  it('never prints NaN or Infinity', () => {
    expect(formatChartMoney(Number.NaN)).toBe('—')
    expect(formatChartPercent(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
