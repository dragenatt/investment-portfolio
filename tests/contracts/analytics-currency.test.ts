// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { PID, syntheticCloses } from './fake-env'

// The analytics engines weighted a book by quantity × close in each holding's
// own currency and added the results: a peso holding and a dollar holding were
// one unit, and every amount was labelled with the portfolio's currency while
// being in none. The synthetic book holds three dollar listings and one peso
// listing in a peso portfolio; every route must now value it the same way.

vi.mock('@/lib/supabase/server', async () => {
  const env = await import('./fake-env')
  return { createServerSupabase: async () => env.fakeSupabase() }
})

vi.mock('@/lib/services/market', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/market')>()
  const env = await import('./fake-env')
  return { ...actual, getHistory: env.syntheticHistory, getBatchQuotes: env.syntheticQuotes }
})

beforeAll(() => {
  for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) {
    vi.stubEnv(key, '')
  }
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('offline')
  }))
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Handler = (req: Request, ctx: { params: Promise<{ pid: string }> }) => Promise<Response>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any

async function get(path: string, load: () => Promise<{ GET: Handler }>, query = ''): Promise<Data> {
  const { GET } = await load()
  const response = await GET(new Request(`http://currency.test/api/analytics/${PID}/${path}?${query}`), {
    params: Promise.resolve({ pid: PID }),
  })
  return ((await response.json()) as { data: Data }).data
}

const last = (symbol: string) => syntheticCloses(symbol).at(-1)!.close
const usdmxn = last('USDMXN=X')

/** The book in pesos, from first principles: quantity × last close × today's rate. */
const expected = {
  AAPL: 10 * last('AAPL') * usdmxn,
  MSFT: 5 * last('MSFT') * usdmxn,
  VOO: 3 * last('VOO') * usdmxn,
  'WALMEX.MX': 100 * last('WALMEX.MX'),
}
const bookInPesos = Object.values(expected).reduce((a, b) => a + b, 0)
const share = (symbol: keyof typeof expected) => (expected[symbol] / bookInPesos) * 100

describe('every engine values the book in the portfolio currency', () => {
  it('allocation: pesos, and each share of the book in pesos', async () => {
    const data = await get('allocation', () => import('@/app/api/analytics/[pid]/allocation/route'))
    expect(data.currency).toBe('MXN')
    expect(data.total).toBeCloseTo(bookInPesos, 2)
    for (const holding of data.bySymbol) expect(holding.pct).toBeCloseTo(share(holding.symbol), 6)
  })

  it('monte-carlo: the cone starts from the book in pesos, weighted in pesos', async () => {
    const data = await get('monte-carlo', () => import('@/app/api/analytics/[pid]/monte-carlo/route'), 'weeks=52')
    expect(data.currency).toBe('MXN')
    expect(data.current_value).toBeCloseTo(bookInPesos, 0)
    for (const asset of data.assets) expect(asset.weight).toBeCloseTo(share(asset.symbol), 1)
  })

  it('scenario-engine: its capital is the book in pesos', async () => {
    const data = await get(
      'scenario-engine',
      () => import('@/app/api/analytics/[pid]/scenario-engine/route'),
      'allocation=current&expected=&horizon=60&monthly=0&rebalance=none&inflation=0&custody=0&commission=0&shock=0&shockMonth=12',
    )
    expect(data.currency).toBe('MXN')
    expect(data.capital).toBeCloseTo(bookInPesos, 2)
    for (const holding of data.allocation.weights) expect(holding.weight * 100).toBeCloseTo(share(holding.symbol), 6)
  })

  it('rebalance: the same book, converted once rather than twice', async () => {
    const data = await get('rebalance', () => import('@/app/api/analytics/[pid]/rebalance/route'))
    expect(data.currency).toBe('MXN')
    expect(data.book_value).toBeCloseTo(bookInPesos, 2)
    expect(data.unconverted).toEqual([])
  })

  it('temporal attribution decomposes the return the returns tab shows', async () => {
    const returns = await get('returns', () => import('@/app/api/analytics/[pid]/returns/route'), 'period=1Y')
    const temporal = await get(
      'attribution/temporal',
      () => import('@/app/api/analytics/[pid]/attribution/temporal/route'),
      'granularity=month&period=1Y',
    )
    expect(temporal.currency).toBe('MXN')
    expect(returns.summary.currency).toBe('MXN')
    // Both rebuild the same book from the same trades and closes, in pesos.
    expect(temporal.total.portfolioReturnPct).toBeCloseTo(returns.summary.twr, 1)
  })

  it('income: each dividend in pesos at the rate of the day it was paid', async () => {
    const data = await get('income', () => import('@/app/api/analytics/[pid]/income/route'))
    expect(data.currency).toBe('MXN')
    // Two AAPL dividends of 2.50 dollars each. In pesos they are worth the
    // dollar amount times that day's rate: well above the 5.00 they summed to.
    const aapl = data.by_position.find((p: { symbol: string }) => p.symbol === 'AAPL')
    const rates = syntheticCloses('USDMXN=X').map((r) => r.close)
    expect(aapl.total).toBeGreaterThan(5 * Math.min(...rates.slice(-400)))
    expect(aapl.total).toBeLessThan(5 * Math.max(...rates.slice(-400)))
  })
})
