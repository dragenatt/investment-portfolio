// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The quotes route kept the first twenty symbols and dropped the rest without
// saying so: a book with more holdings than that showed no live price for the
// remainder, and — since this route is what writes current_prices — their
// stored quote never refreshed either. Synthetic symbols only.

const fetched: string[][] = []
const published: Array<Record<string, unknown>> = []
const session = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({ serviceRoleClient: () => ({}) }))

vi.mock('@/lib/services/quote-store', () => ({
  publishQuotes: async (_writer: unknown, quotes: Record<string, unknown>) => {
    published.push(quotes)
    return Object.keys(quotes).length
  },
}))

vi.mock('@/lib/services/market', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/market')>()
  return {
    ...actual,
    getBatchQuotes: async (symbols: string[]) => {
      fetched.push(symbols)
      return Object.fromEntries(
        symbols.map((symbol) => [symbol, { price: 100, previousClose: 100, change: 0, changePct: 0, currency: 'USD' }]),
      )
    },
  }
})

// `after` runs post-response in the platform; here it runs inline so the test
// can see what was published.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})

import { GET } from '@/app/api/market/batch/route'
import { QUOTES_PER_REQUEST, MAX_FILTER_SYMBOLS } from '@/lib/services/live-prices'

const ask = async (symbols: string[]) => {
  const response = await GET(new Request(`http://test/api/market/batch?symbols=${symbols.join(',')}`))
  const body = (await response.json()) as { data: Record<string, unknown> }
  return { status: response.status, quotes: body.data }
}

beforeEach(() => {
  fetched.length = 0
  published.length = 0
})

describe('GET /api/market/batch', () => {
  const many = Array.from({ length: 25 }, (_, i) => `S${i}`)

  it('answers for every symbol asked for, not the first twenty', async () => {
    const { status, quotes } = await ask(many)
    expect(status).toBe(200)
    expect(Object.keys(quotes).sort()).toEqual([...many].sort())
  })

  it('asks the provider in batches of its own size', async () => {
    await ask(many)
    expect(fetched.flat()).toEqual(many)
    expect(fetched.every((batch) => batch.length <= QUOTES_PER_REQUEST)).toBe(true)
  })

  it('publishes every quote it fetched, so a holding nobody is watching still refreshes', async () => {
    await ask(many)
    expect(Object.keys(published[0]).length).toBe(many.length)
  })

  it('drops duplicates and stops at the ceiling the Realtime filter has', async () => {
    const { quotes } = await ask(['AAA', 'AAA', 'BBB'])
    expect(Object.keys(quotes).sort()).toEqual(['AAA', 'BBB'])

    const tooMany = Array.from({ length: MAX_FILTER_SYMBOLS + 10 }, (_, i) => `T${i}`)
    const { quotes: capped } = await ask(tooMany)
    expect(Object.keys(capped).length).toBe(MAX_FILTER_SYMBOLS)
  })

  it('refuses an anonymous caller', async () => {
    session.user = null
    try {
      const response = await GET(new Request('http://test/api/market/batch?symbols=AAA'))
      expect(response.status).toBe(401)
    } finally {
      session.user = { id: 'u1' }
    }
  })
})
