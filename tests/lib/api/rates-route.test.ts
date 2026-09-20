// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/rates held a fixed list of two pairs, USDMXN=X and USDEUR=X, because
// those are the currencies the interface can be switched to. What an asset
// trades in is a different question: a holding quoted in yen had no pair, so
// no rate, so its value went into totals unconverted. Synthetic symbols.

type PriceRow = { symbol: string; price: number; currency: string | null; expires_at: string | null }

const stored = vi.hoisted(() => ({ rows: [] as PriceRow[] }))
const quoted = vi.hoisted(() => ({ prices: {} as Record<string, number | null>, asked: [] as string[] }))
const written = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
const session = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
    from: () => ({ select: async () => ({ data: stored.rows, error: null }) }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  serviceRoleClient: () => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        written.rows.push(row)
        return { error: null }
      },
    }),
  }),
}))

vi.mock('@/lib/services/market', () => ({
  getQuote: async (symbol: string) => {
    quoted.asked.push(symbol)
    const price = quoted.prices[symbol]
    return price == null ? null : { symbol, price, changePct: 0 }
  },
}))

const { GET } = await import('@/app/api/rates/route')

const ask = async () => {
  const response = await GET(new Request('http://test/api/rates'))
  const body = (await response.json()) as { data: Record<string, number> | null }
  return { status: response.status, rates: body.data }
}

const hour = () => new Date(Date.now() + 3_600_000).toISOString()

beforeEach(() => {
  stored.rows = []
  quoted.prices = {}
  quoted.asked = []
  written.rows = []
  session.user = { id: 'u1' }
})

describe('GET /api/rates', () => {
  it('covers a currency only an asset trades in', async () => {
    stored.rows = [
      { symbol: 'AAA', price: 100, currency: 'USD', expires_at: hour() },
      { symbol: 'NIKKEI', price: 40000, currency: 'JPY', expires_at: hour() },
    ]
    quoted.prices = { 'USDJPY=X': 156.86, 'USDMXN=X': 17.22, 'USDEUR=X': 0.87 }

    const { rates } = await ask()

    expect(rates).toMatchObject({ USD: 1, JPY: 156.86 })
    expect(quoted.asked).toContain('USDJPY=X')
  })

  it('always covers the currencies the interface can display', async () => {
    // A fresh database with nothing quoted in anything yet still has to be
    // able to show pesos and euros.
    quoted.prices = { 'USDMXN=X': 17.22, 'USDEUR=X': 0.87 }

    const { rates } = await ask()

    expect(Object.keys(rates!).sort()).toEqual(['EUR', 'MXN', 'USD'])
  })

  it('does not ask for a pair it already has a current rate for', async () => {
    stored.rows = [
      { symbol: 'USDMXN=X', price: 17.3, currency: 'USD', expires_at: hour() },
      { symbol: 'USDEUR=X', price: 0.88, currency: 'USD', expires_at: hour() },
    ]

    const { rates } = await ask()

    expect(rates).toMatchObject({ MXN: 17.3, EUR: 0.88 })
    expect(quoted.asked).toEqual([])
  })

  it('prefers the last rate it observed over a constant', async () => {
    stored.rows = [
      { symbol: 'USDMXN=X', price: 19.4, currency: 'USD', expires_at: '2020-01-01T00:00:00.000Z' },
    ]
    quoted.prices = { 'USDEUR=X': 0.87 }

    const { rates } = await ask()

    // Old, but a real number from a real market. The constant is 17.22.
    expect(rates!.MXN).toBe(19.4)
  })

  it('falls back to the documented constant only with nothing else', async () => {
    const { rates } = await ask()

    expect(rates).toEqual({ USD: 1, MXN: 17.22, EUR: 0.87 })
  })

  it('leaves out a currency it has no rate and no constant for', async () => {
    // Better an amount the screen reports as unconverted than a number with no
    // source behind it.
    stored.rows = [{ symbol: 'XYZ', price: 5, currency: 'ZAR', expires_at: hour() }]
    quoted.prices = { 'USDMXN=X': 17.22, 'USDEUR=X': 0.87 }

    const { rates } = await ask()

    expect(rates).not.toHaveProperty('ZAR')
  })

  it('stores a rate it had to fetch', async () => {
    quoted.prices = { 'USDMXN=X': 17.22, 'USDEUR=X': 0.87 }

    await ask()

    expect(written.rows.map((row) => row.symbol).sort()).toEqual(['USDEUR=X', 'USDMXN=X'])
    expect(written.rows.every((row) => row.exchange === 'FX')).toBe(true)
  })

  it('refuses a request with no session', async () => {
    session.user = null
    expect((await ask()).status).toBe(401)
  })
})
