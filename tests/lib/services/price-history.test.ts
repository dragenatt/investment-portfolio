import { describe, it, expect, vi, beforeEach } from 'vitest'

const getHistory = vi.fn()
vi.mock('@/lib/services/market', () => ({ getHistory: (...args: unknown[]) => getHistory(...args) }))

const upsert = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  serviceRoleClient: () => ({ from: () => ({ upsert }) }),
}))

import {
  fetchAdjustedPriceHistory,
  isHistoryStale,
  lastSettledSession,
  lastStoredDates,
  mergeRows,
  resetTopUpAttempts,
  topUpRange,
  topUpStoredHistory,
  TOP_UP_RETRY_MS,
} from '@/lib/services/price-history'

/** A provider bar on a date, stamped at the New York open like Yahoo's. */
const bar = (date: string, close: number) => ({ date: `${date}T13:30:00.000Z`, open: close, high: close, low: close, close, volume: 1 })

beforeEach(() => {
  getHistory.mockReset()
  upsert.mockReset().mockResolvedValue({ error: null })
  resetTopUpAttempts()
})

describe('lastSettledSession', () => {
  it('is the previous weekday until the day has closed, then the day itself', () => {
    expect(lastSettledSession(new Date('2026-09-15T15:00:00Z'))).toBe('2026-09-14') // Tuesday, market open
    expect(lastSettledSession(new Date('2026-09-15T22:30:00Z'))).toBe('2026-09-15') // Tuesday, after the close
  })

  it('skips the weekend in both directions', () => {
    expect(lastSettledSession(new Date('2026-09-14T06:00:00Z'))).toBe('2026-09-11') // Monday morning → Friday
    expect(lastSettledSession(new Date('2026-09-12T23:00:00Z'))).toBe('2026-09-11') // Saturday night → Friday
    expect(lastSettledSession(new Date('2026-09-13T12:00:00Z'))).toBe('2026-09-11') // Sunday → Friday
  })
})

describe('isHistoryStale', () => {
  const tuesdayMorning = new Date('2026-09-15T06:00:00Z')

  it('flags a series that stops before the last settled session', () => {
    // The production table on this date: every series ended on Friday the 11th.
    expect(isHistoryStale('2026-09-11', tuesdayMorning)).toBe(true)
    expect(isHistoryStale('2026-09-14', tuesdayMorning)).toBe(false)
    expect(isHistoryStale(undefined, tuesdayMorning)).toBe(true)
  })

  it('does not flag Friday over the weekend', () => {
    expect(isHistoryStale('2026-09-11', new Date('2026-09-13T12:00:00Z'))).toBe(false)
  })
})

describe('topUpRange', () => {
  const now = new Date('2026-09-15T06:00:00Z')
  it('asks for the shortest daily range that reaches back to the last stored date', () => {
    expect(topUpRange('2026-09-11', now)).toBe('1mo')
    expect(topUpRange('2026-07-01', now)).toBe('3mo')
    expect(topUpRange('2026-03-01', now)).toBe('6mo')
  })
})

describe('lastStoredDates and mergeRows', () => {
  it('finds each symbol’s latest date in any order', () => {
    expect(lastStoredDates([
      { symbol: 'AAPL', date: '2026-09-11' },
      { symbol: 'MSFT', date: '2026-09-10' },
      { symbol: 'AAPL', date: '2026-09-09' },
    ])).toEqual({ AAPL: '2026-09-11', MSFT: '2026-09-10' })
  })

  it('keeps one row per symbol and date, ascending, the newer source winning', () => {
    const merged = mergeRows(
      [{ symbol: 'AAPL', date: '2026-09-11', close: 1 }, { symbol: 'AAPL', date: '2026-09-10', close: 2 }],
      [{ symbol: 'AAPL', date: '2026-09-11', close: 3 }, { symbol: 'AAPL', date: '2026-09-14', close: 4 }],
    )
    expect(merged).toEqual([
      { symbol: 'AAPL', date: '2026-09-10', close: 2 },
      { symbol: 'AAPL', date: '2026-09-11', close: 3 },
      { symbol: 'AAPL', date: '2026-09-14', close: 4 },
    ])
  })
})

