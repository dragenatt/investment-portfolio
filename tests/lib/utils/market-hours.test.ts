import { describe, it, expect } from 'vitest'
import { usMarketState, usMarketCalendar, elapsed } from '@/lib/utils/market-hours'

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

// The calendar is computed from the exchange's rules, so it has to agree with
// the published one. These four years are nyse.com's, copied by hand: two past
// ones as an anchor, and the two the hand-written list used to hold.
describe('usMarketCalendar', () => {
  it('matches the published NYSE calendar for 2024', () => {
    expect(usMarketCalendar(2024)).toEqual({
      holidays: [
        '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
        '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
      ],
      earlyCloses: ['2024-07-03', '2024-11-29', '2024-12-24'],
    })
  })

  it('matches the published NYSE calendar for 2025', () => {
    expect(usMarketCalendar(2025)).toEqual({
      holidays: [
        '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
        '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
      ],
      earlyCloses: ['2025-07-03', '2025-11-28', '2025-12-24'],
    })
  })

  it('matches the published NYSE calendar for 2026, where a holiday moves off a Saturday', () => {
    expect(usMarketCalendar(2026)).toEqual({
      holidays: [
        '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
        // Independence Day falls on a Saturday and closes the Friday before,
        // which is why there is no early close that July.
        '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
      ],
      earlyCloses: ['2026-11-27', '2026-12-24'],
    })
  })

  it('matches the published NYSE calendar for 2027, where two holidays move', () => {
    expect(usMarketCalendar(2027)).toEqual({
      holidays: [
        // Juneteenth on a Saturday closes the Friday before; Independence Day
        // on a Sunday closes the Monday after; Christmas on a Saturday closes
        // Friday the 24th, so Christmas Eve is not an early close either.
        '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
        '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
      ],
      earlyCloses: ['2027-11-26'],
    })
  })

  it('keeps working past the year the hand-written list ended in', () => {
    // The list stopped at the end of 2027, and the day it ran out the dashboard
    // would have called Christmas morning an open market.
    expect(usMarketState(new Date('2028-12-25T15:00:00Z'))).toBe('holiday')
    expect(usMarketCalendar(2028).holidays).toContain('2028-12-25')
    expect(usMarketCalendar(2031).holidays).toContain('2031-04-11') // Good Friday
  })

  it('leaves New Year\'s Day on a Saturday unobserved, alone among the holidays', () => {
    // 2028-01-01 is a Saturday: the exchange trades Friday 2027-12-31 normally.
    expect(usMarketCalendar(2028).holidays).not.toContain('2027-12-31')
    expect(usMarketCalendar(2028).holidays[0]).toBe('2028-01-17') // straight to MLK Day
    expect(usMarketState(new Date('2027-12-31T15:00:00Z'))).toBe('open')
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
