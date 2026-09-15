// Load tests (C8). Node only, no dependencies — the "k6 or equivalent" of the
// roadmap, runnable anywhere the repo is.
//
//   node scripts/load-test.mjs <scenario> [--base URL] [--concurrency N] [--duration S] [--json FILE]
//
// Scenarios
//   pages        GET / and /login, round robin. No database, no session.
//   api-unauth   GET API routes with no session: the proxy, the rate limiter and
//                the route's own auth check, which answers 401 without a network
//                call. Each request carries its own x-forwarded-for, so the
//                limiter does not turn the whole run into 429s (see rate-limit).
//   rate-limit   From one address: how many requests pass before 429, and what
//                Retry-After says. Then the same burst with a different
//                x-forwarded-for on every request.
//   dashboard    The API calls one dashboard view makes, as a signed-in user.
//   monte-carlo  Concurrent Monte Carlo requests, as a signed-in user.
//
// dashboard and monte-carlo need LOADTEST_COOKIE (the Cookie header of a
// signed-in session in the target environment) and, for monte-carlo,
// LOADTEST_PORTFOLIO_ID. Use a test account on staging or a preview whose
// Supabase is not production: these scenarios read the database and run the
// simulation at the concurrency you ask for. The script refuses the production
// hostname unless LOADTEST_ALLOW_PRODUCTION=1.

import fs from 'node:fs'

const PRODUCTION_HOSTS = new Set(['project-tri0w.vercel.app'])

function parseArgs(argv) {
  const [scenario, ...rest] = argv
  const options = { scenario, base: 'http://localhost:3100', concurrency: 10, duration: 20, json: null }
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, '')
    const value = rest[i + 1]
    if (key === 'concurrency' || key === 'duration') options[key] = Number(value)
    else options[key] = value
  }
  options.base = options.base.replace(/\/$/, '')
  return options
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarise(name, samples, elapsedMs) {
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b)
  const statuses = {}
  for (const s of samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10)
  return {
    name,
    requests: samples.length,
    seconds: round(elapsedMs / 1000),
    throughputRps: round(samples.length / (elapsedMs / 1000)),
    latencyMs: {
      p50: round(percentile(latencies, 50)),
      p95: round(percentile(latencies, 95)),
      p99: round(percentile(latencies, 99)),
      max: round(latencies[latencies.length - 1] ?? null),
    },
    statuses,
  }
}

let ipCounter = 0
function syntheticIp() {
  ipCounter++
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

async function timed(url, init = {}) {
  const started = performance.now()
  try {
    const response = await fetch(url, { redirect: 'manual', ...init })
    await response.arrayBuffer()
    return { ms: performance.now() - started, status: response.status, headers: response.headers }
  } catch (error) {
    return { ms: performance.now() - started, status: `error:${error.cause?.code ?? error.name}` }
  }
}

/** Closed-model load: `concurrency` workers each sending the next request as soon as the last returns. */
async function run(name, { concurrency, duration }, nextRequest) {
  const samples = []
  const deadline = performance.now() + duration * 1000
  const started = performance.now()
  let sequence = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const { url, init } = nextRequest(sequence++)
        samples.push(await timed(url, init))
      }
    }),
  )
  return summarise(name, samples, performance.now() - started)
}

function requireSession() {
  const cookie = process.env.LOADTEST_COOKIE
  if (!cookie) {
    console.error('This scenario needs LOADTEST_COOKIE: the Cookie header of a signed-in test account.')
    process.exit(2)
  }
  return cookie
}

const DASHBOARD_CALLS = ['/api/portfolio', '/api/portfolio/history?range=30', '/api/rates', '/api/watchlist']

const scenarios = {
  async pages(options) {
    const paths = ['/', '/login']
    return run('pages', options, (i) => ({ url: options.base + paths[i % paths.length] }))
  },

  async 'api-unauth'(options) {
    const paths = ['/api/portfolio', '/api/watchlist', '/api/analytics/00000000-0000-4000-8000-000000000000/monte-carlo']
    return run('api-unauth', options, (i) => ({
      url: options.base + paths[i % paths.length],
      init: { headers: { 'x-forwarded-for': syntheticIp() } },
    }))
  },

  async 'rate-limit'(options) {
    const burst = async (label, headersFor) => {
      const results = []
      for (let i = 0; i < 80; i++) results.push(await timed(`${options.base}/api/portfolio`, { headers: headersFor(i) }))
      const first429 = results.findIndex((r) => r.status === 429)
      return {
        name: label,
        requests: results.length,
        firstRejectedAt: first429 === -1 ? null : first429 + 1,
        rejected: results.filter((r) => r.status === 429).length,
        retryAfter: first429 === -1 ? null : results[first429].headers.get('retry-after'),
      }
    }
    const fixedIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    return [
      await burst('one address', () => ({ 'x-forwarded-for': fixedIp })),
      await burst('a new x-forwarded-for per request', () => ({ 'x-forwarded-for': syntheticIp() })),
    ]
  },

  async dashboard(options) {
    const cookie = requireSession()
    return run('dashboard', options, (i) => ({
      url: options.base + DASHBOARD_CALLS[i % DASHBOARD_CALLS.length],
      init: { headers: { cookie } },
    }))
  },

  async 'monte-carlo'(options) {
    const cookie = requireSession()
    const pid = process.env.LOADTEST_PORTFOLIO_ID
    if (!pid) {
      console.error('monte-carlo needs LOADTEST_PORTFOLIO_ID.')
      process.exit(2)
    }
    // A different horizon per request defeats the 5-minute result cache, so
    // every request runs the simulation.
    return run('monte-carlo', options, (i) => ({
      url: `${options.base}/api/analytics/${pid}/monte-carlo?weeks=${4 + (i % 257)}`,
      init: { headers: { cookie } },
    }))
  },
}

const options = parseArgs(process.argv.slice(2))
if (!scenarios[options.scenario]) {
  console.error(`Scenario: ${Object.keys(scenarios).join(' | ')}`)
  process.exit(2)
}
if (PRODUCTION_HOSTS.has(new URL(options.base).hostname) && process.env.LOADTEST_ALLOW_PRODUCTION !== '1') {
  console.error('Refusing to load-test production. Point --base at a preview or local build.')
  process.exit(2)
}

const result = await scenarios[options.scenario](options)
console.log(JSON.stringify(result, null, 2))
if (options.json) fs.writeFileSync(options.json, JSON.stringify(result, null, 2))
