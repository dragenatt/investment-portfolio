import { describe, it, expect } from 'vitest'
import { formatByUnit, labQueryString } from '@/lib/utils/lab-format'

describe('formatByUnit', () => {
  it('formats percentages with one decimal by default', () => {
    expect(formatByUnit(12.345, 'percent')).toBe('12.3%')
    expect(formatByUnit(-4, 'percent')).toBe('-4.0%')
  })

  it('puts a currency symbol on money', () => {
    expect(formatByUnit(1_879_771, 'money')).toContain('$')
    expect(formatByUnit(1_879_771, 'money')).toMatch(/1.?879.?771/)
  })

  it('says years in words, singular and plural', () => {
    expect(formatByUnit(1, 'years')).toBe('1 año')
    expect(formatByUnit(20, 'years')).toBe('20 años')
    expect(formatByUnit(0.5, 'years')).toBe('0.5 años')
  })

  it('signs percentage points, because they are always a difference', () => {
    expect(formatByUnit(3.21, 'pp')).toBe('+3.2 pp')
    expect(formatByUnit(-3.21, 'pp')).toBe('-3.2 pp')
  })

  it('keeps plain numbers short', () => {
    expect(formatByUnit(0.2, 'number')).toBe('0.2')
    expect(formatByUnit(1.25, 'number')).toBe('1.25')
    expect(formatByUnit(10, 'number')).toBe('10')
  })

  it('never shows NaN or Infinity', () => {
    for (const unit of ['percent', 'money', 'years', 'pp', 'number'] as const) {
      expect(formatByUnit(Number.NaN, unit)).toBe('—')
      expect(formatByUnit(Number.POSITIVE_INFINITY, unit)).toBe('—')
    }
  })

  it('respects an explicit number of decimals', () => {
    expect(formatByUnit(12.345, 'percent', 2)).toBe('12.35%')
  })
})

describe('labQueryString', () => {
  it('builds the run URL with the experiment and every parameter', () => {
    const qs = labQueryString('diversification', { assets: 10, correlation: 0.2 })
    const params = new URLSearchParams(qs)
    expect(params.get('experiment')).toBe('diversification')
    expect(params.get('assets')).toBe('10')
    expect(params.get('correlation')).toBe('0.2')
  })

  it('is stable regardless of the order the parameters were set in', () => {
    // The SWR cache key; two orderings of the same inputs must hit one entry.
    expect(labQueryString('beta', { beta: 1, marketMove: -20 })).toBe(
      labQueryString('beta', { marketMove: -20, beta: 1 }),
    )
  })

  it('drops parameters that are not finite rather than sending "NaN"', () => {
    const qs = labQueryString('beta', { beta: Number.NaN, marketMove: 5 })
    expect(qs).not.toContain('NaN')
    expect(new URLSearchParams(qs).get('marketMove')).toBe('5')
  })
})
