// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Price alerts were evaluated once a night. The Cloudflare worker now calls
// this route every five minutes with the cron secret.

const run = vi.hoisted(() => vi.fn())
const log = vi.hoisted(() => ({ started: [] as string[], finished: [] as unknown[], pruned: 0 }))
vi.mock('@/lib/services/portfolio-notifications', () => ({ runPriceAlerts: run }))
vi.mock('@/lib/services/snapshots', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({
        eq: () => ({
          lt: async () => {
            log.pruned++
            return { error: null }
          },
        }),
      }),
    }),
  }),
  startCronRun: async (_supabase: unknown, job: string) => {
    log.started.push(job)
    return 'run-1'
  },
  finishCronRun: async (_supabase: unknown, _id: string, result: unknown) => {
    log.finished.push(result)
  },
}))

process.env.CRON_SECRET = 'test-cron-secret'

const { GET, POST } = await import('@/app/api/cron/alerts/route')

const call = (handler: typeof GET, authorization?: string) =>
  handler(new Request('https://app.example/api/cron/alerts', { headers: authorization ? { authorization } : {} }))

beforeEach(() => {
  run.mockReset().mockResolvedValue({ fired: 1, delivered: 1, skipped: 0 })
  log.started = []
  log.finished = []
  log.pruned = 0
})

describe('/api/cron/alerts', () => {
  it('evaluates the price alerts when called with the cron secret', async () => {
    const response = await call(GET, 'Bearer test-cron-secret')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, fired: 1 })
    expect(run).toHaveBeenCalledTimes(1)
    // Recorded, so the schedule can be seen to be alive, and old runs pruned.
    expect(log.started).toEqual(['price_alerts'])
    expect(log.finished).toEqual([{ processed: 1, errors: 0 }])
    expect(log.pruned).toBe(1)
  })

  it('records a failed run instead of losing it', async () => {
    run.mockRejectedValue(new Error('quotes down'))

    const response = await call(GET, 'Bearer test-cron-secret')

    expect(response.status).toBe(500)
    expect(log.finished).toEqual([{ processed: 0, errors: 1, errorDetails: { message: 'quotes down' } }])
  })

  it('accepts POST too, for schedulers that post', async () => {
    expect((await call(POST, 'Bearer test-cron-secret')).status).toBe(200)
  })

  it('does nothing for anyone else', async () => {
    expect((await call(GET)).status).toBe(401)
    expect((await call(GET, 'Bearer wrong')).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
    expect(log.started).toEqual([])
  })
})
