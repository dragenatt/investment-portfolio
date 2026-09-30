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
 * A page BEHIND the session cannot be warmed this way: the proxy redirects a
 * request without one to /login before the page's function runs, so pinging
 * /dashboard would only warm the middleware.
 *
 * The public pages are a different case, and they were being left cold. Real
 * user timings over a fortnight (web_vitals) put TTFB on the landing page at
 * 288ms median against 1,983ms at p75, and /login at 756ms against 1,531ms —
 * the split shape of a function that is fast when it is up and slow when it is
 * not, on pages that do no session work at all. A third of all page views were
 * waiting more than two seconds for the first byte. Those two pages are also
 * exactly what someone meets when they open the app, which is where the delay
 * was reported.
 *
 * Nothing static is served here to absorb this: the root layout reads the CSP
 * nonce off the request, which makes every route in the app render on demand,
 * so there is no prerendered HTML on a CDN anywhere. Until that changes these
 * pings are what stands between a visitor and a cold start.
 */
const WARM_PATHS = [
  '/api/portfolio',
  '/api/portfolio/history?range=30',
  '/api/market/batch?symbols=AAPL',
  // Public pages: these run the renderer through to the end.
  '/',
  '/login',
]

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
 * What an HTTP header value may contain, once its ends are trimmed: printable
 * ASCII, space included. A space inside the value is legal — a passphrase sends
 * fine — so refusing one would refuse a working secret. Anything outside this
 * range makes the request itself malformed, and the rejection then comes from
 * whatever sits in front of the app, with a status that has nothing to do with
 * the secret being wrong.
 */
const HEADER_SAFE = /^[ -~]+$/

async function checkAlerts(env: Env): Promise<void> {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET is not set. Run: npx wrangler secret put CRON_SECRET')
    return
  }

  // Whitespace at either end is trimmed rather than refused. A secret pasted
  // into a terminal on Windows keeps the carriage return of the copied line —
  // the newline acts as Enter and the carriage return stays glued to the value — and the result
  // is a request that HTTP itself calls malformed, which the platform in front
  // of the app rejects with a status that says nothing about secrets. Nothing
  // is lost by trimming: a value with an end space could never be sent as a
  // header at all. It is said out loud, because the stored value is still wrong.
  const secret = env.CRON_SECRET.trim()
  if (secret !== env.CRON_SECRET) {
    console.warn(
      'CRON_SECRET has whitespace at one end and was trimmed for this call. ' +
        'Store it cleanly when convenient: the Cloudflare dashboard is a form field, ' +
        'which cannot pick up the line break a terminal paste does.',
    )
  }
  if (!HEADER_SAFE.test(secret)) {
    // Which characters, never where or how many. A code point names the thing
    // to delete — U+200B is a zero-width space and U+00A0 a non-breaking one,
    // both of which a copy taken from a web page carries invisibly — and says
    // nothing about the secret itself.
    const offenders = [...new Set([...secret].filter((c) => c < ' ' || c > '~'))]
      .map((c) => 'U+' + (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'))
      .join(', ')
    console.error(
      `CRON_SECRET contains ${offenders}, which cannot travel in an HTTP header. ` +
        'A copy taken from a web page carries those invisibly, so pasting it again ' +
        'will not help: type the value by hand into npx wrangler secret put CRON_SECRET',
    )
    return
  }

  const response = await fetch(appUrl(env, '/api/cron/alerts'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
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
