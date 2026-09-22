// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A position's symbol could not be changed: six holdings imported as
// FEMSAUBD-style symbols no provider knows were valued at cost with no way to
// fix them but deleting the position and entering every trade again.
// Synthetic ids and prices.

type Row = { id: string; symbol: string; portfolio_id: string }

const db = vi.hoisted(() => ({
  positions: [] as Row[],
  updates: [] as Array<{ id: string; symbol: string }>,
  user: { id: 'u1' } as { id: string } | null,
}))
const quotes = vi.hoisted(() => ({ bySymbol: {} as Record<string, { price: number | null; currency: string } | null> }))
const audits = vi.hoisted(() => ({ entries: [] as unknown[] }))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => {
      const filters: Record<string, string> = {}
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          filters[column] = value
          return query
        },
        maybeSingle: async () => ({
          data: db.positions.find((p) => Object.entries(filters).every(([k, v]) => (p as Record<string, string>)[k] === v)) ?? null,
        }),
        update: (values: { symbol: string }) => ({
          eq: async (_column: string, id: string) => {
            db.updates.push({ id, symbol: values.symbol })
            return { error: null }
          },
        }),
      }
      return query
    },
  }),
}))
vi.mock('@/lib/services/market', () => ({ getQuote: async (symbol: string) => quotes.bySymbol[symbol] ?? null }))
vi.mock('@/lib/services/audit', () => ({ recordAudit: (...entries: unknown[]) => audits.entries.push(...entries) }))
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: async () => true }))

const { PATCH } = await import('@/app/api/portfolio/[id]/positions/[positionId]/route')

const call = async (symbol: unknown, portfolioId = 'pf1', positionId = 'pos1') => {
  const response = await PATCH(
    new Request(`http://test/api/portfolio/${portfolioId}/positions/${positionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    }),
    { params: Promise.resolve({ id: portfolioId, positionId }) },
  )
  return { status: response.status, body: (await response.json()) as { data: Record<string, unknown> | null; error: string | null } }
}

beforeEach(() => {
  db.positions = [{ id: 'pos1', symbol: 'FEMSAUBD', portfolio_id: 'pf1' }]
  db.updates = []
  db.user = { id: 'u1' }
  quotes.bySymbol = { 'FEMSAUBD.MX': { price: 206.58, currency: 'MXN' } }
  audits.entries = []
})

describe('PATCH /api/portfolio/[id]/positions/[positionId]', () => {
  it('renames the position to a symbol that prices, and records the change', async () => {
    const { status, body } = await call('femsaubd.mx')

    expect(status).toBe(200)
    expect(body.data).toMatchObject({ symbol: 'FEMSAUBD.MX', changed: true, price: 206.58, currency: 'MXN' })
    expect(db.updates).toEqual([{ id: 'pos1', symbol: 'FEMSAUBD.MX' }])
    expect(audits.entries).toEqual([
      expect.objectContaining({ entityType: 'position', field: 'symbol', oldValue: 'FEMSAUBD', newValue: 'FEMSAUBD.MX' }),
    ])
  })

  it('refuses a symbol nothing prices, which would fix nothing', async () => {
    const { status, body } = await call('STILLWRONG')

    expect(status).toBe(422)
    expect(body.error).toContain('STILLWRONG')
    expect(db.updates).toEqual([])
  })

  it('refuses a symbol the portfolio already holds', async () => {
    db.positions.push({ id: 'pos2', symbol: 'FEMSAUBD.MX', portfolio_id: 'pf1' })

    const { status } = await call('FEMSAUBD.MX')

    expect(status).toBe(409)
    expect(db.updates).toEqual([])
  })

  it('does not find a position outside the portfolio named in the path', async () => {
    expect((await call('FEMSAUBD.MX', 'someone-elses')).status).toBe(404)
    expect(db.updates).toEqual([])
  })

  it('rejects something that is not a symbol, and requires a session', async () => {
    expect((await call('femsa ubd')).status).toBe(400)
    db.user = null
    expect((await call('FEMSAUBD.MX')).status).toBe(401)
  })
})
