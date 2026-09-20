import { describe, it, expect, vi, beforeEach } from 'vitest'
import { currenciesToCover, pairFor, currencyOfPair, DISPLAY_CURRENCIES } from '@/lib/utils/fx-pairs'

const asked = vi.hoisted(() => ({ symbols: [] as string[] }))
const published = vi.hoisted(() => ({ quotes: [] as Record<string, unknown>[] }))

vi.mock('@/lib/services/market', () => ({
  getBatchQuotes: async (symbols: string[]) => {
    asked.symbols = symbols
    return Object.fromEntries(symbols.map((s) => [s, { price: 1, currency: 'USD' }]))
  },
}))

vi.mock('@/lib/services/quote-store', () => ({
  publishQuotes: async (_writer: unknown, quotes: Record<string, unknown>) => {
    published.quotes.push(quotes)
    return Object.keys(quotes).length
  },
}))

const { refreshExchangeRates } = await import('@/lib/services/fx-rates')

describe('pairFor / currencyOfPair', () => {
  it('names a pair the way the app stores it', () => {
    expect(pairFor('jpy')).toBe('USDJPY=X')
    expect(currencyOfPair('USDJPY=X')).toBe('JPY')
    expect(currencyOfPair('AAPL')).toBeNull()
  })
})

describe('currenciesToCover', () => {
  it('always covers what the interface can display', () => {
    expect(currenciesToCover([])).toEqual([...DISPLAY_CURRENCIES].sort())
  })

  it('adds the currencies assets actually trade in', () => {
    const rows = [{ currency: 'USD' }, { currency: 'JPY' }, { currency: 'BRL' }, { currency: 'JPY' }]
    expect(currenciesToCover(rows)).toEqual(['BRL', 'EUR', 'JPY', 'MXN'])
  })

  it('leaves out the base currency, which needs no rate', () => {
    expect(currenciesToCover([{ currency: 'USD' }])).not.toContain('USD')
  })

  it('ignores anything that is not a currency code', () => {
    const rows = [{ currency: null }, { currency: '' }, { currency: 'dollars' }, { currency: 'US' }]
    expect(currenciesToCover(rows)).toEqual([...DISPLAY_CURRENCIES].sort())
  })
})

describe('refreshExchangeRates', () => {
  const writer = {
    from: () => ({ select: async () => ({ data: [{ currency: 'USD' }, { currency: 'JPY' }], error: null }) }),
  }

  beforeEach(() => {
    asked.symbols = []
    published.quotes.length = 0
  })

  it('fetches a pair for every currency in use and publishes them', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub with the two calls this function makes
    const written = await refreshExchangeRates(writer as any)

    expect(asked.symbols.sort()).toEqual(['USDEUR=X', 'USDJPY=X', 'USDMXN=X'])
    expect(written).toBe(3)
    expect(published.quotes).toHaveLength(1)
  })
})
