/*
 * InvestTracker service worker (C4).
 *
 * Three strategies, one per kind of request:
 *
 *   assets      /_next/static/*, /icons/*    cache-first
 *               File names carry a content hash, so a cached copy is never out
 *               of date; it is either the right file or a different URL.
 *
 *   data        allow-listed GET /api/*       network-first, cache as fallback
 *               The network always wins. The cache is read only when the request
 *               fails outright, and what it returns is marked (x-sw-source:
 *               cache, x-sw-stored-at) so the page can say it is showing saved
 *               data. A cached price is never presented as the current price.
 *
 *   shell       page navigations              stale-while-revalidate
 *               A page opened before opens instantly, and offline, from the
 *               copy saved last time, while the network refreshes that copy.
 *               The (app) pages are client components: their HTML is layout,
 *               not numbers, and the numbers load through the data strategy.
 *               If the refresh comes back as a redirect (the session ended),
 *               the copy is deleted and the page is told, so it reloads into
 *               the login redirect instead of showing a signed-in shell.
 *
 * Everything else passes through untouched: non-GET requests, other origins,
 * auth pages, RSC fetches, job status polling.
 *
 * The page registers /sw.js?v=<build>. A new deploy is a new script URL, so the
 * browser installs a new worker, which deletes the previous build's asset and
 * shell caches on activation. Saved data survives deploys; sign-out and sign-in
 * delete it from the page (src/lib/pwa/offline-data.ts).
 */

'use strict'

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE_PREFIX = 'it-'
const ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`
const DATA_CACHE = `${CACHE_PREFIX}data-v1`
// Its own cache, so trimming the asset cache can never evict it.
const OFFLINE_CACHE = `${CACHE_PREFIX}offline-${VERSION}`

const OFFLINE_URL = '/offline'

const MAX_ASSETS = 400
const MAX_SHELL = 40
const MAX_DATA = 150

// What a user needs to look at their money offline. An endpoint missing from
// here is simply not saved, which is the safe way to be wrong.
const DATA_PREFIXES = [
  '/api/market/',
  '/api/rates',
  '/api/dashboard',
  '/api/portfolio',
  '/api/transaction',
  '/api/watchlist',
  '/api/analytics/',
  '/api/goals',
  '/api/alerts',
]
const DATA_EXCLUDED = ['/api/market/search', '/api/analytics/vitals']
const SHELL_EXCLUDED = ['/login', '/register', '/auth', '/offline', '/admin']

function underPrefix(path, prefix) {
  if (prefix.endsWith('/')) return path.startsWith(prefix)
  return path === prefix || path.startsWith(prefix + '/')
}

/** Which strategy handles a request, or null to leave it to the network. */
function strategyFor(request) {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return null
  if (request.headers.get('range')) return null
  const path = url.pathname

  if (path.startsWith('/_next/static/') || path.startsWith('/icons/')) return 'asset'

  if (path.startsWith('/api/')) {
    if (DATA_EXCLUDED.some((prefix) => underPrefix(path, prefix))) return null
    return DATA_PREFIXES.some((prefix) => underPrefix(path, prefix)) ? 'data' : null
  }

  if (request.mode === 'navigate') {
    // Client-side navigations fetch RSC payloads, not documents.
    if (request.headers.get('rsc') || url.searchParams.has('_rsc')) return null
    return SHELL_EXCLUDED.some((prefix) => underPrefix(path, prefix)) ? null : 'shell'
  }

  return null
}

/** Put, then drop the oldest entries past the limit. Cache keys keep insertion order. */
async function putBounded(cache, request, response, limit) {
  await cache.delete(request)
  await cache.put(request, response)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i])
}

function withHeaders(response, extra, body) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(extra)) headers.set(name, value)
  return new Response(body === undefined ? response.body : body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// ---------------------------------------------------------------- assets

async function cacheFirst(event) {
  // Every cache, not only this one: the offline page's own files were saved
  // with it at install time and have to be found when it renders offline.
  const cached = await caches.match(event.request)
  if (cached) return cached

  const response = await fetch(event.request)
  if (response.status === 200 && response.type === 'basic') {
    const copy = response.clone()
    event.waitUntil(caches.open(ASSET_CACHE).then((cache) => putBounded(cache, event.request, copy, MAX_ASSETS)))
  }
  return response
}

// ---------------------------------------------------------------- data

function isSavableData(response) {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    !response.redirected &&
    (response.headers.get('content-type') || '').includes('application/json')
  )
}

async function networkFirst(event) {
  const cache = await caches.open(DATA_CACHE)

  let response
  try {
    response = await fetch(event.request)
  } catch {
    const cached = await cache.match(event.request)
    if (cached) return withHeaders(cached, { 'x-sw-source': 'cache' })
    return new Response(JSON.stringify({ data: null, error: 'Sin conexión' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'x-sw-source': 'offline' },
    })
  }

  if (isSavableData(response)) {
    const copy = response.clone()
    event.waitUntil(
      copy
        .arrayBuffer()
        .then((body) =>
          putBounded(cache, event.request, withHeaders(copy, { 'x-sw-stored-at': String(Date.now()) }, body), MAX_DATA),
        ),
    )
  }
  return response
}

// ---------------------------------------------------------------- shell

// url -> promise of how the latest revalidation of that page ended:
// 'fresh' | 'redirect' | 'failed'. A page asks once it has loaded.
const revalidations = new Map()

function isSavableShell(response) {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    (response.headers.get('content-type') || '').includes('text/html')
  )
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(event.request)

  // Clone before anything reads the body: the copy for the cache and the
  // original for the page stream side by side, so saving never holds up paint.
  const network = fetch(event.request).then((response) => ({
    response,
    copy: isSavableShell(response) ? response.clone() : null,
  }))

  const settled = network.then(
    async ({ response, copy }) => {
      if (copy) {
        await putBounded(cache, event.request, copy, MAX_SHELL)
        return 'fresh'
      }
      if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
        // The saved copy belongs to a session that no longer exists.
        await cache.delete(event.request)
        return 'redirect'
      }
      return 'failed'
    },
    () => 'failed',
  )
  event.waitUntil(settled)

  if (!cached) {
    try {
      return (await network).response
    } catch {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }
  }

  revalidations.set(event.request.url, settled)
  return cached
}

// ---------------------------------------------------------------- lifecycle

/** Precache the offline page and the static files it needs to render. */
async function precacheOfflinePage() {
  const cache = await caches.open(OFFLINE_CACHE)
  const response = await fetch(OFFLINE_URL, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`offline page returned ${response.status}`)
  const html = await response.clone().text()
  await cache.put(OFFLINE_URL, response)
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])]
  await Promise.all(
    assets.map((asset) =>
      fetch(asset).then((r) => (r.ok ? cache.put(asset, r) : undefined)).catch(() => undefined),
    ),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheOfflinePage().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSET_CACHE, SHELL_CACHE, DATA_CACHE, OFFLINE_CACHE])
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && !keep.has(key)) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request)
  if (strategy === 'asset') event.respondWith(cacheFirst(event))
  else if (strategy === 'data') event.respondWith(networkFirst(event))
  else if (strategy === 'shell') event.respondWith(staleWhileRevalidate(event))
})

self.addEventListener('message', (event) => {
  const message = event.data
  if (!message || message.type !== 'shell-status' || typeof message.url !== 'string') return
  const pending = revalidations.get(message.url)
  event.waitUntil(
    Promise.resolve(pending || 'unknown').then((status) => {
      if (pending) revalidations.delete(message.url)
      if (event.source) event.source.postMessage({ type: 'shell-status', url: message.url, status })
    }),
  )
})
