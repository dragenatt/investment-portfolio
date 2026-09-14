// @vitest-environment node
//
// Runs the real public/sw.js in a sandbox with an in-memory CacheStorage and a
// scripted network, so what is tested is the file browsers install.

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8')
const ORIGIN = 'https://app.test'

class FakeCache {
  entries = new Map<string, Response>()
  private key(request: RequestLike | string) {
    return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
  }
  async match(request: RequestLike | string) {
    const hit = this.entries.get(this.key(request))
    return hit ? hit.clone() : undefined
  }
  async put(request: RequestLike | string, response: Response) {
    // A real Cache reads the body to the end; so does this one.
    const body = await response.arrayBuffer()
    this.entries.set(this.key(request), new Response(body, { status: response.status, headers: response.headers }))
  }
  async delete(request: RequestLike | string) {
    return this.entries.delete(this.key(request))
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(request: RequestLike | string) {
    for (const store of this.stores.values()) {
      const hit = await store.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

type RequestLike = { url: string; method: string; mode: string; headers: Headers }
type Handler = (event: FakeEvent) => void

function request(pathname: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}): RequestLike {
  return {
    url: new URL(pathname, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.headers ?? {}),
  }
}

/** A Response with the properties a same-origin fetch has in a worker. */
function networkResponse(
  body: string,
  { status = 200, type = 'basic', redirected = false, contentType = 'application/json' } = {},
): Response {
  const response = new Response(status === 0 ? null : body, {
    status: status === 0 ? 200 : status,
    headers: { 'content-type': contentType },
  })
  Object.defineProperty(response, 'type', { value: type })
  Object.defineProperty(response, 'redirected', { value: redirected })
  if (status === 0) Object.defineProperty(response, 'status', { value: 0 })
  return response
}

class FakeEvent {
  response: Promise<Response> | undefined
  lifetime: Promise<unknown>[] = []
  data: unknown
  source: { postMessage: (message: unknown) => void } | undefined
  constructor(public request?: RequestLike) {}
  respondWith(promise: Promise<Response>) {
    this.response = promise
  }
  waitUntil(promise: Promise<unknown>) {
    this.lifetime.push(promise)
  }
  async settled() {
    const response = this.response ? await this.response : undefined
    // waitUntil can be called while earlier promises run; drain until stable.
    let seen = 0
    while (seen < this.lifetime.length) {
      const batch = this.lifetime.slice(seen)
      seen = this.lifetime.length
      await Promise.allSettled(batch)
    }
    return response
  }
}

type Network = (req: RequestLike | string) => Promise<Response>

function loadWorker(version = 'build-2') {
  const handlers = new Map<string, Handler>()
  const cacheStorage = new FakeCacheStorage()
  let network: Network = async () => {
    throw new TypeError('Failed to fetch')
  }
  const calls: string[] = []
  const sandbox = {
    self: {
      location: new URL(`/sw.js?v=${version}`, ORIGIN),
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: cacheStorage,
    fetch: (req: RequestLike | string) => {
      calls.push(typeof req === 'string' ? req : new URL(req.url).pathname + new URL(req.url).search)
      return network(req)
    },
    Response,
    Headers,
    URL,
    Promise,
    Date,
    Map,
    Set,
    JSON,
    String,
    Object,
  }
  vm.runInNewContext(SOURCE, sandbox)

  const dispatch = (type: string, event: FakeEvent) => {
    handlers.get(type)!(event)
    return event
  }
  return {
    caches: cacheStorage,
    calls,
    setNetwork(fn: Network) {
      network = fn
    },
    goOffline() {
      network = async () => {
        throw new TypeError('Failed to fetch')
      }
    },
    fetch(req: RequestLike) {
      return dispatch('fetch', new FakeEvent(req))
    },
    dispatch,
  }
}

async function text(response: Response | undefined) {
  return response ? await response.text() : undefined
}

describe('service worker routing', () => {
  let sw: ReturnType<typeof loadWorker>
  beforeEach(() => {
    sw = loadWorker()
  })

  it('leaves non-GET requests, other origins and unlisted API routes to the network', () => {
    for (const req of [
      request('/api/portfolio', { method: 'POST' }),
      { ...request('/'), url: 'https://mabmqxztvakaijtrncyl.supabase.co/rest/v1/profiles' },
      request('/api/jobs/abc/status'),
      request('/api/market/search?q=AAPL'),
      request('/api/analytics/vitals'),
      request('/api/cron/snapshots'),
      request('/manifest.json'),
    ]) {
      expect(sw.fetch(req).response, req.url).toBeUndefined()
    }
  })

  it('does not treat a lookalike path as an allow-listed one', () => {
    expect(sw.fetch(request('/api/ratesheet')).response).toBeUndefined()
    expect(sw.fetch(request('/api/rates')).response).toBeDefined()
  })

  it('never caches auth pages, the offline page, admin pages or RSC navigations', () => {
    for (const pathname of ['/login', '/login?next=%2Fdashboard', '/register', '/offline', '/admin/metrics']) {
      expect(sw.fetch(request(pathname, { mode: 'navigate' })).response, pathname).toBeUndefined()
    }
    expect(sw.fetch(request('/dashboard', { mode: 'navigate', headers: { RSC: '1' } })).response).toBeUndefined()
    expect(sw.fetch(request('/dashboard?_rsc=abc', { mode: 'navigate' })).response).toBeUndefined()
  })
})

describe('assets: cache-first', () => {
  it('serves a hashed file from the cache without touching the network again', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => networkResponse('console.log(1)', { contentType: 'application/javascript' }))
    await sw.fetch(request('/_next/static/chunks/abc123.js')).settled()

    sw.goOffline()
    const response = await sw.fetch(request('/_next/static/chunks/abc123.js')).settled()
    expect(await text(response)).toBe('console.log(1)')
    expect(sw.calls).toEqual(['/_next/static/chunks/abc123.js'])
  })

  it('does not save failed responses', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => networkResponse('not found', { status: 404 }))
    await sw.fetch(request('/_next/static/chunks/gone.js')).settled()
    const store = await sw.caches.open('it-assets-build-2')
    expect(store.entries.size).toBe(0)
  })
})

