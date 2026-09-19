// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { ANALYTICS_CONTRACTS, type AnalyticsRoute } from '@/lib/contracts/analytics'
import { PID } from './fake-env'

// 5.3 — every /api/analytics/[pid]/* route, called through its real handler on
// a synthetic book, answers in the shape its screen reads. The schema is the
// one the hook types are inferred from (src/lib/contracts/analytics.ts), so a
// route that renames a field fails here and a screen that reads a field the
// contract lacks fails to compile.

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
  // Nothing leaves the process: no cache, no service-role writes, no network.
  for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) {
    vi.stubEnv(key, '')
  }
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('contract tests run offline')
  }))
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Handler = (req: Request, ctx: { params: Promise<{ pid: string }> }) => Promise<Response>
type Data = Record<string, unknown>

async function call(path: string, handler: Handler, query = ''): Promise<Data> {
  const url = `http://contract.test/api/analytics/${PID}/${path}${query ? `?${query}` : ''}`
  const response = await handler(new Request(url), { params: Promise.resolve({ pid: PID }) })
  const body = (await response.json()) as { data: Data | null; error: string | null }
  expect(body.error, `${path} answered an error`).toBeNull()
  expect(response.status).toBe(200)
  return body.data as Data
}

/** Parse against the route's contract, failing with every field that does not match. */
function holds(route: AnalyticsRoute, data: unknown) {
  const parsed = (ANALYTICS_CONTRACTS[route] as z.ZodType).safeParse(data)
  if (!parsed.success) throw new Error(`${route} breaks its contract:\n${z.prettifyError(parsed.error)}`)
}

/**
 * Each route, the query its screen sends, and what makes the answer a real one
 * rather than a "not enough data" message that would satisfy the contract
 * vacuously.
 */
const ROUTES: Array<{
  route: AnalyticsRoute
  load: () => Promise<{ GET: Handler }>
  query?: string
  full: (data: Data) => void
}> = [
  {
    route: 'allocation',
    load: () => import('@/app/api/analytics/[pid]/allocation/route'),
    full: (d) => {
      expect((d.bySector as unknown[]).length).toBeGreaterThan(0)
      expect((d.bySymbol as unknown[]).length).toBe(4)
    },
  },
  {
    route: 'income',
    load: () => import('@/app/api/analytics/[pid]/income/route'),
    full: (d) => expect((d.by_position as unknown[]).length).toBe(2),
  },
  {
    route: 'returns',
    load: () => import('@/app/api/analytics/[pid]/returns/route'),
    full: (d) => expect((d.calendar as unknown[]).length).toBeGreaterThan(0),
  },
  {
    route: 'risk',
    load: () => import('@/app/api/analytics/[pid]/risk/route'),
    full: (d) => {
      expect(d.message).toBeUndefined()
      expect((d.drawdown_series as { dates: unknown[] }).dates.length).toBeGreaterThan(0)
    },
  },
  {
    route: 'monte-carlo',
    load: () => import('@/app/api/analytics/[pid]/monte-carlo/route'),
    query: 'weeks=52',
    full: (d) => {
      expect(d.message).toBeUndefined()
      expect((d.bands as unknown[]).length).toBeGreaterThan(0)
    },
  },
  {
    route: 'attribution',
    load: () => import('@/app/api/analytics/[pid]/attribution/route'),
    full: (d) => expect((d.sectors as unknown[]).length).toBeGreaterThan(0),
  },
  {
    route: 'attribution/temporal',
    load: () => import('@/app/api/analytics/[pid]/attribution/temporal/route'),
    query: 'granularity=month&period=1Y',
    full: (d) => expect((d.buckets as unknown[]).length).toBeGreaterThan(0),
  },
  {
    route: 'risk-sources',
    load: () => import('@/app/api/analytics/[pid]/risk-sources/route'),
    full: (d) => expect(d.message).toBeUndefined(),
  },
  {
    route: 'health',
    load: () => import('@/app/api/analytics/[pid]/health/route'),
    full: (d) => expect(d.message).toBeUndefined(),
  },
  {
    route: 'diagnostic',
    load: () => import('@/app/api/analytics/[pid]/diagnostic/route'),
    full: (d) => expect((d.answers as unknown[]).length).toBeGreaterThan(0),
  },
  {
    route: 'scenario-engine',
    load: () => import('@/app/api/analytics/[pid]/scenario-engine/route'),
    // The card's first request (scenario-engine.tsx INITIAL).
    query:
      'allocation=current&expected=&horizon=60&monthly=0&rebalance=none&inflation=0&custody=0&commission=0&shock=0&shockMonth=12',
    full: (d) => {
      expect(d.message).toBeUndefined()
      expect(d.result).toBeDefined()
    },
  },
  {
    route: 'factors',
    load: () => import('@/app/api/analytics/[pid]/factors/route'),
    full: (d) => {
      expect(d.message).toBeUndefined()
      expect(d.regression).toBeDefined()
    },
  },
  {
    route: 'optimization',
    load: () => import('@/app/api/analytics/[pid]/optimization/route'),
    full: (d) => {
      expect(d.message).toBeUndefined()
      expect(d.efficient_frontier).toBeTruthy()
      expect(d.model_comparison).toBeTruthy()
    },
  },
  {
    route: 'scenarios',
    load: () => import('@/app/api/analytics/[pid]/scenarios/route'),
    // The card's first request (scenario-comparison.tsx).
    query: 'horizon=1&include=current,equalWeight,riskParity,minVariance',
    full: (d) => expect(d.comparison).toBeTruthy(),
  },
  {
    route: 'rebalance',
    load: () => import('@/app/api/analytics/[pid]/rebalance/route'),
    full: (d) => expect((d.holdings as unknown[]).length).toBe(4),
  },
  {
    route: 'backtest',
    load: () => import('@/app/api/analytics/[pid]/backtest/route'),
    query: 'cost=0.1',
    full: (d) => expect((d.schedules as unknown[]).length).toBeGreaterThan(0),
  },
  {
    route: 'exposure',
    load: () => import('@/app/api/analytics/[pid]/exposure/route'),
    full: (d) => expect(d.message).toBeUndefined(),
  },
  {
    route: 'stress',
    load: () => import('@/app/api/analytics/[pid]/stress/route'),
    full: (d) => expect((d.results as unknown[]).length).toBeGreaterThan(0),
  },
]

describe('every analytics route answers in the shape its screen reads', () => {
  it.each(ROUTES)('$route', async ({ route, load, query, full }) => {
    const { GET } = await load()
    const data = await call(route, GET, query)
    full(data)
    holds(route, data)
  }, 60_000)

  it('covers every contract', () => {
    expect(ROUTES.map((r) => r.route).sort()).toEqual(Object.keys(ANALYTICS_CONTRACTS).sort())
  })
})
