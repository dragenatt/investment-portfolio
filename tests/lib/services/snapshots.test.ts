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
