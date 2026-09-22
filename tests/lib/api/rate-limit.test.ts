// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Nine routes ask Upstash whether a user is over their limit — the dashboard's
// history among them. Upstash answers an exhausted free quota, or a
// pay-as-you-go database at its budget cap, by rate limiting the database
// itself, and the SDK then throws. That throw became a 500 on every one of
// those routes: the chart, trading, importing, deleting an account. A limiter
// that cannot answer must not be what takes the app down.

const limit = vi.hoisted(() => vi.fn())

vi.mock('@upstash/redis', () => ({ Redis: class {} }))
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow() {
      return {}
    }
    limit = limit
  }
  return { Ratelimit }
})

process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'

const { rateLimit } = await import('@/lib/api/rate-limit')

beforeEach(() => {
  limit.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('rateLimit', () => {
  it('passes Upstash\'s answer through', async () => {
    limit.mockResolvedValueOnce({ success: true })
    expect(await rateLimit('u1')).toBe(true)

    limit.mockResolvedValueOnce({ success: false })
    expect(await rateLimit('u1')).toBe(false)
  })

  it('lets the request through when Upstash cannot answer', async () => {
    limit.mockRejectedValueOnce(new Error('ERR max requests limit exceeded'))

    expect(await rateLimit('u1', 'transaction')).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })
})
