# InvestTracker scheduler

A Cloudflare Worker with one job: every five minutes it calls
`POST https://project-tri0w.vercel.app/api/cron/alerts` with
`Authorization: Bearer <CRON_SECRET>`, and the app evaluates the active price
alerts. Vercel's free plan only runs scheduled jobs once a day; Cloudflare's
free plan runs this every five minutes.

All the logic is in the app (`src/app/api/cron/alerts/route.ts` →
`runPriceAlerts`). This worker holds no data and no keys other than the cron
secret.

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
  secret is configured (never the secret).
- `npx wrangler tail` shows each run: `alerts 200: {"ok":true,"fired":0,…}`.
- A run without the secret logs how to set it and calls nothing.

## History

This folder used to hold a "price engine" that wrote quotes to columns
`company_data` does not have (every write failed) into a cache the app never
read. It was replaced by this scheduler; the worker keeps its name so a deploy
replaces the old code. Secrets the old worker had (`SUPABASE_SERVICE_ROLE_KEY`,
`TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`) are no longer used and can be removed
with `npx wrangler secret delete <NAME>`.
