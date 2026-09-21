// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The asset page's header read "$0.00 USD (--)" for a holding that was up
// 1.6% on the day: the route answered with the stored current_prices row,
// whose fields are change_pct rather than change and changePct. It now answers
// with the live quote. Synthetic figures.

const session = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))
const quotes = vi.hoisted(() => ({ bySymbol: {} as Record<string, unknown>, asked: [] as string[] }))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
    // A stored row the route must not answer with.
    from: () => ({ select: () => ({ eq: () => ({ gt: () => ({ single: async () => ({ data: { symbol: 'VOO', price: 700, change_pct: 1.5 } }) }) }) }) }),
  }),
}))

vi.mock('@/lib/services/market', () => ({
  getQuote: async (symbol: string) => {
    quotes.asked.push(symbol)
    return quotes.bySymbol[symbol] ?? null
  },
}))

const { GET } = await import('@/app/api/market/[symbol]/route')

const ask = async (symbol: string) => {
  const response = await GET(new Request(`http://test/api/market/${symbol}`), { params: Promise.resolve({ symbol }) })
  return { status: response.status, body: (await response.json()) as { data: Record<string, unknown> | null } }
}

beforeEach(() => {
  session.user = { id: 'u1' }
  quotes.bySymbol = {}
  quotes.asked = []
})

describe('GET /api/market/[symbol]', () => {
  it('answers with the live quote, daily change included', async () => {
    quotes.bySymbol.VOO = { symbol: 'VOO', price: 712.78, previousClose: 701.78, change: 11, changePct: 1.567, currency: 'USD', name: 'Vanguard S&P 500 ETF' }

    const { status, body } = await ask('VOO')

    expect(status).toBe(200)
    expect(body.data).toMatchObject({ price: 712.78, change: 11, changePct: 1.567, name: 'Vanguard S&P 500 ETF' })
    expect(body.data).not.toHaveProperty('change_pct')
    expect(quotes.asked).toEqual(['VOO'])
  })

  it('says a symbol no provider knows is not found', async () => {
    expect((await ask('NOPE')).status).toBe(404)
  })

  it('answers nothing without a session', async () => {
    session.user = null
    expect((await ask('VOO')).status).toBe(401)
    expect(quotes.asked).toEqual([])
  })
})