describe('data: network-first, and saved data is always marked', () => {
  it('returns the network response when online and saves a stamped copy', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => networkResponse('{"data":{"AAPL":200}}'))
    const response = await sw.fetch(request('/api/market/batch?symbols=AAPL')).settled()

    expect(await text(response)).toBe('{"data":{"AAPL":200}}')
    // What the page received from the network carries no saved-data marker.
    expect(response!.headers.get('x-sw-source')).toBeNull()

    const saved = await (await sw.caches.open('it-data-v1')).match(request('/api/market/batch?symbols=AAPL'))
    expect(Number(saved!.headers.get('x-sw-stored-at'))).toBeGreaterThan(0)
  })

  it('prefers the network even when a saved copy exists', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => networkResponse('{"data":{"AAPL":200}}'))
    await sw.fetch(request('/api/market/batch?symbols=AAPL')).settled()

    sw.setNetwork(async () => networkResponse('{"data":{"AAPL":201}}'))
    const response = await sw.fetch(request('/api/market/batch?symbols=AAPL')).settled()
    expect(await text(response)).toBe('{"data":{"AAPL":201}}')
  })

  it('falls back to the saved copy offline, marked as saved with its date', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => networkResponse('{"data":{"total":2734.34}}'))
    await sw.fetch(request('/api/portfolio/p1')).settled()

    sw.goOffline()
    const response = await sw.fetch(request('/api/portfolio/p1')).settled()
    expect(await text(response)).toBe('{"data":{"total":2734.34}}')
    expect(response!.headers.get('x-sw-source')).toBe('cache')
    expect(Number(response!.headers.get('x-sw-stored-at'))).toBeGreaterThan(0)
  })

  it('answers offline with nothing saved as an explicit 503, not as data', async () => {
    const sw = loadWorker()
    const response = await sw.fetch(request('/api/rates')).settled()
    expect(response!.status).toBe(503)
    expect(response!.headers.get('x-sw-source')).toBe('offline')
    expect(JSON.parse((await text(response))!)).toEqual({ data: null, error: 'Sin conexión' })
  })

  it('does not save errors, redirects (an ended session) or non-JSON', async () => {
    const sw = loadWorker()
    for (const [pathname, response] of [
      ['/api/portfolio/a', networkResponse('{"error":"x"}', { status: 500 })],
      ['/api/portfolio/b', networkResponse('<html>login</html>', { redirected: true, contentType: 'text/html' })],
      ['/api/portfolio/c', networkResponse('{"data":1}', { redirected: true })],
      ['/api/portfolio/d', networkResponse('<html></html>', { contentType: 'text/html' })],
    ] as const) {
      sw.setNetwork(async () => response)
      await sw.fetch(request(pathname)).settled()
    }
    expect((await sw.caches.open('it-data-v1')).entries.size).toBe(0)
  })
})

