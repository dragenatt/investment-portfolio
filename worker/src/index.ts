/**
 * InvestTracker scheduler — a Cloudflare Worker with one job: every five
 * minutes, ask the app to evaluate the price alerts.
 *
 * Vercel's free plan runs scheduled jobs once a day, so a price alert used to
 * be checked only by the nightly job. Cloudflare's free plan runs cron
 * triggers every few minutes; this worker is that schedule and nothing else.
 * All the logic stays in the app (/api/cron/alerts → runPriceAlerts), where it
 * is tested and shares the quote cache and providers with everything else.
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

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAlerts(env))
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/health') {
      // Whether it is configured, never the secret itself.
      return Response.json({
        service: 'investtracker-scheduler',
        app: env.APP_URL,
        secretConfigured: Boolean(env.CRON_SECRET),
        schedule: 'every 5 minutes',
      })
    }
    return new Response('Not found', { status: 404 })
  },
}

async function checkAlerts(env: Env): Promise<void> {
  if (!env.CRON_SECRET) {
    console.error('CRON_SECRET is not set. Run: npx wrangler secret put CRON_SECRET')
    return
  }

  const response = await fetch(`${env.APP_URL.replace(/\/$/, '')}/api/cron/alerts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  })
  const body = (await response.text()).slice(0, 300)
  if (response.ok) console.log(`alerts ${response.status}: ${body}`)
  else console.error(`alerts ${response.status}: ${body}`)
}
