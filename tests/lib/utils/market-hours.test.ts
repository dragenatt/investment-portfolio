import { describe, it, expect } from 'vitest'
import { usMarketState, elapsed } from '@/lib/utils/market-hours'

describe('usMarketState', () => {
  it('is open during the regular session, New York time, in summer and in winter', () => {
    // 2026-09-21 is a Monday; New York is UTC-4 in September.
    expect(usMarketState(new Date('2026-09-21T13:30:00Z'))).toBe('open')
    expect(usMarketState(new Date('2026-09-21T19:59:00Z'))).toBe('open')
    // 2026-12-01 is a Tuesday; New York is UTC-5 in December.
    expect(usMarketState(new Date('2026-12-01T14:30:00Z'))).toBe('open')
    expect(usMarketState(new Date('2026-12-01T13:30:00Z'))).toBe('closed')
  })

  it('is closed before the open and from the close', () => {
    expect(usMarketState(new Date('2026-09-21T13:29:00Z'))).toBe('closed')
    expect(usMarketState(new Date('2026-09-21T20:00:00Z'))).toBe('closed')
  })

  it('knows weekends and the exchange holidays', () => {
    expect(usMarketState(new Date('2026-09-19T15:00:00Z'))).toBe('weekend')
    // Labor Day, a Monday.
    expect(usMarketState(new Date('2026-09-07T15:00:00Z'))).toBe('holiday')
    // Independence Day falls on a Saturday in 2026 and is observed on Friday.
    expect(usMarketState(new Date('2026-07-03T15:00:00Z'))).toBe('holiday')
  })

  it('closes at 13:00 on an early-close day', () => {
    // The day after Thanksgiving 2026; New York is UTC-5.
    expect(usMarketState(new Date('2026-11-27T17:59:00Z'))).toBe('open')
    expect(usMarketState(new Date('2026-11-27T18:00:00Z'))).toBe('closed')
  })
})

describe('elapsed', () => {
  it('says how long ago, in the largest sensible unit', () => {
    expect(elapsed(0, 8_000)).toEqual({ n: 8, unit: 's' })
    expect(elapsed(0, 3 * 60_000 + 5_000)).toEqual({ n: 3, unit: 'min' })
    expect(elapsed(0, 2 * 3_600_000)).toEqual({ n: 2, unit: 'h' })
    expect(elapsed(10_000, 0)).toEqual({ n: 0, unit: 's' })
  })
})