describe('topUpStoredHistory', () => {
  const tuesdayMidday = new Date('2026-09-15T16:00:00Z')

  it('returns and stores only the finished sessions after the last stored date', async () => {
    getHistory.mockResolvedValueOnce([
      bar('2026-09-10', 326.57),
      bar('2026-09-11', 332.23),
      bar('2026-09-14', 333.08),
      bar('2026-09-15', 330.97), // still trading: not a close yet
    ])

    const added = await topUpStoredHistory({ AAPL: '2026-09-11' }, tuesdayMidday)

    expect(getHistory).toHaveBeenCalledWith('AAPL', '1mo')
    expect(added).toEqual([{ symbol: 'AAPL', date: '2026-09-14', close: 333.08 }])
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written, options] = upsert.mock.calls[0]
    expect(written).toEqual([expect.objectContaining({ symbol: 'AAPL', exchange: 'yahoo', date: '2026-09-14', close: 333.08 })])
    expect(options).toEqual({ onConflict: 'symbol,exchange,date' })
  })

  it('leaves a current series alone', async () => {
    expect(await topUpStoredHistory({ AAPL: '2026-09-14' }, tuesdayMidday)).toEqual([])
    expect(getHistory).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not ask the provider again for a symbol it just tried, until the retry window passes', async () => {
    getHistory.mockResolvedValue([bar('2026-09-11', 332.23)]) // a holiday: nothing new
    await topUpStoredHistory({ AAPL: '2026-09-11' }, tuesdayMidday)
    await topUpStoredHistory({ AAPL: '2026-09-11' }, new Date(tuesdayMidday.getTime() + 60_000))
    expect(getHistory).toHaveBeenCalledTimes(1)

    await topUpStoredHistory({ AAPL: '2026-09-11' }, new Date(tuesdayMidday.getTime() + TOP_UP_RETRY_MS))
    expect(getHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps going when one symbol fails', async () => {
    getHistory.mockImplementation(async (symbol: string) => {
      if (symbol === 'BAD') throw new Error('provider down')
      return [bar('2026-09-14', 505.41)]
    })
    const added = await topUpStoredHistory({ BAD: '2026-09-11', MSFT: '2026-09-11' }, tuesdayMidday)
    expect(added).toEqual([{ symbol: 'MSFT', date: '2026-09-14', close: 505.41 }])
  })
})

describe('fetchAdjustedPriceHistory stored tier', () => {
  function storedClient(rows: Array<{ symbol: string; date: string; close: number }>) {
    const calls: { order?: [string, { ascending: boolean }]; limit?: number } = {}
    const query = {
      select: () => query,
      in: () => query,
      order: (column: string, opts: { ascending: boolean }) => { calls.order = [column, opts]; return query },
      limit: (n: number) => { calls.limit = n; return Promise.resolve({ data: rows }) },
    }
    return { client: { from: () => query } as never, calls }
  }

  it('reads the newest rows first and serves the sessions the table is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T16:00:00Z'))
    try {
      const dates = ['2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01', '2026-08-31', '2026-08-28']
      const { client, calls } = storedClient(dates.map((date, i) => ({ symbol: 'AAPL', date, close: 330 - i })))
      getHistory.mockResolvedValueOnce([bar('2026-09-14', 333.08)])

      const result = await fetchAdjustedPriceHistory(client, ['AAPL'])

      expect(calls.order).toEqual(['date', { ascending: false }])
      // Stored rows completed with the provider's newer close.
      expect(result.source).toBe('mixed')
      expect(result.rows.at(-1)).toMatchObject({ symbol: 'AAPL', date: '2026-09-14', close: 333.08 })
      expect(result.rows.map((r) => r.date)).toEqual([...dates].reverse().concat('2026-09-14'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fetchAdjustedPriceHistory: a new holding next to stored ones', () => {
  function storedOnly(rows: Array<{ symbol: string; date: string; close: number }>) {
    const query = {
      select: () => query,
      in: () => query,
      order: () => query,
      limit: () => Promise.resolve({ data: rows }),
    }
    return { from: () => query } as never
  }

  it('fetches the symbol the table has nothing for, instead of reporting it missing forever', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T16:00:00Z'))
    try {
      const dates = ['2026-09-14', '2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01', '2026-08-31']
      const client = storedOnly(dates.map((date, i) => ({ symbol: 'AAPL', date, close: 330 - i })))
      getHistory.mockImplementation(async (symbol: string) => (symbol === 'NVDA' ? [bar('2026-09-11', 205), bar('2026-09-14', 210.96)] : []))

      const result = await fetchAdjustedPriceHistory(client, ['AAPL', 'NVDA'])

      // Before: AAPL's ten rows cleared the threshold and NVDA came back missing without a provider call.
      expect(getHistory).toHaveBeenCalledWith('NVDA', '6mo')
      expect(getHistory).not.toHaveBeenCalledWith('AAPL', expect.anything())
      expect(result.covered).toEqual(['AAPL', 'NVDA'])
      expect(result.missing).toEqual([])
      expect(upsert.mock.calls.flatMap((c) => c[0]).map((r: { symbol: string; date: string }) => `${r.symbol} ${r.date}`)).toEqual([
        'NVDA 2026-09-11',
        'NVDA 2026-09-14',
      ])

      // A symbol no provider knows is not asked for again on the next request.
      getHistory.mockClear()
      await fetchAdjustedPriceHistory(storedOnly(dates.map((date, i) => ({ symbol: 'AAPL', date, close: 330 - i }))), ['AAPL', 'COCA34'])
      await fetchAdjustedPriceHistory(storedOnly(dates.map((date, i) => ({ symbol: 'AAPL', date, close: 330 - i }))), ['AAPL', 'COCA34'])
      expect(getHistory.mock.calls.filter(([s]) => s === 'COCA34')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
