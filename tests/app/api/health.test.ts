// @vitest-environment node
import { describe, it, expect } from 'vitest'

// The proxy has exempted /api/health from its per-address limit since request
// limits were added, for a route that did not exist — so the exemption guarded
// a 404 and nothing could check whether the app was up without a session.

const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  it('answers that the app is up, and which build answered', async () => {
    process.env.NEXT_PUBLIC_BUILD_VERSION = 'abc123def456'

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.version).toBe('abc123def456')
    expect(Date.parse(body.time)).not.toBeNaN()
  })

  it('is never cached, so the answer is about now', async () => {
    const response = await GET()

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('says nothing about configuration', async () => {
    const body = await (await GET()).json()

    // The whole answer, so a future field cannot slip past this.
    expect(Object.keys(body).sort()).toEqual(['ok', 'time', 'version'])
  })
})
