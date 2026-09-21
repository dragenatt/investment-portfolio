import { describe, it, expect } from 'vitest'
import {
  exchangeFor,
  quotesToPriceRows,
  changedRows,
  mergePriceUpdate,
  realtimeSymbolFilter,
  reconnectDelayMs,
  LIVE_POLL_MS,
  LIVE_QUOTE_TTL_MS,
  QUOTE_TTL_MS,
  type CurrentPriceRow,
} from '@/lib/services/live-prices'

const NOW = Date.parse('2026-09-14T15:00:00Z')

describe('quotesToPriceRows', () => {
  it('turns provider quotes into current_prices rows', () => {
    const rows = quotesToPriceRows(
      { AAPL: { price: 232.1, change: 1.2, changePct: 0.52, currency: 'USD', previousClose: 230.9 } },
      NOW,
    )
    expect(rows).toEqual([
      {
        symbol: 'AAPL',
        exchange: 'US',
        price: 232.1,
        change_pct: 0.52,
        volume: 0,
        currency: 'USD',
        source: 'provider',
        fetched_at: new Date(NOW).toISOString(),
        expires_at: new Date(NOW + QUOTE_TTL_MS).toISOString(),
      },
    ])
  })

  it('stores a cached quote with the time it was read, not the time it was published', () => {
    const readAt = new Date(NOW - 4 * 60 * 1000).toISOString()
    const [row] = quotesToPriceRows(
      { AAPL: { price: 232.1, change: null, changePct: null, currency: 'USD', fetchedAt: readAt } },
      NOW,
    )
    expect(row.fetched_at).toBe(readAt)
  })

  it('skips quotes without a usable price rather than storing a zero', () => {
    const rows = quotesToPriceRows(
      {
        AAPL: { price: null, change: null, changePct: null, currency: 'USD' },
        MSFT: { price: Number.NaN, change: null, changePct: null, currency: 'USD' },
        VOO: { price: -1, change: null, changePct: null, currency: 'USD' },
      },
      NOW,
    )
    expect(rows).toEqual([])
  })

  it('keeps currency pairs on the FX exchange the rates route uses', () => {
    expect(exchangeFor('USDMXN=X')).toBe('FX')
    expect(exchangeFor('AAPL')).toBe('US')
    expect(exchangeFor('^GSPC')).toBe('US')
  })

  it('stores a missing daily change as null, not as a fake 0%', () => {
    const [row] = quotesToPriceRows({ X: { price: 10, change: null, changePct: null, currency: 'USD' } }, NOW)
    expect(row.change_pct).toBeNull()
  })
})

describe('changedRows', () => {
  const row = (symbol: string, price: number, change_pct: number | null = 0.5): CurrentPriceRow => ({
    symbol,
    exchange: 'US',
    price,
    change_pct,
    volume: 0,
    currency: 'USD',
    source: 'provider',
    fetched_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + QUOTE_TTL_MS).toISOString(),
  })

  it('writes only what differs from what is stored, so Realtime does not broadcast repeats', () => {
    const stored = [
      { symbol: 'AAPL', exchange: 'US', price: 232.1, change_pct: 0.5, expires_at: new Date(NOW + 1000).toISOString() },
      { symbol: 'MSFT', exchange: 'US', price: 400, change_pct: 0.5, expires_at: new Date(NOW + 1000).toISOString() },
    ]
    const next = [row('AAPL', 232.1), row('MSFT', 401), row('VOO', 600)]
    expect(changedRows(next, stored, NOW).map((r) => r.symbol)).toEqual(['MSFT', 'VOO'])
  })

  it('rewrites an unchanged price whose stored row has expired', () => {
    const stored = [{ symbol: 'AAPL', exchange: 'US', price: 232.1, change_pct: 0.5, expires_at: new Date(NOW - 1).toISOString() }]
    expect(changedRows([row('AAPL', 232.1)], stored, NOW)).toHaveLength(1)
  })

  it('treats a stored numeric string as the number it is', () => {
    // PostgREST returns NUMERIC columns as JSON numbers, but a string must not
    // make every row look changed.
    const stored = [{ symbol: 'AAPL', exchange: 'US', price: '232.1', change_pct: '0.5', expires_at: new Date(NOW + 1000).toISOString() }]
    expect(changedRows([row('AAPL', 232.1)], stored, NOW)).toEqual([])
  })
})

