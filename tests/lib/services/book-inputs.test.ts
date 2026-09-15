import { describe, it, expect } from 'vitest'
import { periodCutoff, periodToRange, RETURN_PERIODS } from '@/lib/services/book-inputs'

describe('periodCutoff', () => {
  const now = new Date('2026-09-14T12:00:00Z')

  it('counts back from today', () => {
    expect(periodCutoff('1M', now)).toBe('2026-08-14')
    expect(periodCutoff('3M', now)).toBe('2026-06-14')
    expect(periodCutoff('6M', now)).toBe('2026-03-14')
    expect(periodCutoff('1Y', now)).toBe('2025-09-14')
    expect(periodCutoff('YTD', now)).toBe('2026-01-01')
    expect(periodCutoff('ALL', now)).toBe('2020-09-14')
  })

  it('treats an unknown period as one year and does not mutate the date it was given', () => {
    expect(periodCutoff('whatever', now)).toBe('2025-09-14')
    expect(now.toISOString()).toBe('2026-09-14T12:00:00.000Z')
  })
})

describe('periodToRange', () => {
  it('maps every period to a market-data range', () => {
    expect(RETURN_PERIODS.map(periodToRange)).toEqual(['1mo', '3mo', '6mo', '1y', '1y', 'max'])
  })
})
