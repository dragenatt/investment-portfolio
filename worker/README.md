# InvestTracker scheduler

A Cloudflare Worker with two jobs, both on the same five-minute cron:

1. `POST /api/cron/alerts` with `Authorization: Bearer <CRON_SECRET>`, so the
   app evaluates the active price alerts. Vercel's free plan only runs scheduled
   jobs once a day; Cloudflare's free plan runs this every five minutes.
2. One GET at each of the API routes the dashboard needs first, so their
   functions do not go cold.

All the logic is in the app (`src/app/api/cron/alerts/route.ts` →
`runPriceAlerts`). This worker holds no data and no keys other than the cron
secret.

## Why the warm-up, and what it cannot do

Every route in the app is its own serverless function. An idle one is reclaimed
and the next request pays for starting it: measured against production, the
first request comes back in 1.94 s and the next two in 0.49 s. The warm-up keeps
`/api/portfolio`, `/api/portfolio/history` and `/api/market/batch` alive, which
is what the dashboard asks for before it can show a number.

The pings carry no session on purpose — they are answered 401 before any
provider is called, so they spend no market-data quota. 401 and 200 both mean
the function is up; anything else is logged as unexpected.

**A page cannot be warmed this way.** The proxy redirects a request with no
session to `/login` before the page's own function runs, so pinging `/dashboard`
would only warm the middleware. The page's start-up cost is the app's business
(see `src/lib/observability/sentry.ts`, which took 1.65 MB off it) and Vercel's
Fluid Compute setting.

## Setup

```bash
cd worker
npm install
npx wrangler login              # once, in a browser
npx wrangler secret put CRON_SECRET   # paste the same value Vercel has
npx wrangler deploy
```

## Check

- `https://price-engine.<your-subdomain>.workers.dev/health` says whether the
  secret is configured (never the secret) and which routes it warms.
- `npx wrangler tail` shows each run: `alerts 200: {"ok":true,"fired":0,…}` and
  `warm: /api/portfolio 401, …`.
- A run without the secret logs how to set it and calls no alerts route; the
  warm-up still runs, since it needs no secret.
- `npm run typecheck` here, or `npm run typecheck:worker` from the repository
  root, which is what CI runs.

## History

This folder used to hold a "price engine" that wrote quotes to columns
`company_data` does not have (every write failed) into a cache the app never
read. It was replaced by this scheduler; the worker keeps its name so a deploy
replaces the old code. Secrets the old worker had (`SUPABASE_SERVICE_ROLE_KEY`,
`TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`) are no longer used and can be removed
with `npx wrangler secret delete <NAME>`.
