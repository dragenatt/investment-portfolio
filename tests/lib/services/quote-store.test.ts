import { describe, it, expect, vi } from 'vitest'
import { publishQuotes } from '@/lib/services/quote-store'
import { symbolChunks, QUOTES_PER_REQUEST, MAX_FILTER_SYMBOLS } from '@/lib/services/live-prices'
import type { BatchQuote } from '@/lib/services/market'

// A holding nobody had on screen kept whatever price it was last looked at
// with: the quotes route is the only thing that wrote current_prices, and it
// dropped every symbol past the twentieth. Synthetic symbols and prices.

const quote = (price: number | null, currency = 'USD'): BatchQuote => ({
  price,
  previousClose: price,
  change: 0,
  changePct: 0,
  currency,
  fetchedAt: new Date('2026-09-19T12:00:00Z').toISOString(),
})

/** A Supabase stand-in that records the upsert and answers with stored rows. */
function writerWith(stored: Array<Record<string, unknown>>, upsertError: { message: string } | null = null) {
  const upserts: Array<Array<Record<string, unknown>>> = []
  const client = {
    from() {
      const query: Record<string, unknown> = {
        select: () => query,
        in: () => query,
        upsert: (rows: Array<Record<string, unknown>>) => {
          upserts.push(rows)
          return Promise.resolve({ error: upsertError })
        },
      }
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: stored, error: null }).then(resolve)
      return query
    },
  }
  return { client: client as never, upserts }
}

const NOW = Date.parse('2026-09-19T12:00:00Z')
const future = new Date(NOW + 60_000).toISOString()

describe('publishQuotes', () => {
  it('writes a symbol that has no stored row', async () => {
    const { client, upserts } = writerWith([])
    expect(await publishQuotes(client, { AAA: quote(10) }, NOW)).toBe(1)
    expect(upserts[0][0]).toMatchObject({ symbol: 'AAA', price: 10, exchange: 'US' })
  })

  it('leaves an unchanged, unexpired price alone, so Realtime broadcasts no false move', async () => {
    const { client, upserts } = writerWith([{ symbol: 'AAA', exchange: 'US', price: 10, change_pct: 0, expires_at: future }])
    expect(await publishQuotes(client, { AAA: quote(10) }, NOW)).toBe(0)
    expect(upserts).toEqual([])
  })

  it('writes a price that moved', async () => {
    const { client, upserts } = writerWith([{ symbol: 'AAA', exchange: 'US', price: 9, change_pct: 0, expires_at: future }])
    expect(await publishQuotes(client, { AAA: quote(10) }, NOW)).toBe(1)
    expect(upserts[0][0]).toMatchObject({ price: 10 })
  })

  it('never publishes a quote without a price: a stored zero reads as a total loss', async () => {
    const { client, upserts } = writerWith([])
    expect(await publishQuotes(client, { AAA: quote(null) }, NOW)).toBe(0)
    expect(upserts).toEqual([])
  })

  it('reports a failed write instead of throwing: publishing must not cost what fetched the quotes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = writerWith([], { message: 'nope' })
    expect(await publishQuotes(client, { AAA: quote(10) }, NOW)).toBe(0)
  })
})

describe('symbolChunks', () => {
  const symbols = Array.from({ length: 47 }, (_, i) => `S${i}`)

  it('covers every symbol, in provider-sized batches', () => {
    const chunks = symbolChunks(symbols)
    expect(chunks.flat()).toEqual(symbols)
    expect(chunks.every((c) => c.length <= QUOTES_PER_REQUEST)).toBe(true)
    expect(chunks.length).toBe(Math.ceil(47 / QUOTES_PER_REQUEST))
  })

  it('handles an empty list and a list smaller than one batch', () => {
    expect(symbolChunks([])).toEqual([])
    expect(symbolChunks(['A', 'B'])).toEqual([['A', 'B']])
  })

  it('batches below the ceiling the Realtime filter sets', () => {
    expect(QUOTES_PER_REQUEST).toBeLessThanOrEqual(MAX_FILTER_SYMBOLS)
  })
})
