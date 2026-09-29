/**
 * InvestTracker scheduler — a Cloudflare Worker with two jobs, both every five
 * minutes: ask the app to evaluate the price alerts, and keep the functions the
 * dashboard depends on from going cold.
 *
 * Vercel's free plan runs scheduled jobs once a day, so a price alert used to
 * be checked only by the nightly job. Cloudflare's free plan runs cron triggers
 * every few minutes; this worker is that schedule and nothing else. All the
 * logic stays in the app (/api/cron/alerts → runPriceAlerts), where it is
 * tested and shares the quote cache and providers with everything else.
 *
 * It replaces the "price engine" that lived here: it wrote prices to columns
 * company_data does not have, so every write failed, and the app never read
 * its cache. Same worker name, so a deploy replaces that code.
 *
 * Configuration:
 *   APP_URL      [vars] in wrangler.toml — the app's public URL.
 *   CRON_SECRET  a secret, the same value as CRON_SECRET in Vercel:
 *                `npx wrangler secret put CRON_SECRET`
 */

export interface Env {
  APP_URL: string
  CRON_SECRET?: string
}

/**
 * The routes kept warm, and why these.
 *
 * Each route in the app is its own serverless function. An idle one is
 * reclaimed, and the next request pays for starting it: production answers its
 * first request in 1.94 s and the next two in 0.49 s. The dashboard needs these
 * three before it can show a number, so they are the ones worth keeping alive.
 *
 * They answer 401 without a session, which is the point: the answer is
 * irrelevant, the function starting is what matters. No provider is called and
 * no quota is spent, because the auth check comes first.
 *
 * A page cannot be warmed this way. The proxy redirects a request with no
 * session to /login before the page's function runs, so pinging /dashboard
 * would only warm the middleware. What the page's own start-up costs is a
 * matter for the app's own code — see lib/observability/sentry.ts — and for
 * Vercel's Fluid Compute setting.
 */
const WARM_PATHS = ['/api/portfolio', '/api/portfolio/history?range=30', '/api/market/batch?symbols=AAPL']

/** A ping is worth no more than this; the alerts run must not wait on it. */
const WARM_TIMEOUT_MS = 8000

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAlerts(env))
    ctx.waitUntil(keepWarm(env))
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/health') {
      // Whether it is configured, never the secret itself.
      return Response.json({
        service: 'investtracker-scheduler',
        app: env.APP_URL,
        secretConfigured: Boolean(env.CRON_SECRET),
        schedule: 'every 5 minutes',
        warms: WARM_PATHS,
      })
    }
    return new Response('Not found', { status: 404 })
  },
}

function appUrl(env: Env, path: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}${path}`
}

/**
 * What an HTTP header value may contain: visible ASCII, no spaces at either end.
 * A secret pasted with a trailing newline, a tab or a smart quote makes the
 * request itself malformed, and the rejection then comes from whatever sits in
 * front of the app — with a status that has nothing to do with the secret being
 * wrong.
 */
const HEADER_SAFE = /^[!-~]+$/

async function checkAlerts(env: Env): Promise<void> {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET is not set. Run: npx wrangler secret put CRON_SECRET')
    return
  }
  if (!HEADER_SAFE.test(env.CRON_SECRET)) {
    // Never the value: only that it cannot be sent as written.
    console.error(
      'CRON_SECRET contains characters that cannot go in an HTTP header ' +
        '(whitespace at either end, a newline, or something outside visible ASCII). ' +
        'Set it again with: npx wrangler secret put CRON_SECRET',
    )
    return
  }

  const response = await fetch(appUrl(env, '/api/cron/alerts'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  })
  const body = (await response.text()).slice(0, 300)
  if (response.ok) {
    console.log(`alerts ${response.status}: ${body}`)
    return
  }
  // Which layer refused it. A 401 is the app saying the secret is wrong; a 400
  // with an x-vercel-error is the platform saying the request never got that
  // far, and the two need opposite fixes.
  const from = ['x-vercel-error', 'x-vercel-id', 'content-type']
    .map((header) => `${header}=${response.headers.get(header) ?? '-'}`)
    .join(' ')
  console.error(`alerts ${response.status} [${from}]: ${body}`)
}

/**
 * One request per route, in parallel, on purpose without the cron secret: these
 * are meant to be refused. 401 or 200 both mean the function is up; anything
 * else is worth a line in `wrangler tail`, and a failure here is never worth
 * failing the run over.
 */
async function keepWarm(env: Env): Promise<void> {
  const results = await Promise.all(
    WARM_PATHS.map(async (path) => {
      try {
        const response = await fetch(appUrl(env, path), {
          method: 'GET',
          signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
        })
        return { path, status: String(response.status) }
      } catch (err) {
        return { path, status: err instanceof Error ? err.name : 'failed' }
      }
    }),
  )

  const unexpected = results.filter((r) => r.status !== '401' && r.status !== '200')
  const summary = results.map((r) => `${r.path} ${r.status}`).join(', ')
  if (unexpected.length > 0) console.error(`warm: ${summary}`)
  else console.log(`warm: ${summary}`)
}