describe('mergePriceUpdate', () => {
  const current = {
    AAPL: { price: 230, previousClose: 228, change: 2, changePct: 0.877, currency: 'USD', name: 'Apple' },
    MSFT: { price: 400, previousClose: null, change: null, changePct: 0.1, currency: 'USD' },
  }

  it('updates the price and recomputes the daily change against the previous close', () => {
    const next = mergePriceUpdate(current, { symbol: 'AAPL', price: 239.4, change_pct: 0.3 })!
    expect(next.AAPL.price).toBe(239.4)
    expect(next.AAPL.change).toBeCloseTo(11.4, 10)
    expect(next.AAPL.changePct).toBeCloseTo((11.4 / 228) * 100, 10)
    // Everything else about the quote is kept.
    expect(next.AAPL.name).toBe('Apple')
    expect(next.AAPL.previousClose).toBe(228)
  })

  it('falls back to the row\'s own change when there is no previous close to anchor to', () => {
    const next = mergePriceUpdate(current, { symbol: 'MSFT', price: 402, change_pct: 0.6 })!
    expect(next.MSFT.price).toBe(402)
    expect(next.MSFT.changePct).toBe(0.6)
  })

  it("carries the pushed row's read time, and drops the old one when the row has none", () => {
    const quotes = { AAPL: { price: 230, previousClose: 228, change: 2, changePct: 0.88, currency: 'USD', fetchedAt: '2026-09-11T20:00:00.000Z' } }
    const withTime = mergePriceUpdate(quotes, { symbol: 'AAPL', price: 231, change_pct: null, fetched_at: '2026-09-14T14:59:00.000Z' })
    expect(withTime!.AAPL.fetchedAt).toBe('2026-09-14T14:59:00.000Z')
    const withoutTime = mergePriceUpdate(quotes, { symbol: 'AAPL', price: 231, change_pct: null })
    expect(withoutTime!.AAPL.fetchedAt).toBeUndefined()
  })

  it('ignores symbols this view is not showing', () => {
    expect(mergePriceUpdate(current, { symbol: 'TSLA', price: 300, change_pct: 1 })).toBeNull()
  })

  it('ignores a row with no usable price instead of blanking the quote', () => {
    expect(mergePriceUpdate(current, { symbol: 'AAPL', price: null, change_pct: 1 })).toBeNull()
    expect(mergePriceUpdate(current, { symbol: 'AAPL', price: 'abc', change_pct: 1 })).toBeNull()
    expect(mergePriceUpdate(current, { symbol: 'AAPL', price: 0, change_pct: 1 })).toBeNull()
  })

  it('returns a new object and leaves the old one untouched', () => {
    const next = mergePriceUpdate(current, { symbol: 'AAPL', price: 231, change_pct: 0.1 })!
    expect(next).not.toBe(current)
    expect(current.AAPL.price).toBe(230)
  })

  it('does nothing when there is no data yet', () => {
    expect(mergePriceUpdate(undefined, { symbol: 'AAPL', price: 231, change_pct: 0.1 })).toBeNull()
  })

  it('accepts a numeric string from the Realtime payload', () => {
    expect(mergePriceUpdate(current, { symbol: 'AAPL', price: '231.5', change_pct: '0.2' })!.AAPL.price).toBe(231.5)
  })
})

describe('realtimeSymbolFilter', () => {
  it('limits the subscription to the symbols on screen', () => {
    // The table is shared market data; the filter is what keeps a user from
    // receiving every price anyone else is looking at.
    expect(realtimeSymbolFilter(['MSFT', 'AAPL', 'AAPL'])).toBe('symbol=in.(AAPL,MSFT)')
  })

  it('returns null for nothing to watch', () => {
    expect(realtimeSymbolFilter([])).toBeNull()
  })

  it('drops anything that could break out of the filter syntax', () => {
    expect(realtimeSymbolFilter(['AAPL', 'X),symbol=in.(Y', '^GSPC', 'USDMXN=X', 'BRK.B'])).toBe(
      'symbol=in.(AAPL,BRK.B,USDMXN=X,^GSPC)',
    )
  })

  it('caps the list at what one Realtime filter accepts', () => {
    const many = Array.from({ length: 150 }, (_, i) => `S${i}`)
    const filter = realtimeSymbolFilter(many)!
    expect(filter.slice('symbol=in.('.length, -1).split(',')).toHaveLength(100)
  })
})

describe('polling and reconnection', () => {
  it('polls as often as the server refreshes a quote, and no less', () => {
    // The channel only carries what polls write; a slow heartbeat while it was
    // up meant prices moved every five minutes.
    expect(LIVE_POLL_MS).toBe(LIVE_QUOTE_TTL_MS)
    expect(LIVE_POLL_MS).toBeLessThanOrEqual(15_000)
  })

  it('backs off reconnection attempts and caps the wait', () => {
    expect(reconnectDelayMs(0)).toBe(1000)
    expect(reconnectDelayMs(1)).toBe(2000)
    expect(reconnectDelayMs(3)).toBe(8000)
    expect(reconnectDelayMs(20)).toBe(30_000)
  })
})
