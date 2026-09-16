import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ serviceRoleClient: () => null }))

import { computePortfolioSnapshot, finishCronRun } from '@/lib/services/snapshots'

/** A Supabase stand-in that records what each query asked for. */
function recordingClient(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const client = {
    from(table: string) {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'update', 'eq', 'is', 'order', 'gte', 'single', 'maybeSingle', 'in']) {
        query[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return query
        }
      }
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return query
    },
  }
  return { client: client as never, calls }
}

describe('finishCronRun', () => {
  it('records the outcome without a duration, which the routes write once measured', async () => {
    const { client, calls } = recordingClient({ error: null })
    await finishCronRun(client, 'run-1', { processed: 3, errors: 1 })

    const update = calls.find((c) => c.method === 'update')!
    const payload = update.args[0] as Record<string, unknown>
    // Date.now() in an integer column made Postgres reject the whole update,
    // leaving every run marked 'running'.
    expect(payload).not.toHaveProperty('duration_ms')
    expect(payload).toMatchObject({ status: 'partial', portfolios_processed: 3, portfolios_failed: 1 })
    expect(calls).toContainEqual({ table: 'cron_runs', method: 'eq', args: ['id', 'run-1'] })
  })

  it('calls a run with nothing processed and errors a failure, and one without errors a success', async () => {
    const failed = recordingClient({ error: null })
    await finishCronRun(failed.client, 'r', { processed: 0, errors: 2 })
    expect((failed.calls.find((c) => c.method === 'update')!.args[0] as { status: string }).status).toBe('failed')

    const ok = recordingClient({ error: null })
    await finishCronRun(ok.client, 'r', { processed: 2, errors: 0 })
    expect((ok.calls.find((c) => c.method === 'update')!.args[0] as { status: string }).status).toBe('success')
  })
})

describe('computePortfolioSnapshot', () => {
  it('reads the portfolio currency from base_currency, the column that exists', async () => {
    const { client, calls } = recordingClient({ data: null, error: { message: 'not found' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await computePortfolioSnapshot(client, 'p1', '2026-09-15')

    const select = calls.find((c) => c.table === 'portfolios' && c.method === 'select')!
    expect(select.args[0]).toBe('id, name, currency:base_currency, user_id')
  })
})

// ─── The Sharpe and Sortino the snapshot stores are the app's own ───────────

import { calculateSharpeRatio } from '@/lib/services/analytics'
import { calculateSortinoRatio } from '@/lib/services/asset-metrics'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

/** What snapshots.ts used to compute inline, kept here as the thing to match. */
function legacySharpe(returns: number[], riskFree: number): number {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const avg = mean
  const variance = returns.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (returns.length - 1)
  const annualVol = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
  const annualReturn = mean * TRADING_DAYS_PER_YEAR
  return annualVol > 0 ? Math.round(((annualReturn - riskFree) / annualVol) * 100) / 100 : 0
}

function legacySortino(returns: number[], riskFree: number): number {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualReturn = mean * TRADING_DAYS_PER_YEAR
  const squares = returns.filter((r) => r < 0).map((r) => r * r)
  const downside = squares.length === 0 ? 0 : Math.sqrt(squares.reduce((s, v) => s + v, 0) / returns.length)
  const annualDownside = downside * Math.sqrt(TRADING_DAYS_PER_YEAR)
  return annualDownside > 0 ? Math.round(((annualReturn - riskFree) / annualDownside) * 100) / 100 : 0
}

describe('snapshot risk metrics use the app-wide formulas', () => {
  // A series with a real spread of up and down days, and one that only rises.
  const mixed = [0.012, -0.008, 0.004, -0.015, 0.02, 0.001, -0.003, 0.009, -0.011, 0.006, 0.014, -0.002]
  const onlyUp = [0.004, 0.006, 0.002, 0.009, 0.001, 0.007, 0.003, 0.005, 0.008, 0.002, 0.004, 0.006]
  const riskFree = 0.0679 // CETES-shaped, as a peso book would use

  const round2 = (v: number) => Math.round(v * 100) / 100

  it('produces the same Sharpe the inline version did', () => {
    expect(round2(calculateSharpeRatio(mixed, riskFree))).toBe(legacySharpe(mixed, riskFree))
    expect(round2(calculateSharpeRatio(onlyUp, riskFree))).toBe(legacySharpe(onlyUp, riskFree))
  })

  it('produces the same Sortino the inline version did, when it is measurable', () => {
    const shared = calculateSortinoRatio(mixed, riskFree, TRADING_DAYS_PER_YEAR)
    expect(shared).not.toBeNull()
    expect(round2(shared!)).toBe(legacySortino(mixed, riskFree))
  })

  it('reports Sortino as null, not zero, for a book that never fell', () => {
    // The inline version stored 0 here, which reads as "earned nothing per unit
    // of downside risk". There was no downside risk to divide by.
    expect(calculateSortinoRatio(onlyUp, riskFree, TRADING_DAYS_PER_YEAR)).toBeNull()
    expect(legacySortino(onlyUp, riskFree)).toBe(0)
  })
})