describe('shell: stale-while-revalidate', () => {
  const html = (marker: string) => networkResponse(`<html>${marker}</html>`, { contentType: 'text/html; charset=utf-8' })

  it('serves the saved page at once and refreshes it from the network', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => html('v1'))
    await sw.fetch(request('/dashboard', { mode: 'navigate' })).settled()

    sw.setNetwork(async () => html('v2'))
    const second = await sw.fetch(request('/dashboard', { mode: 'navigate' })).settled()
    expect(await text(second)).toBe('<html>v1</html>')

    sw.goOffline()
    const third = await sw.fetch(request('/dashboard', { mode: 'navigate' })).settled()
    expect(await text(third)).toBe('<html>v2</html>')
  })

  it('shows the offline page for a page never saved', async () => {
    const sw = loadWorker()
    const offlineStore = await sw.caches.open('it-offline-build-2')
    await offlineStore.put('/offline', html('sin conexión'))

    const response = await sw.fetch(request('/portfolio/p9', { mode: 'navigate' })).settled()
    expect(await text(response)).toBe('<html>sin conexión</html>')
  })

  it('deletes the saved page when the refresh is a redirect, and tells the page', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => html('signed in'))
    await sw.fetch(request('/dashboard', { mode: 'navigate' })).settled()

    sw.setNetwork(async () => networkResponse('', { status: 0, type: 'opaqueredirect' }))
    await sw.fetch(request('/dashboard', { mode: 'navigate' })).settled()

    const store = await sw.caches.open('it-shell-build-2')
    expect(store.entries.size).toBe(0)

    const replies: unknown[] = []
    const ask = new FakeEvent()
    ask.data = { type: 'shell-status', url: `${ORIGIN}/dashboard` }
    ask.source = { postMessage: (message) => replies.push(message) }
    await sw.dispatch('message', ask).settled()
    expect(replies).toEqual([{ type: 'shell-status', url: `${ORIGIN}/dashboard`, status: 'redirect' }])
  })

  it('reports a successful refresh as fresh, and unknown for pages it did not serve', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => html('a'))
    await sw.fetch(request('/market', { mode: 'navigate' })).settled()
    await sw.fetch(request('/market', { mode: 'navigate' })).settled()

    const replies: Array<{ status: string }> = []
    for (const url of [`${ORIGIN}/market`, `${ORIGIN}/lab`]) {
      const ask = new FakeEvent()
      ask.data = { type: 'shell-status', url }
      ask.source = { postMessage: (message) => replies.push(message as { status: string }) }
      await sw.dispatch('message', ask).settled()
    }
    expect(replies.map((r) => r.status)).toEqual(['fresh', 'unknown'])
  })

  it('keeps no more than 40 pages', async () => {
    const sw = loadWorker()
    sw.setNetwork(async () => html('x'))
    for (let i = 0; i < 45; i++) await sw.fetch(request(`/portfolio/p${i}`, { mode: 'navigate' })).settled()
    const store = await sw.caches.open('it-shell-build-2')
    expect(store.entries.size).toBe(40)
    expect(store.entries.has(`${ORIGIN}/portfolio/p0`)).toBe(false)
    expect(store.entries.has(`${ORIGIN}/portfolio/p44`)).toBe(true)
  })
})

describe('lifecycle', () => {
  it('precaches the offline page and the static files it references', async () => {
    const sw = loadWorker()
    sw.setNetwork(async (req) => {
      const url = typeof req === 'string' ? req : new URL(req.url).pathname
      if (url === '/offline') {
        return networkResponse('<link href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js"></script>', {
          contentType: 'text/html',
        })
      }
      return networkResponse('asset', { contentType: 'text/plain' })
    })
    await sw.dispatch('install', new FakeEvent()).settled()

    const store = await sw.caches.open('it-offline-build-2')
    expect([...store.entries.keys()].sort()).toEqual([
      `${ORIGIN}/_next/static/chunks/main.js`,
      `${ORIGIN}/_next/static/css/app.css`,
      `${ORIGIN}/offline`,
    ])
  })

  it("deletes the previous build's assets and pages but keeps saved data", async () => {
    const sw = loadWorker('build-2')
    for (const name of ['it-assets-build-1', 'it-shell-build-1', 'it-offline-build-1', 'it-data-v1', 'it-assets-build-2', 'someone-else']) {
      await sw.caches.open(name)
    }
    await sw.dispatch('activate', new FakeEvent()).settled()
    expect((await sw.caches.keys()).sort()).toEqual(['it-assets-build-2', 'it-data-v1', 'someone-else'])
  })
})
