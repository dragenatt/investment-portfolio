# Q2 2026 — Phase 1: Foundation & Worker Expansion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land cross-stack observability (Sentry + PostHog), expand the Cloudflare Worker with 4 background crons that feed Phase 2 (factor analysis) and Phase 3 (alerts), and ship the closing vertical slice — `/admin/metrics` dashboard, cookie consent banner, Realtime price push, and a Playwright smoke harness.

**Architecture:** Foundation-first: instrumentation lands before any heavy logic so Phases 2/3 can be debugged from day one. Schema for Phase 3's classifier columns ships in this phase (Migration 008) so Phase 3 has data to write into and ~4 weeks of news history to validate against. Cookie banner is consent‑gated for PostHog only — Sentry loads under legitimate-interest. Realtime is a kill-switchable enhancement on top of existing SWR polling.

**Tech Stack:** Next.js 16.2 (App Router, React 19.2 + React Compiler), TypeScript, Supabase (Postgres + Auth + RLS + Realtime broadcast), Upstash Redis, Cloudflare Worker (existing `price-engine`), Sentry (`@sentry/nextjs`, `@sentry/cloudflare`), PostHog (`posthog-js`, `posthog-node`), Playwright (chromium-only), Vitest. NOTE: Next.js 16 renames `middleware.ts` → `proxy.ts`. Always read `node_modules/next/dist/docs/` before writing Next.js framework code (per `AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-04-20-investtracker-q2-roadmap-design.md` — Section 2 (Phase 1), Section 5.1 (data model), Section 5.2 (security), Section 5.3 (testing), Section 5.4 (CI/CD), Appendix A (file structure), Appendix B (env vars).

---

## File Structure

### New files

```
sentry.client.config.ts                       — Sentry browser init (10% trace, beforeSend filter)
sentry.server.config.ts                       — Sentry node init
sentry.edge.config.ts                         — Sentry edge runtime init
instrumentation.ts                            — Next.js 16 instrumentation hook (Sentry boot)

playwright.config.ts                          — Chromium-only project, baseURL, trace on retry

src/components/consent/CookieBanner.tsx       — Cookie consent UI (gates PostHog only)
src/providers/posthog-provider.tsx            — PostHog client init (deferred until consent)
src/lib/cache/with-metrics.ts                 — cacheGetWithMetrics wrapper, emits PostHog event
src/lib/hooks/useRealtimePrices.ts            — Supabase Realtime subscriber for prices channel
src/lib/posthog/server.ts                     — posthog-node singleton (server-side captures)

src/app/(app)/admin/metrics/page.tsx          — Internal metrics dashboard (server component)
src/app/api/admin/metrics/route.ts            — Aggregator: PostHog + Sentry + Cloudflare APIs

supabase/migrations/008_worker_expansion.sql  — company_profile, dividend_calendar, earnings_calendar, news_items + RLS

worker/src/sectors-cron.ts                    — Twelve Data /profile per held symbol → company_profile
worker/src/dividends-cron.ts                  — Finnhub /calendar/dividend (90d) → dividend_calendar
worker/src/earnings-cron.ts                   — Finnhub /calendar/earnings (4w) → earnings_calendar
worker/src/news-ingestion.ts                  — Finnhub /company-news (24h, top 50 symbols) → news_items
worker/src/realtime-publish.ts                — POST to Supabase Realtime broadcast REST after price upserts

tests/e2e/smoke.spec.ts                       — Phase 1 smoke: login → dashboard → no console / Sentry errors
src/lib/cache/__tests__/with-metrics.test.ts  — Vitest unit for cacheGetWithMetrics
src/lib/hooks/__tests__/useRealtimePrices.test.ts — Vitest+RTL: subscribe, fallback, kill switch
worker/src/__tests__/sectors-cron.test.ts     — Vitest+miniflare: hold-symbol enumeration, upsert
worker/src/__tests__/news-ingestion.test.ts   — Vitest+miniflare: dedupe by url, batch, classified_at NULL

docs/runbooks/sentry.md                       — Quotas, beforeSend, source maps, on-call triage
docs/runbooks/posthog.md                      — Cookie banner contract, flags, dashboards
docs/runbooks/cache-monitoring.md             — Hit-ratio dashboard, alert thresholds
docs/runbooks/health-checks.md                — Per-service status check matrix (R3 mitigation)
docs/runbooks/secret-rotation.md              — Initial template (per Section 5.2)
```

### Modified files

```
package.json                                  — Add Sentry / PostHog / Playwright deps + scripts
.env.local.example                            — Document Phase 1 env vars (Appendix B)
.gitignore                                    — Add playwright-report/, test-results/, .sentryclirc
next.config.ts                                — Wrap export with withSentryConfig (source maps)

src/lib/api/handler.ts                        — Add Sentry.setUser + Sentry.addBreadcrumb at entry
src/lib/cache/redis.ts                        — Re-export with-metrics wrapper from index
src/lib/cache/index.ts                        — Surface cacheGetWithMetrics
src/app/layout.tsx                            — Mount PostHogProvider + CookieBanner
src/app/(app)/layout.tsx                      — (if needed) wire useRealtimePrices for portfolio pages

worker/src/index.ts                           — Register 4 new cron handlers + Sentry init
worker/wrangler.toml                          — Add new cron entries; document new env bindings
worker/package.json                           — Add @sentry/cloudflare devDep + new wrangler bindings

.github/workflows/ci.yml                      — Add Playwright smoke job (PR) + nightly E2E (cron)
```

---

## Chunk 1: Migration 008 — Worker expansion schema

This chunk lands the database surface that Worker crons will populate. All four tables ship with RLS enabled and explicit SELECT policies for authenticated users; INSERT/UPDATE/DELETE happens only via service role (Worker). The `news_items` table also ships every Phase 3 classifier column as nullable so the Phase 3 classifier needs no follow-up DDL.

### Task 1.1: Write Migration 008

**Files:**
- Create: `supabase/migrations/008_worker_expansion.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 008_worker_expansion.sql
-- Phase 1: tables for sectors, dividends, earnings, news.
-- Spec: docs/superpowers/specs/2026-04-20-investtracker-q2-roadmap-design.md §2.4

-- ═══════════════════════════════════════════════════════════════════
-- company_profile — sector/industry/market cap per held symbol
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE company_profile (
  symbol TEXT PRIMARY KEY,
  sector TEXT,
  industry TEXT,
  market_cap NUMERIC,
  country TEXT,
  exchange TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- dividend_calendar — next 90 days, refreshed every 4h
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE dividend_calendar (
  symbol TEXT,
  ex_date DATE,
  pay_date DATE,
  amount NUMERIC,
  currency TEXT,
  PRIMARY KEY (symbol, ex_date)
);

-- ═══════════════════════════════════════════════════════════════════
-- earnings_calendar — next 4 weeks, refreshed daily 9 AM ET
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE earnings_calendar (
  symbol TEXT,
  earnings_date DATE,
  hour TEXT,                -- 'bmo' (before market open) | 'amc' (after market close)
  eps_estimate NUMERIC,
  revenue_estimate NUMERIC,
  PRIMARY KEY (symbol, earnings_date)
);

-- ═══════════════════════════════════════════════════════════════════
-- news_items — last 24h, top 50 symbols by portfolio volume.
-- The Phase 3 classifier columns ship here as nullable so the Phase 3
-- classifier ships without an additional migration.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  url TEXT UNIQUE,
  source TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  -- Phase 3 (classifier) populates these. Schema lives here.
  impact_score INT,
  impact_label TEXT,                         -- 'positive' | 'negative' | 'neutral'
  relevance TEXT,                            -- 'high' | 'medium' | 'low'
  topics TEXT[],
  summary_es TEXT,
  action_hint TEXT,
  classified_at TIMESTAMPTZ
);

CREATE INDEX idx_news_symbol_published ON news_items(symbol, published_at DESC);
CREATE INDEX idx_news_unclassified ON news_items(symbol) WHERE classified_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- RLS: market data tables are readable by all authenticated users;
-- writes only via service role (Worker). Same pattern as migration 006.
-- NOTE: ENABLE is required — without it, "no policy" means "open to all".
-- The runbook docs/runbooks/secret-rotation.md includes a check that
-- all four tables still have RLS enabled.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE company_profile     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_calendar   ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_calendar   ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_data_read" ON company_profile     FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON dividend_calendar   FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON earnings_calendar   FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON news_items          FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE: service role only (no policies — service role bypasses RLS).
```

- [ ] **Step 2: Verify file matches spec exactly**

Run a diff against the spec snippet:

```bash
sed -n '184,254p' docs/superpowers/specs/2026-04-20-investtracker-q2-roadmap-design.md \
  | diff - <(sed -n '/^CREATE TABLE company_profile/,/service role only/p' supabase/migrations/008_worker_expansion.sql)
```

Expected: differences are only formatting / comment headers — no semantic deltas in DDL or RLS.

- [ ] **Step 3: Apply migration to local Supabase**

```bash
supabase db reset      # if local-only; resets dev DB and re-applies all migrations in order
# OR for additive only:
supabase db push       # applies pending migrations to linked project
```

Expected: `008_worker_expansion.sql ... done` (or equivalent). No errors.

- [ ] **Step 4: Verify RLS is enabled on all 4 tables**

```bash
supabase db query "
  SELECT relname, relrowsecurity
  FROM pg_class
  WHERE relname IN ('company_profile','dividend_calendar','earnings_calendar','news_items')
  ORDER BY relname;
"
```

Expected: all 4 rows show `relrowsecurity = true`.

- [ ] **Step 5: Verify SELECT policy exists on all 4 tables**

```bash
supabase db query "
  SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE tablename IN ('company_profile','dividend_calendar','earnings_calendar','news_items')
  ORDER BY tablename;
"
```

Expected: 4 rows, all with `policyname = market_data_read` and `cmd = SELECT`.

- [ ] **Step 6: Verify partial index `idx_news_unclassified` exists**

```bash
supabase db query "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'news_items'
  ORDER BY indexname;
"
```

Expected: row for `idx_news_unclassified` with `WHERE (classified_at IS NULL)` in `indexdef`.

- [ ] **Step 7: Generate TypeScript types from updated schema**

```bash
supabase gen types typescript --linked > src/lib/supabase/database.types.ts
# OR if using local: supabase gen types typescript --local > ...
```

Expected: file diff shows new entries `company_profile`, `dividend_calendar`, `earnings_calendar`, `news_items` under `Database['public']['Tables']`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/008_worker_expansion.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): migration 008 — worker expansion (sectors, dividends, earnings, news)

Adds 4 market-data tables with RLS enabled and SELECT-for-authenticated
policies. news_items ships Phase 3 classifier columns as nullable so the
classifier can land without a follow-up migration. See spec §2.4 / §5.1."
```

---

## Chunk 2: Sentry — Next.js + Worker

This chunk wires error/perf tracking on both the Next.js app and the Cloudflare Worker. Single Sentry org, four environments: `production`, `preview`, `worker-prod`, `worker-dev`. 10% trace sample in production, 100% for errors. `beforeSend` filters known noise (e.g., SWR `AbortError` on navigation). Source maps upload at build time.

> **Pre-flight (Next.js 16 specifics):** Read `node_modules/next/dist/docs/instrumentation.md` and `node_modules/next/dist/docs/api-reference/config/next-config-js/instrumentation-client.md` (or `instrumentation.md` if the client variant doesn't exist) before touching `instrumentation.ts` or `next.config.ts`. `@sentry/nextjs` 8.x supports App Router via `instrumentation.ts`; do NOT use the legacy `_app.tsx` / `getInitialProps` integration patterns.

### Task 2.1: Add Sentry env vars to local + example

**Files:**
- Modify: `.env.local.example`
- Modify: `.env.local` (developer-local, gitignored — populate from Sentry org `Settings → Auth Tokens`)

- [ ] **Step 1: Append Sentry block to `.env.local.example`**

```bash
cat >> .env.local.example <<'EOF'

# ── Phase 1 — Sentry ─────────────────────────────────────────────────
# Browser/edge runtime DSN (public, NEXT_PUBLIC_*)
NEXT_PUBLIC_SENTRY_DSN=
# Node server runtime DSN (private — keep server-only). Typically the
# same DSN as NEXT_PUBLIC_SENTRY_DSN; separated so paths can diverge.
SENTRY_DSN=
# Build-time only: source map upload. NEVER expose.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
EOF
```

- [ ] **Step 2: Verify the block appended without overwriting**

```bash
grep -c "^SENTRY_AUTH_TOKEN=" .env.local.example
```

Expected: `1`.

- [ ] **Step 3: Commit env example**

```bash
git add .env.local.example
git commit -m "chore(env): document Sentry env vars (Phase 1)"
```

### Task 2.2: Install @sentry/nextjs and run wizard

**Files:**
- Modify: `package.json`
- Create: `sentry.client.config.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Create: `instrumentation.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Read Next.js 16 instrumentation docs**

```bash
ls node_modules/next/dist/docs/ | grep -i instrumentation
# Then read whichever instrumentation*.md files exist:
cat node_modules/next/dist/docs/instrumentation.md 2>/dev/null \
  || cat node_modules/next/dist/docs/api-reference/file-conventions/instrumentation.md
```

Expected: confirm whether the file is `instrumentation.ts` at repo root or under `src/`. The wizard places it at the project root for App Router projects.

- [ ] **Step 2: Run the Sentry wizard (non-interactive)**

```bash
npx @sentry/wizard@latest -i nextjs --skip-connect --signup
```

Expected: wizard prompts for org / project / DSN. Choose existing org or create `investtracker`. Select Next.js App Router. The wizard creates `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`, and wraps `next.config.ts` with `withSentryConfig`. It also adds `@sentry/nextjs` to `package.json`.

> If wizard refuses to run non-interactively in this environment, install manually:
> ```bash
> pnpm add @sentry/nextjs
> ```
> then hand-author the four config files using the templates in steps 3–6 below.

- [ ] **Step 3: Replace `sentry.client.config.ts` content**

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || 'development',
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,        // session replay is opt-in via PostHog (Phase 1.4)
  replaysOnErrorSampleRate: 0,
  beforeSend(event, hint) {
    const err = hint.originalException
    // SWR aborts on route change — not actionable.
    if (err instanceof Error && err.name === 'AbortError') return null
    // Browser extensions injecting noise.
    if (event.exception?.values?.[0]?.stacktrace?.frames?.some(f =>
      f.filename?.includes('extension://'))) return null
    return event
  },
})
```

- [ ] **Step 4: Replace `sentry.server.config.ts` content**

```typescript
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || 'development',
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event, hint) {
    const err = hint.originalException
    // Supabase RLS denials are expected for some endpoints; tag but don't drop.
    if (err instanceof Error && /row-level security/i.test(err.message)) {
      event.tags = { ...event.tags, kind: 'rls_denied' }
    }
    return event
  },
})
```

- [ ] **Step 5: Replace `sentry.edge.config.ts` content**

```typescript
// sentry.edge.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || 'development',
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.1 : 1.0,
})
```

- [ ] **Step 6: Verify `instrumentation.ts` was created at repo root**

```bash
test -f instrumentation.ts && echo "OK" || echo "MISSING"
cat instrumentation.ts
```

Expected: file exists; content imports the appropriate runtime config based on `process.env.NEXT_RUNTIME` (`'nodejs'` → `sentry.server.config`, `'edge'` → `sentry.edge.config`). If wizard didn't generate it, write:

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export { onRequestError } from '@sentry/nextjs'
```

- [ ] **Step 7: Verify `next.config.ts` is wrapped with `withSentryConfig`**

```bash
grep -n "withSentryConfig" next.config.ts
```

Expected: at least one match. If missing, edit `next.config.ts` to wrap the export:

```typescript
import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // ... existing config
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
})
```

- [ ] **Step 8: Add `.sentryclirc` to `.gitignore`**

```bash
grep -q "^\.sentryclirc$" .gitignore || echo ".sentryclirc" >> .gitignore
```

- [ ] **Step 9: Build to verify Sentry plugin doesn't break Next.js 16 build**

```bash
pnpm build
```

Expected: `✓ Compiled successfully`. Sentry plugin should report `Skipping source map upload because SENTRY_AUTH_TOKEN is not set` (acceptable for first local build).

- [ ] **Step 10: Commit Sentry Next.js setup**

```bash
git add package.json pnpm-lock.yaml sentry.*.config.ts instrumentation.ts next.config.ts .gitignore
git commit -m "feat(observability): add Sentry to Next.js (client/server/edge + instrumentation)

Wires @sentry/nextjs with App Router instrumentation hook. 10% trace
sample in production, 100% errors. beforeSend filters AbortError from
SWR navigation and browser-extension noise. See spec §2.1, runbook
sentry.md (Task 9.1). Source maps upload requires SENTRY_AUTH_TOKEN
in CI/Vercel — added in deploy task."
```

### Task 2.3: Add Sentry user context + breadcrumbs to API handler

**Files:**
- Modify: `src/lib/api/handler.ts`
- Test: `src/lib/api/__tests__/handler.test.ts`

- [ ] **Step 1: Write failing test for Sentry.setUser on authenticated requests**

```typescript
// src/lib/api/__tests__/handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'
import { apiHandler } from '../handler'

vi.mock('@sentry/nextjs', () => ({
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}))

describe('apiHandler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets Sentry user from x-user-id header when present', async () => {
    const handler = apiHandler(async () => new Response('ok'))
    const req = new Request('http://localhost/api/x', {
      headers: { 'x-user-id': 'u-123' },
    })
    await handler(req)
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'u-123' })
  })

  it('clears Sentry user when no x-user-id header', async () => {
    const handler = apiHandler(async () => new Response('ok'))
    await handler(new Request('http://localhost/api/x'))
    expect(Sentry.setUser).toHaveBeenCalledWith(null)
  })

  it('adds breadcrumb at entry', async () => {
    const handler = apiHandler(async () => new Response('ok'))
    await handler(new Request('http://localhost/api/x'))
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'api', type: 'http' })
    )
  })

  it('reports caught exceptions to Sentry', async () => {
    const handler = apiHandler(async () => { throw new Error('boom') })
    const res = await handler(new Request('http://localhost/api/x'))
    expect(Sentry.captureException).toHaveBeenCalled()
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test src/lib/api/__tests__/handler.test.ts
```

Expected: 4 failures — `Sentry.setUser` / `addBreadcrumb` / `captureException` not called.

- [ ] **Step 3: Update `src/lib/api/handler.ts` to integrate Sentry**

```typescript
import * as Sentry from '@sentry/nextjs'
import { error } from '@/lib/api/response'

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>

export function apiHandler(handler: RouteHandler): RouteHandler {
  return async (req: Request, ctx?: unknown) => {
    const url = new URL(req.url)
    const userId = req.headers.get('x-user-id')
    Sentry.setUser(userId ? { id: userId } : null)
    Sentry.addBreadcrumb({
      category: 'api',
      type: 'http',
      message: `${req.method} ${url.pathname}`,
      data: { method: req.method, path: url.pathname },
    })

    try {
      return await handler(req, ctx)
    } catch (err) {
      Sentry.captureException(err)
      console.error(`[API ${req.method} ${url.pathname}]`, err)
      const message =
        err instanceof Error ? err.message : 'Error interno del servidor'
      return error(message, 500)
    }
  }
}
```

> **Note on `x-user-id`:** the existing handler does not propagate user identity. If callers don't set this header, Step 4's tests still pass (we test the handler in isolation). Wiring real auth → header propagation lives in a follow-up service-layer task; see "Future hardening" in `docs/runbooks/sentry.md`.

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test src/lib/api/__tests__/handler.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit handler integration**

```bash
git add src/lib/api/handler.ts src/lib/api/__tests__/handler.test.ts
git commit -m "feat(api): wire Sentry user/breadcrumbs/captureException in apiHandler

Centralises observability per spec §5.7 item 6 (Sentry breadcrumb)."
```

### Task 2.4: Add Sentry to Cloudflare Worker

**Files:**
- Modify: `worker/package.json`
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Add `@sentry/cloudflare` to worker package**

```bash
cd worker && pnpm add @sentry/cloudflare && cd ..
```

- [ ] **Step 2: Add `SENTRY_DSN` and `ENVIRONMENT` to `worker/wrangler.toml`**

Edit the `[vars]` block and `[env.production].vars` block (create if absent):

```toml
[vars]
SUPABASE_URL = "https://mabmqxztvakaijtrncyl.supabase.co"
ENVIRONMENT = "worker-dev"

[env.production.vars]
ENVIRONMENT = "worker-prod"

# Secrets (set via wrangler secret put):
# SENTRY_DSN - Sentry DSN for the price-engine worker
# SUPABASE_SERVICE_ROLE_KEY - Supabase service role key for database access
# TWELVE_DATA_API_KEY - Twelve Data API key (primary price source)
# FINNHUB_API_KEY - Finnhub API key (fallback price source)
```

- [ ] **Step 3: Wrap Worker entrypoints with Sentry**

Edit `worker/src/index.ts` — extend `Env` type and wrap `default export`:

```typescript
import { withSentry } from '@sentry/cloudflare'
import { createClient } from '@supabase/supabase-js'

export interface Env {
  PRICE_CACHE: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  TWELVE_DATA_API_KEY: string
  FINNHUB_API_KEY: string
  SENTRY_DSN: string
  ENVIRONMENT: string
}

// ... existing handler functions unchanged ...

const handler: ExportedHandler<Env> = {
  async scheduled(event, env, ctx) {
    // existing scheduled logic — unchanged
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    switch (event.cron) {
      case '*/5 * * * *':
        ctx.waitUntil(fetchHotPrices(supabase, env)); break
      case '*/30 * * * *':
        ctx.waitUntil(fetchWarmPrices(supabase, env)); break
      case '0 */12 * * *':
        ctx.waitUntil(buildDailyHistory(supabase, env)); break
      // New crons (Task 5.x) wired here.
    }
  },
  async fetch(request, env) {
    // existing fetch handler — unchanged
    return await routeRequest(request, env)
  },
}

export default withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    tracesSampleRate: env.ENVIRONMENT === 'worker-prod' ? 0.1 : 1.0,
  }),
  handler
)
```

> Existing `routeRequest` extraction may not be present — if the existing file inlines path matching inside `fetch`, leave it inline; the wrapping in `withSentry` is what matters. Do NOT refactor handler logic in this step.

- [ ] **Step 4: Push the Sentry secret to dev + prod environments**

```bash
cd worker
echo "$SENTRY_DSN_FOR_WORKER" | wrangler secret put SENTRY_DSN
echo "$SENTRY_DSN_FOR_WORKER" | wrangler secret put SENTRY_DSN --env production
cd ..
```

> If running outside a CI environment with secrets, document this step in `docs/runbooks/sentry.md` instead and skip locally.

- [ ] **Step 5: Deploy to dev and trigger a test error**

```bash
cd worker && wrangler deploy && curl -i "https://price-engine.<workers-subdomain>.workers.dev/health" && cd ..
```

Expected: 200 OK from `/health`. Then verify in Sentry → `worker-dev` env shows the worker as connected (zero errors expected, presence is the proof).

- [ ] **Step 6: Commit worker Sentry integration**

```bash
git add worker/package.json worker/pnpm-lock.yaml worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): integrate @sentry/cloudflare in price-engine

Wraps fetch + scheduled with withSentry; environment tag distinguishes
worker-dev / worker-prod. Trace sample 10% in prod, 100% in dev. See
spec §2.1."
```

---

## Chunk 3: Cookie Consent Banner + PostHog

PostHog is the analytics + flags + replay backbone for Phases 2/3 rollout. Per spec §2.2, **PostHog must NOT initialize until the user accepts the cookie banner**. Sentry stays loaded — error tracking is legitimate-interest, not analytics.

> **Order matters.** Do not invert. Cookie banner ships first; PostHog provider gates init on `localStorage.consent_v1 === 'accepted'`.

### Task 3.1: Cookie consent banner component

**Files:**
- Create: `src/components/consent/CookieBanner.tsx`
- Create: `src/lib/consent/index.ts`
- Test: `src/lib/consent/__tests__/index.test.ts`
- Test: `src/components/consent/__tests__/CookieBanner.test.tsx`

- [ ] **Step 1: Write failing test for consent helper**

```typescript
// src/lib/consent/__tests__/index.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getConsent, setConsent, hasAccepted, CONSENT_KEY } from '../index'

describe('consent helper', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when no consent recorded', () => {
    expect(getConsent()).toBeNull()
  })

  it('persists accepted', () => {
    setConsent('accepted')
    expect(localStorage.getItem(CONSENT_KEY)).toBe('accepted')
    expect(hasAccepted()).toBe(true)
  })

  it('persists declined', () => {
    setConsent('declined')
    expect(hasAccepted()).toBe(false)
  })

  it('throws on invalid value', () => {
    // @ts-expect-error testing runtime guard
    expect(() => setConsent('lolwut')).toThrow()
  })
})
```

- [ ] **Step 2: Run test, expect import failure**

```bash
pnpm test src/lib/consent/__tests__/index.test.ts
```

Expected: `Cannot find module '../index'`.

- [ ] **Step 3: Implement consent helper**

```typescript
// src/lib/consent/index.ts
export const CONSENT_KEY = 'consent_v1'
export type ConsentValue = 'accepted' | 'declined'

const VALID: ConsentValue[] = ['accepted', 'declined']

export function getConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null
  const v = window.localStorage.getItem(CONSENT_KEY)
  return v === 'accepted' || v === 'declined' ? v : null
}

export function setConsent(v: ConsentValue): void {
  if (!VALID.includes(v)) throw new Error(`Invalid consent value: ${v}`)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONSENT_KEY, v)
    // Notify same-tab listeners; storage event only fires cross-tab.
    window.dispatchEvent(new CustomEvent('consent:change', { detail: v }))
  }
}

export function hasAccepted(): boolean {
  return getConsent() === 'accepted'
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test src/lib/consent/__tests__/index.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Write failing test for `CookieBanner`**

```tsx
// src/components/consent/__tests__/CookieBanner.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CookieBanner } from '../CookieBanner'
import { CONSENT_KEY } from '@/lib/consent'

describe('CookieBanner', () => {
  beforeEach(() => localStorage.clear())

  it('renders when no consent recorded', () => {
    render(<CookieBanner />)
    expect(screen.getByRole('region', { name: /cookies/i })).toBeInTheDocument()
  })

  it('hides when consent already accepted', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted')
    render(<CookieBanner />)
    expect(screen.queryByRole('region', { name: /cookies/i })).toBeNull()
  })

  it('hides when consent already declined', () => {
    localStorage.setItem(CONSENT_KEY, 'declined')
    render(<CookieBanner />)
    expect(screen.queryByRole('region', { name: /cookies/i })).toBeNull()
  })

  it('persists "accepted" on Accept click and dispatches consent:change', () => {
    const spy = vi.fn()
    window.addEventListener('consent:change', spy)
    render(<CookieBanner />)
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }))
    expect(localStorage.getItem(CONSENT_KEY)).toBe('accepted')
    expect(spy).toHaveBeenCalled()
    window.removeEventListener('consent:change', spy)
  })

  it('persists "declined" on Decline click', () => {
    render(<CookieBanner />)
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }))
    expect(localStorage.getItem(CONSENT_KEY)).toBe('declined')
  })
})
```

- [ ] **Step 6: Run test, expect failure**

```bash
pnpm test src/components/consent/__tests__/CookieBanner.test.tsx
```

Expected: `Cannot find module '../CookieBanner'`.

- [ ] **Step 7: Implement `CookieBanner`**

```tsx
// src/components/consent/CookieBanner.tsx
'use client'

import { useEffect, useState } from 'react'
import { getConsent, setConsent } from '@/lib/consent'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(getConsent() === null)
  }, [])

  if (!visible) return null

  const choose = (v: 'accepted' | 'declined') => {
    setConsent(v)
    setVisible(false)
  }

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg sm:flex sm:items-center sm:justify-between sm:gap-4"
    >
      <p className="text-sm">
        Usamos cookies para mejorar tu experiencia y entender cómo se usa la app.
        Sentry (errores) se carga siempre por interés legítimo. Acepta para activar
        analytics y session replay.
      </p>
      <div className="mt-3 flex gap-2 sm:mt-0">
        <button
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={() => choose('declined')}
        >
          Rechazar
        </button>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          onClick={() => choose('accepted')}
        >
          Aceptar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run test, expect pass**

```bash
pnpm test src/components/consent/__tests__/CookieBanner.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 9: Commit cookie banner**

```bash
git add src/lib/consent src/components/consent
git commit -m "feat(consent): add CookieBanner + consent_v1 localStorage helper

Banner shown when no consent recorded; persists accepted|declined.
Dispatches consent:change for same-tab listeners (PostHogProvider in
next commit). Sentry NOT gated by this banner per spec §2.2."
```

### Task 3.2: PostHog provider gated by consent

**Files:**
- Modify: `package.json`
- Modify: `.env.local.example`
- Create: `src/providers/posthog-provider.tsx`
- Create: `src/lib/posthog/server.ts`
- Test: `src/providers/__tests__/posthog-provider.test.tsx`

- [ ] **Step 1: Install PostHog libraries**

```bash
pnpm add posthog-js posthog-node
```

- [ ] **Step 2: Append PostHog block to `.env.local.example`**

```bash
cat >> .env.local.example <<'EOF'

# ── Phase 1 — PostHog ────────────────────────────────────────────────
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
EOF
```

- [ ] **Step 3: Write failing test — provider does NOT init when consent is null**

```tsx
// src/providers/__tests__/posthog-provider.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { PostHogProvider } from '../posthog-provider'
import { setConsent } from '@/lib/consent'

const mockInit = vi.fn()
const mockCapture = vi.fn()
vi.mock('posthog-js', () => ({
  default: { init: (...a: unknown[]) => mockInit(...a), capture: (...a: unknown[]) => mockCapture(...a) },
}))

beforeEach(() => {
  localStorage.clear()
  mockInit.mockClear()
  mockCapture.mockClear()
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'
  process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://us.i.posthog.com'
})

describe('PostHogProvider', () => {
  it('does not init when no consent recorded', () => {
    render(<PostHogProvider><div>x</div></PostHogProvider>)
    expect(mockInit).not.toHaveBeenCalled()
  })

  it('does not init when consent is declined', () => {
    setConsent('declined')
    render(<PostHogProvider><div>x</div></PostHogProvider>)
    expect(mockInit).not.toHaveBeenCalled()
  })

  it('inits when consent is accepted before mount', () => {
    setConsent('accepted')
    render(<PostHogProvider><div>x</div></PostHogProvider>)
    expect(mockInit).toHaveBeenCalledWith('phc_test', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
    }))
  })

  it('inits on consent:change event after initial render with no consent', () => {
    render(<PostHogProvider><div>x</div></PostHogProvider>)
    expect(mockInit).not.toHaveBeenCalled()
    act(() => setConsent('accepted'))
    expect(mockInit).toHaveBeenCalledTimes(1)
  })

  it('renders children regardless of consent', () => {
    const { getByText } = render(<PostHogProvider><span>kids</span></PostHogProvider>)
    expect(getByText('kids')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test, expect import failure**

```bash
pnpm test src/providers/__tests__/posthog-provider.test.tsx
```

Expected: `Cannot find module '../posthog-provider'`.

- [ ] **Step 5: Implement `PostHogProvider`**

```tsx
// src/providers/posthog-provider.tsx
'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import posthog from 'posthog-js'
import { hasAccepted } from '@/lib/consent'

export function PostHogProvider({ children }: { children: ReactNode }) {
  const initialized = useRef(false)

  useEffect(() => {
    const tryInit = () => {
      if (initialized.current) return
      if (!hasAccepted()) return
      const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
      const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
      if (!key) return
      posthog.init(key, {
        api_host: host || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: { password: true, email: true },
        },
        loaded: (ph) => {
          // 5% session replay sample for authenticated users (spec §2.2).
          if (Math.random() < 0.05) ph.startSessionRecording()
        },
      })
      initialized.current = true
    }

    tryInit()
    const onChange = () => tryInit()
    window.addEventListener('consent:change', onChange)
    return () => window.removeEventListener('consent:change', onChange)
  }, [])

  return <>{children}</>
}
```

- [ ] **Step 6: Run test, expect pass**

```bash
pnpm test src/providers/__tests__/posthog-provider.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 7: Implement server-side PostHog singleton**

```typescript
// src/lib/posthog/server.ts
import { PostHog } from 'posthog-node'

let client: PostHog | null = null

export function postHogServer(): PostHog | null {
  if (client) return client
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) {
    console.warn('[posthog] NEXT_PUBLIC_POSTHOG_KEY missing — server captures disabled')
    return null
  }
  client = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 1,             // serverless: flush every event immediately
    flushInterval: 0,
  })
  return client
}

/** Helper for one-off captures from API routes. Resolves after flush. */
export async function captureServer(args: {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}): Promise<void> {
  const ph = postHogServer()
  if (!ph) return
  ph.capture({ distinctId: args.distinctId, event: args.event, properties: args.properties })
  await ph.flush()
}
```

- [ ] **Step 8: Mount provider + banner in root layout**

Edit `src/app/layout.tsx` — wrap children:

```tsx
// inside <body>:
<PostHogProvider>
  {children}
  <CookieBanner />
</PostHogProvider>
```

> If `src/app/layout.tsx` already wraps children in other providers (Theme, SWR, etc.), nest `PostHogProvider` as the outermost — it's a passthrough render so order is harmless, but it must wrap so `consent:change` listener mounts before any analytics-emitting child.

- [ ] **Step 9: Build + smoke-load to verify no runtime errors**

```bash
pnpm dev &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

Expected: `200`. Inspect browser devtools manually: cookie banner visible; clicking Accept registers `consent:change` and PostHog request fires (Network tab → `us.i.posthog.com/decide`).

- [ ] **Step 10: Commit PostHog integration**

```bash
git add package.json pnpm-lock.yaml .env.local.example src/providers/posthog-provider.tsx src/lib/posthog/server.ts src/providers/__tests__/posthog-provider.test.tsx src/app/layout.tsx
git commit -m "feat(observability): PostHog client+server, gated by cookie consent

Client provider defers posthog.init until hasAccepted(); listens for
consent:change so banner accept activates without page reload. Server
singleton flushes immediately (serverless-friendly). 5% session replay
of authenticated users; password/email inputs auto-masked. See spec §2.2."
```

### Task 3.3: Define Phase 1 feature flags in PostHog

**Files:**
- Create: `docs/runbooks/posthog.md` (initial — flags section)

- [ ] **Step 1: Create the three required flags in PostHog UI**

Manually (UI; no SDK needed at this stage):
- `quant_engine_enabled` — boolean, default OFF, rollout 0%
- `smart_alerts_enabled` — boolean, default OFF, rollout 0%
- `realtime_prices_enabled` — boolean, default ON, rollout 100% (kill switch)

- [ ] **Step 2: Document the flags in runbook**

```bash
mkdir -p docs/runbooks
cat > docs/runbooks/posthog.md <<'EOF'
# PostHog runbook

## Cookie consent contract

PostHog only initializes after the user clicks **Aceptar** in `CookieBanner`.
Until then, no requests reach `us.i.posthog.com`. Sentry loads independently
(legitimate-interest error tracking).

To verify locally: open devtools → Application → Local Storage → `consent_v1`
should be present after clicking Accept; the banner should be hidden; the
Network tab should show requests to `us.i.posthog.com/decide`.

## Feature flags

| Flag | Default | Purpose |
|------|---------|---------|
| `quant_engine_enabled` | OFF | Gates Phase 2 (Modal-backed routes) — beta first |
| `smart_alerts_enabled` | OFF | Gates Phase 3 (anomaly engine + classifier) |
| `realtime_prices_enabled` | ON | Kill switch for Supabase Realtime price push |

Rollout ladder (per flag): 0% → own account → 5% beta → 25% → 50% → 100%.
Roll back to 0% if PostHog **error rate per flag** dashboard shows >1%
sustained over 10 min.

## Dashboards (create after first events land)

- **Cache Performance** — hit ratio per `key_prefix`, p50/p95 latency. Source
  event: `cache_lookup` (Task 4.x).
- **Funnel: portfolio creation** — `portfolio_created` → `transaction_added`
  → first dashboard view.
- **Adoption: optimize** — flag `quant_engine_enabled` exposure → first
  `optimize_run` event.

## On-call

PostHog free tier is 1M events/mo. Alert at 800k. Investigate event-volume
spike in **Activity** before disabling autocapture.
EOF
```

- [ ] **Step 3: Commit runbook**

```bash
git add docs/runbooks/posthog.md
git commit -m "docs(runbook): posthog — consent contract, flags, dashboards"
```

---

## Chunk 4: Cache metrics — `cacheGetWithMetrics`

Today there's no observability into Upstash hit/miss patterns. This chunk adds a wrapper that emits a PostHog `cache_lookup` event for every read, then progressively replaces call sites. The PostHog dashboard "Cache Performance" (defined in `posthog.md`) renders hit ratio per `key_prefix` and p50/p95 latency.

> **Why server-side PostHog?** Cache lookups happen in API routes (Node runtime). The client provider only fires when a user is actively browsing; we need every lookup, including server-rendered pages and cron requests. `posthog-node` handles this with `flushAt: 1` (Task 3.2 step 7).

### Task 4.1: Implement `cacheGetWithMetrics` wrapper

**Files:**
- Create: `src/lib/cache/with-metrics.ts`
- Test: `src/lib/cache/__tests__/with-metrics.test.ts`
- Modify: `src/lib/cache/index.ts`

- [ ] **Step 1: Write failing test for hit + miss + latency**

```typescript
// src/lib/cache/__tests__/with-metrics.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCacheGet = vi.fn()
const mockCapture = vi.fn()

vi.mock('../redis', () => ({ cacheGet: (k: string) => mockCacheGet(k) }))
vi.mock('@/lib/posthog/server', () => ({
  captureServer: (...a: unknown[]) => mockCapture(...a),
}))

import { cacheGetWithMetrics } from '../with-metrics'

beforeEach(() => {
  mockCacheGet.mockReset()
  mockCapture.mockReset()
})

describe('cacheGetWithMetrics', () => {
  it('returns null and emits hit=false on cache miss', async () => {
    mockCacheGet.mockResolvedValue(null)
    const result = await cacheGetWithMetrics<{ x: number }>('analytics:risk:u1:p1')
    expect(result).toBeNull()
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({
      event: 'cache_lookup',
      properties: expect.objectContaining({
        key_prefix: 'analytics:risk',
        hit: false,
      }),
    }))
  })

  it('returns value and emits hit=true on cache hit', async () => {
    mockCacheGet.mockResolvedValue({ x: 1 })
    const result = await cacheGetWithMetrics<{ x: number }>('price:AAPL')
    expect(result).toEqual({ x: 1 })
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ key_prefix: 'price', hit: true }),
    }))
  })

  it('emits latency_ms as a non-negative number', async () => {
    mockCacheGet.mockResolvedValue(null)
    await cacheGetWithMetrics('x:y:z')
    const props = mockCapture.mock.calls[0][0].properties
    expect(typeof props.latency_ms).toBe('number')
    expect(props.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('emits "unknown" prefix when key has no colon', async () => {
    mockCacheGet.mockResolvedValue(null)
    await cacheGetWithMetrics('orphan')
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ key_prefix: 'unknown' }),
    }))
  })

  it('still returns the cached value if PostHog capture throws', async () => {
    mockCacheGet.mockResolvedValue({ ok: 1 })
    mockCapture.mockRejectedValue(new Error('posthog down'))
    const result = await cacheGetWithMetrics('price:MSFT')
    expect(result).toEqual({ ok: 1 })
  })

  it('uses provided distinctId when passed', async () => {
    mockCacheGet.mockResolvedValue(null)
    await cacheGetWithMetrics('price:NVDA', { distinctId: 'u-42' })
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({
      distinctId: 'u-42',
    }))
  })

  it('falls back to "system" distinctId when none provided', async () => {
    mockCacheGet.mockResolvedValue(null)
    await cacheGetWithMetrics('price:NVDA')
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({
      distinctId: 'system',
    }))
  })
})
```

- [ ] **Step 2: Run test, expect import failure**

```bash
pnpm test src/lib/cache/__tests__/with-metrics.test.ts
```

Expected: `Cannot find module '../with-metrics'`.

- [ ] **Step 3: Implement `cacheGetWithMetrics`**

```typescript
// src/lib/cache/with-metrics.ts
import { cacheGet } from './redis'
import { captureServer } from '@/lib/posthog/server'

export interface CacheMetricsOptions {
  /** Pass the authenticated user id when known so PostHog can attribute. */
  distinctId?: string
}

/**
 * Drop-in wrapper for cacheGet that emits a PostHog `cache_lookup` event
 * with key_prefix, hit, and latency_ms. Failures to emit are swallowed
 * so caching always degrades gracefully (per spec §2.3).
 */
export async function cacheGetWithMetrics<T>(
  key: string,
  options: CacheMetricsOptions = {}
): Promise<T | null> {
  const start = performance.now()
  const value = await cacheGet<T>(key)
  const latency_ms = Math.max(0, Math.round(performance.now() - start))
  const hit = value !== null
  const key_prefix = extractPrefix(key)

  // Fire-and-forget; never block the read path.
  void captureServer({
    distinctId: options.distinctId ?? 'system',
    event: 'cache_lookup',
    properties: { key_prefix, hit, latency_ms },
  }).catch(() => {})

  return value
}

function extractPrefix(key: string): string {
  const i = key.indexOf(':')
  if (i === -1) return 'unknown'
  // Take first two segments when present (e.g. "analytics:risk:u1:p1" → "analytics:risk")
  const j = key.indexOf(':', i + 1)
  return j === -1 ? key.slice(0, i) : key.slice(0, j)
}
```

- [ ] **Step 4: Re-export from cache index**

Edit `src/lib/cache/index.ts` — add at end:

```typescript
export { cacheGetWithMetrics } from './with-metrics'
export type { CacheMetricsOptions } from './with-metrics'
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test src/lib/cache/__tests__/with-metrics.test.ts
```

Expected: 7 PASS.

- [ ] **Step 6: Commit wrapper**

```bash
git add src/lib/cache/with-metrics.ts src/lib/cache/__tests__/with-metrics.test.ts src/lib/cache/index.ts
git commit -m "feat(cache): cacheGetWithMetrics wrapper emits cache_lookup PostHog event

Drop-in for cacheGet — same return shape, adds key_prefix/hit/latency_ms
to PostHog. Capture errors are swallowed so cache reads never fail due
to analytics outages. See spec §2.3."
```

### Task 4.2: Migrate first call site as proof — analytics/risk

**Files:**
- Modify: `src/app/api/analytics/[pid]/risk/route.ts`

> **Strategy:** Migrate one route per day across Phase 1, Week 2. This task migrates the first one to validate the pattern. The runbook (Task 9.x) lists the queue. Do NOT bulk-replace — each call site needs to verify which `distinctId` to pass (often the route's authenticated user).

- [ ] **Step 1: Read existing route to identify the cache call**

```bash
grep -n "cacheGet\b" src/app/api/analytics/[pid]/risk/route.ts
```

Expected: at least one match. Note line number.

- [ ] **Step 2: Replace `cacheGet` with `cacheGetWithMetrics`**

Find the import:

```typescript
// Before
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/cache'
```

Replace with:

```typescript
import { cacheGetWithMetrics, cacheSet, CACHE_KEYS } from '@/lib/cache'
```

Find the call (typically inside the GET handler) — replace `cacheGet<T>(key)` with `cacheGetWithMetrics<T>(key, { distinctId: user.id })`. The exact line depends on the route's existing structure.

- [ ] **Step 3: Run typecheck + existing route test (if present)**

```bash
pnpm exec tsc --noEmit
pnpm test src/app/api/analytics 2>/dev/null || echo "no existing tests for this route — acceptable"
```

Expected: no type errors. Test result either PASS or `no existing tests`.

- [ ] **Step 4: Commit migration**

```bash
git add src/app/api/analytics/[pid]/risk/route.ts
git commit -m "refactor(cache): migrate analytics/risk to cacheGetWithMetrics

First migration validating the wrapper. Remaining call sites tracked in
docs/runbooks/cache-monitoring.md."
```

### Task 4.3: Cache monitoring runbook

**Files:**
- Create: `docs/runbooks/cache-monitoring.md`

- [ ] **Step 1: Write the runbook**

```bash
cat > docs/runbooks/cache-monitoring.md <<'EOF'
# Cache monitoring runbook

## What we instrument

Every `cacheGetWithMetrics` call emits a PostHog `cache_lookup` event:

```
{ key_prefix: string, hit: boolean, latency_ms: number }
```

`distinctId` is the authenticated user id when available, otherwise `system`
(crons, SSR without an auth context).

## Dashboard: Cache Performance

Create in PostHog → Insights → New Insight:

1. **Hit ratio per prefix** — Trends, event = `cache_lookup`, breakdown =
   `properties.key_prefix`, math = `% of total where hit = true`. Window: 24h.
2. **p95 latency per prefix** — Same event/breakdown, math = `Percentile p95
   of properties.latency_ms`.
3. **Volume per prefix** — Same event/breakdown, math = `Total count`.

## Alerts

| Condition | Window | Action |
|-----------|--------|--------|
| Hit ratio < 50% on any prefix | 1h sustained | Slack `#alerts` — investigate TTL or invalidation bug |
| p95 latency > 200ms | 30 min | Check Upstash dashboard for region/network issue |
| Volume drops > 80% vs 7-day avg | 1h | Check `cacheGetWithMetrics` migration didn't regress to `cacheGet` |

## Migration queue (Week 2)

Replace `cacheGet` with `cacheGetWithMetrics` in these routes, one per
commit, smallest first:

- [x] `src/app/api/analytics/[pid]/risk/route.ts` (Task 4.2)
- [ ] `src/app/api/analytics/[pid]/allocation/route.ts`
- [ ] `src/app/api/analytics/[pid]/returns/route.ts`
- [ ] `src/app/api/analytics/[pid]/attribution/route.ts`
- [ ] `src/app/api/analytics/[pid]/income/route.ts`
- [ ] `src/app/api/dashboard/summary/route.ts`
- [ ] `src/app/api/discover/leaderboard/route.ts`
- [ ] `src/app/api/portfolio/compare/route.ts`

For each: pass `{ distinctId: user.id }` when available; otherwise omit.

## On-call

If hit ratio collapses across all prefixes simultaneously, the most likely
causes are: PostHog ingestion outage (events drop, lookups still happen),
Upstash regional degradation (cache reads return null), or a recent deploy
that bypassed the wrapper. Roll back the deploy first; investigate after.
EOF
```

- [ ] **Step 2: Commit runbook**

```bash
git add docs/runbooks/cache-monitoring.md
git commit -m "docs(runbook): cache-monitoring — dashboard, alerts, migration queue"
```

---

## Chunk 5: Worker expansion — 4 new background crons

The Worker currently only fetches prices. Phases 2 (factor analysis) and 3 (alerts) need additional background data: sector/industry per held symbol, dividend calendar, earnings calendar, and news. This chunk adds 4 new crons and their corresponding tables (DDL already shipped in Chunk 1).

> **Worker tests use Vitest + miniflare.** If miniflare isn't installed, `worker/package.json` needs `vitest`, `@cloudflare/vitest-pool-workers`, and `wrangler` as devDeps. Worker tests run via `pnpm --filter worker test`.

> **API rate limits:** Twelve Data free tier = 8 req/min. Finnhub free = 60 req/min. Code respects both via existing rate-limit pattern in `worker/src/index.ts` — extend that pattern; do not add a new mechanism.

### Task 5.1: Set up Vitest in worker package (if not already)

**Files:**
- Modify: `worker/package.json`
- Create: `worker/vitest.config.ts`

- [ ] **Step 1: Check current worker test setup**

```bash
cat worker/package.json
test -f worker/vitest.config.ts && echo "EXISTS" || echo "MISSING"
```

- [ ] **Step 2: If missing, install Vitest + miniflare pool**

```bash
cd worker
pnpm add -D vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
cd ..
```

Add scripts to `worker/package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create `worker/vitest.config.ts`**

```typescript
// worker/vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
```

- [ ] **Step 4: Verify test runner boots (no tests yet — empty pass)**

```bash
pnpm --filter worker test
```

Expected: `No test files found` (acceptable). If errors about missing types, install `@cloudflare/workers-types` (Step 2).

- [ ] **Step 5: Commit**

```bash
git add worker/package.json worker/pnpm-lock.yaml worker/vitest.config.ts
git commit -m "chore(worker): add vitest + cloudflare workers pool for cron tests"
```

### Task 5.2: Sectors cron — `worker/src/sectors-cron.ts`

**Files:**
- Create: `worker/src/sectors-cron.ts`
- Test: `worker/src/__tests__/sectors-cron.test.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/sectors-cron.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runSectorsCron } from '../sectors-cron'

const supabase = (rows: { symbol: string }[]) => ({
  from: vi.fn(() => ({
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  })),
})

describe('runSectorsCron', () => {
  it('enumerates held symbols and upserts company_profile rows', async () => {
    const sb = supabase([{ symbol: 'AAPL' }, { symbol: 'MSFT' }])
    const fetchProfile = vi.fn().mockResolvedValue({
      symbol: 'AAPL', sector: 'Technology', industry: 'Hardware',
      market_cap: 3e12, country: 'US', exchange: 'NASDAQ', description: 'x',
    })
    await runSectorsCron(sb as any, fetchProfile)
    expect(fetchProfile).toHaveBeenCalledTimes(2)
    expect(sb.from).toHaveBeenCalledWith('company_profile')
  })

  it('skips symbols whose profile fetch returns null (rate-limited or 404)', async () => {
    const sb = supabase([{ symbol: 'AAPL' }, { symbol: 'BADSYM' }])
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce({ symbol: 'AAPL', sector: 'Technology', industry: 'x', market_cap: 1, country: 'US', exchange: 'NASDAQ', description: '' })
      .mockResolvedValueOnce(null)
    await runSectorsCron(sb as any, fetchProfile)
    // Only one upsert call should carry data; the other is skipped.
    const upsertCalls = (sb.from as any).mock.results
      .map((r: any) => r.value.upsert)
      .filter((u: any) => u && u.mock.calls.length > 0)
    expect(upsertCalls.length).toBeGreaterThan(0)
  })

  it('returns a summary { processed, skipped }', async () => {
    const sb = supabase([{ symbol: 'AAPL' }])
    const fetchProfile = vi.fn().mockResolvedValue({
      symbol: 'AAPL', sector: 'x', industry: 'x', market_cap: 1,
      country: 'US', exchange: 'NASDAQ', description: '',
    })
    const result = await runSectorsCron(sb as any, fetchProfile)
    expect(result).toEqual({ processed: 1, skipped: 0 })
  })
})
```

- [ ] **Step 2: Run test, expect import failure**

```bash
pnpm --filter worker test sectors-cron
```

Expected: `Cannot find module '../sectors-cron'`.

- [ ] **Step 3: Implement sectors cron**

```typescript
// worker/src/sectors-cron.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompanyProfile {
  symbol: string
  sector: string | null
  industry: string | null
  market_cap: number | null
  country: string | null
  exchange: string | null
  description: string | null
}

export type FetchProfile = (symbol: string) => Promise<CompanyProfile | null>

/**
 * For every distinct symbol with a non-zero open position, fetch the
 * company profile and upsert into company_profile.
 *
 * Pure function: takes a SupabaseClient + fetcher so tests can inject
 * mocks. The cron handler in worker/src/index.ts wires the real fetcher.
 */
export async function runSectorsCron(
  supabase: SupabaseClient,
  fetchProfile: FetchProfile
): Promise<{ processed: number; skipped: number }> {
  const { data: positions, error } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)
  if (error) throw error
  if (!positions) return { processed: 0, skipped: 0 }

  const symbols = Array.from(new Set(positions.map(p => p.symbol)))
  let processed = 0
  let skipped = 0

  for (const symbol of symbols) {
    const profile = await fetchProfile(symbol)
    if (!profile) { skipped++; continue }
    const { error: upErr } = await supabase
      .from('company_profile')
      .upsert({ ...profile, updated_at: new Date().toISOString() })
    if (upErr) { skipped++; continue }
    processed++
  }

  return { processed, skipped }
}

/** Production fetcher — Twelve Data /profile. */
export function makeTwelveDataFetcher(apiKey: string): FetchProfile {
  return async (symbol) => {
    try {
      const url = `https://api.twelvedata.com/profile?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) return null
      const json: any = await res.json()
      if (json.status === 'error' || !json.symbol) return null
      return {
        symbol: json.symbol,
        sector: json.sector ?? null,
        industry: json.industry ?? null,
        market_cap: json.market_capitalization ? Number(json.market_capitalization) : null,
        country: json.country ?? null,
        exchange: json.exchange ?? null,
        description: json.description ?? null,
      }
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter worker test sectors-cron
```

Expected: 3 PASS.

- [ ] **Step 5: Wire into Worker entrypoint**

Edit `worker/src/index.ts`:

```typescript
// Add import at top
import { runSectorsCron, makeTwelveDataFetcher } from './sectors-cron'

// Inside scheduled() switch — add new case:
case '0 */1 * * *':
  // Sectors: hourly during market hours
  ctx.waitUntil(runSectorsCron(supabase, makeTwelveDataFetcher(env.TWELVE_DATA_API_KEY))
    .then(r => console.log('[sectors-cron]', r))
    .catch(e => { console.error('[sectors-cron]', e); throw e }))
  break
```

- [ ] **Step 6: Add cron trigger to `wrangler.toml`**

Edit `worker/wrangler.toml`:

```toml
[triggers]
crons = [
  "*/5 * * * *",       # hot prices (existing)
  "*/30 * * * *",      # warm prices (existing) — also news ingestion (Task 5.5)
  "0 */12 * * *",      # daily history (existing)
  "0 */1 * * *",       # NEW: sectors hourly
  "0 */4 * * *",       # NEW: dividends every 4h (Task 5.3)
  "0 9 * * 1-5",       # NEW: earnings daily 9 AM ET (Task 5.4)
]
```

> The `*/30 * * * *` trigger already exists for warm prices; the news cron (Task 5.5) shares it. The handler dispatches to multiple jobs based on `Date.now()`-derived sub-windows, OR (cleaner) we add a dedicated `*/30` handler that runs both. Use the dispatcher approach — the switch case for `*/30` invokes both `fetchWarmPrices` AND `runNewsIngestion` via `Promise.all` inside `ctx.waitUntil`.

- [ ] **Step 7: Local dry-run via wrangler**

```bash
cd worker
wrangler dev --test-scheduled &
sleep 4
curl -s "http://localhost:8787/__scheduled?cron=0+*%2F1+*+*+*"
kill %1
cd ..
```

Expected: HTTP 200, log shows `[sectors-cron] { processed: N, skipped: M }`.

- [ ] **Step 8: Commit**

```bash
git add worker/src/sectors-cron.ts worker/src/__tests__/sectors-cron.test.ts worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): hourly sectors cron — Twelve Data /profile → company_profile

Pure runSectorsCron(supabase, fetchProfile) for testability; production
fetcher from Twelve Data wired in scheduled handler. See spec §2.4."
```

### Task 5.3: Dividends cron — `worker/src/dividends-cron.ts`

**Files:**
- Create: `worker/src/dividends-cron.ts`
- Test: `worker/src/__tests__/dividends-cron.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/dividends-cron.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runDividendsCron } from '../dividends-cron'

const supabase = (positions: { symbol: string }[]) => ({
  from: vi.fn((table: string) => ({
    select: vi.fn().mockResolvedValue({
      data: table === 'positions' ? positions : [],
      error: null,
    }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  })),
})

describe('runDividendsCron', () => {
  it('fetches next 90d dividends for each held symbol and upserts', async () => {
    const sb = supabase([{ symbol: 'AAPL' }, { symbol: 'MSFT' }])
    const fetchDivs = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', ex_date: '2026-05-15', pay_date: '2026-05-22', amount: 0.24, currency: 'USD' },
    ])
    const result = await runDividendsCron(sb as any, fetchDivs)
    expect(fetchDivs).toHaveBeenCalledTimes(2)
    expect(fetchDivs).toHaveBeenCalledWith('AAPL', expect.any(String), expect.any(String))
    expect(result.processed).toBeGreaterThan(0)
  })

  it('handles symbols with no upcoming dividends gracefully', async () => {
    const sb = supabase([{ symbol: 'TSLA' }])
    const fetchDivs = vi.fn().mockResolvedValue([])
    const result = await runDividendsCron(sb as any, fetchDivs)
    expect(result.processed).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('counts upsert errors as skipped', async () => {
    const sb = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockResolvedValue({ data: table === 'positions' ? [{ symbol: 'AAPL' }] : [], error: null }),
        upsert: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
      })),
    }
    const fetchDivs = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', ex_date: '2026-05-15', pay_date: '2026-05-22', amount: 0.24, currency: 'USD' },
    ])
    const result = await runDividendsCron(sb as any, fetchDivs)
    expect(result.skipped).toBe(1)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter worker test dividends-cron
```

Expected: `Cannot find module '../dividends-cron'`.

- [ ] **Step 3: Implement dividends cron**

```typescript
// worker/src/dividends-cron.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DividendEntry {
  symbol: string
  ex_date: string      // YYYY-MM-DD
  pay_date: string | null
  amount: number
  currency: string
}

export type FetchDividends = (
  symbol: string,
  fromISO: string,
  toISO: string
) => Promise<DividendEntry[]>

export async function runDividendsCron(
  supabase: SupabaseClient,
  fetchDividends: FetchDividends
): Promise<{ processed: number; skipped: number }> {
  const { data: positions, error } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)
  if (error) throw error
  if (!positions) return { processed: 0, skipped: 0 }

  const symbols = Array.from(new Set(positions.map(p => p.symbol)))
  const today = new Date()
  const ninetyDays = new Date(today.getTime() + 90 * 24 * 3600 * 1000)
  const fromISO = today.toISOString().slice(0, 10)
  const toISO = ninetyDays.toISOString().slice(0, 10)

  let processed = 0
  let skipped = 0

  for (const symbol of symbols) {
    const entries = await fetchDividends(symbol, fromISO, toISO)
    for (const entry of entries) {
      const { error: upErr } = await supabase
        .from('dividend_calendar')
        .upsert(entry)
      if (upErr) { skipped++; continue }
      processed++
    }
  }

  return { processed, skipped }
}

/** Production fetcher — Finnhub /calendar/dividend. */
export function makeFinnhubDividendFetcher(apiKey: string): FetchDividends {
  return async (symbol, from, to) => {
    try {
      const url = `https://finnhub.io/api/v1/calendar/dividend?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) return []
      const json: any = await res.json()
      const list = Array.isArray(json.dividend) ? json.dividend : []
      return list.map((d: any) => ({
        symbol: d.symbol ?? symbol,
        ex_date: d.exDate ?? d.ex_date,
        pay_date: d.payDate ?? d.pay_date ?? null,
        amount: Number(d.amount ?? 0),
        currency: d.currency ?? 'USD',
      })).filter((d: DividendEntry) => d.ex_date && d.amount > 0)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter worker test dividends-cron
```

Expected: 3 PASS.

- [ ] **Step 5: Wire into `worker/src/index.ts`**

```typescript
import { runDividendsCron, makeFinnhubDividendFetcher } from './dividends-cron'

// Inside scheduled() switch:
case '0 */4 * * *':
  ctx.waitUntil(runDividendsCron(supabase, makeFinnhubDividendFetcher(env.FINNHUB_API_KEY))
    .then(r => console.log('[dividends-cron]', r))
    .catch(e => { console.error('[dividends-cron]', e); throw e }))
  break
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/dividends-cron.ts worker/src/__tests__/dividends-cron.test.ts worker/src/index.ts
git commit -m "feat(worker): 4h dividends cron — Finnhub /calendar/dividend (90d window)

Pure runDividendsCron(supabase, fetcher); upserts into dividend_calendar.
Skip-and-count on upsert errors so one bad symbol doesn't fail the run."
```

### Task 5.4: Earnings cron — `worker/src/earnings-cron.ts`

**Files:**
- Create: `worker/src/earnings-cron.ts`
- Test: `worker/src/__tests__/earnings-cron.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/earnings-cron.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runEarningsCron } from '../earnings-cron'

const supabase = (positions: { symbol: string }[]) => ({
  from: vi.fn((table: string) => ({
    select: vi.fn().mockResolvedValue({
      data: table === 'positions' ? positions : [],
      error: null,
    }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  })),
})

describe('runEarningsCron', () => {
  it('fetches next 4 weeks earnings per held symbol and upserts', async () => {
    const sb = supabase([{ symbol: 'AAPL' }])
    const fetchEarnings = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', earnings_date: '2026-05-01', hour: 'amc', eps_estimate: 1.50, revenue_estimate: 95e9 },
    ])
    const result = await runEarningsCron(sb as any, fetchEarnings)
    expect(result.processed).toBe(1)
  })

  it('coerces missing eps/revenue to null', async () => {
    const sb = supabase([{ symbol: 'AAPL' }])
    const fetchEarnings = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', earnings_date: '2026-05-01', hour: 'bmo', eps_estimate: undefined, revenue_estimate: null },
    ])
    const result = await runEarningsCron(sb as any, fetchEarnings)
    expect(result.processed).toBe(1)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter worker test earnings-cron
```

Expected: `Cannot find module '../earnings-cron'`.

- [ ] **Step 3: Implement earnings cron**

```typescript
// worker/src/earnings-cron.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface EarningsEntry {
  symbol: string
  earnings_date: string  // YYYY-MM-DD
  hour: 'bmo' | 'amc' | null
  eps_estimate: number | null
  revenue_estimate: number | null
}

export type FetchEarnings = (
  symbol: string,
  fromISO: string,
  toISO: string
) => Promise<EarningsEntry[]>

export async function runEarningsCron(
  supabase: SupabaseClient,
  fetchEarnings: FetchEarnings
): Promise<{ processed: number; skipped: number }> {
  const { data: positions, error } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)
  if (error) throw error
  if (!positions) return { processed: 0, skipped: 0 }

  const symbols = Array.from(new Set(positions.map(p => p.symbol)))
  const today = new Date()
  const fourWeeks = new Date(today.getTime() + 28 * 24 * 3600 * 1000)
  const fromISO = today.toISOString().slice(0, 10)
  const toISO = fourWeeks.toISOString().slice(0, 10)

  let processed = 0
  let skipped = 0

  for (const symbol of symbols) {
    const entries = await fetchEarnings(symbol, fromISO, toISO)
    for (const entry of entries) {
      const row: EarningsEntry = {
        symbol: entry.symbol,
        earnings_date: entry.earnings_date,
        hour: entry.hour ?? null,
        eps_estimate: entry.eps_estimate != null ? Number(entry.eps_estimate) : null,
        revenue_estimate: entry.revenue_estimate != null ? Number(entry.revenue_estimate) : null,
      }
      const { error: upErr } = await supabase.from('earnings_calendar').upsert(row)
      if (upErr) { skipped++; continue }
      processed++
    }
  }

  return { processed, skipped }
}

export function makeFinnhubEarningsFetcher(apiKey: string): FetchEarnings {
  return async (symbol, from, to) => {
    try {
      const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) return []
      const json: any = await res.json()
      const list = Array.isArray(json.earningsCalendar) ? json.earningsCalendar : []
      return list.map((e: any) => ({
        symbol: e.symbol ?? symbol,
        earnings_date: e.date,
        hour: e.hour === 'bmo' || e.hour === 'amc' ? e.hour : null,
        eps_estimate: e.epsEstimate ?? null,
        revenue_estimate: e.revenueEstimate ?? null,
      })).filter((e: EarningsEntry) => e.earnings_date)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter worker test earnings-cron
```

Expected: 2 PASS.

- [ ] **Step 5: Wire into `worker/src/index.ts`**

```typescript
import { runEarningsCron, makeFinnhubEarningsFetcher } from './earnings-cron'

// Inside scheduled() switch:
case '0 9 * * 1-5':
  ctx.waitUntil(runEarningsCron(supabase, makeFinnhubEarningsFetcher(env.FINNHUB_API_KEY))
    .then(r => console.log('[earnings-cron]', r))
    .catch(e => { console.error('[earnings-cron]', e); throw e }))
  break
```

> **DST note:** The `0 9 * * 1-5` cron fires at 9 AM **UTC** on Cloudflare. If you want 9 AM **ET**, that's 13/14 UTC depending on DST. The spec accepts UTC for Q2 simplicity (review acknowledged this); revisit only if a Phase 3 alert times out due to drift. Document in `docs/runbooks/health-checks.md`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/earnings-cron.ts worker/src/__tests__/earnings-cron.test.ts worker/src/index.ts
git commit -m "feat(worker): daily earnings cron — Finnhub /calendar/earnings (4w window)

Pure runEarningsCron(supabase, fetcher); upserts earnings_calendar.
Hour normalised to bmo|amc|null."
```

### Task 5.5: News ingestion — `worker/src/news-ingestion.ts`

**Files:**
- Create: `worker/src/news-ingestion.ts`
- Test: `worker/src/__tests__/news-ingestion.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/news-ingestion.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runNewsIngestion } from '../news-ingestion'

const supabase = (topSymbols: { symbol: string; volume: number }[]) => ({
  rpc: vi.fn().mockResolvedValue({ data: topSymbols, error: null }),
  from: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue({ error: null }),
  })),
})

describe('runNewsIngestion', () => {
  it('fetches news for top 50 symbols by portfolio volume', async () => {
    const top = Array.from({ length: 60 }, (_, i) => ({ symbol: `S${i}`, volume: 1000 - i }))
    const sb = supabase(top)
    const fetchNews = vi.fn().mockResolvedValue([
      { symbol: 'S0', headline: 'h', summary: 's', url: 'https://x/0', source: 'reuters', published_at: '2026-04-20T10:00:00Z' },
    ])
    await runNewsIngestion(sb as any, fetchNews)
    expect(fetchNews).toHaveBeenCalledTimes(50)  // capped at 50
  })

  it('does not insert duplicate URLs (relies on UNIQUE constraint)', async () => {
    const sb = supabase([{ symbol: 'AAPL', volume: 1 }])
    const fetchNews = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', headline: 'h', summary: 's', url: 'https://x/dup', source: 'reuters', published_at: '2026-04-20T10:00:00Z' },
      { symbol: 'AAPL', headline: 'h2', summary: 's', url: 'https://x/dup', source: 'reuters', published_at: '2026-04-20T11:00:00Z' },
    ])
    await runNewsIngestion(sb as any, fetchNews)
    // Implementation dedupes in-batch by url before insert.
    const insertCalls = (sb.from as any).mock.results
      .map((r: any) => r.value.insert.mock.calls).flat()
    const inserted = insertCalls.flat()
    const urls = inserted.map((row: any) => row.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('inserts with classified_at = null (Phase 3 will set it)', async () => {
    const sb = supabase([{ symbol: 'AAPL', volume: 1 }])
    const fetchNews = vi.fn().mockResolvedValue([
      { symbol: 'AAPL', headline: 'h', summary: 's', url: 'https://x/1', source: 'r', published_at: '2026-04-20T10:00:00Z' },
    ])
    await runNewsIngestion(sb as any, fetchNews)
    const insertedRow = (sb.from as any).mock.results[0].value.insert.mock.calls[0][0][0]
    expect(insertedRow.classified_at).toBeUndefined()  // never set by ingester
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter worker test news-ingestion
```

Expected: `Cannot find module '../news-ingestion'`.

- [ ] **Step 3: Implement news ingestion**

```typescript
// worker/src/news-ingestion.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface NewsItem {
  symbol: string
  headline: string
  summary: string | null
  url: string
  source: string | null
  published_at: string  // ISO 8601
}

export type FetchNews = (symbol: string, sinceISO: string) => Promise<NewsItem[]>

export async function runNewsIngestion(
  supabase: SupabaseClient,
  fetchNews: FetchNews,
  options: { topN?: number; lookbackHours?: number } = {}
): Promise<{ inserted: number; symbols: number }> {
  const topN = options.topN ?? 50
  const lookbackHours = options.lookbackHours ?? 24

  // Top symbols by portfolio aggregate market value across all users.
  // Implementation requires a SQL view OR an RPC `top_symbols_by_volume(limit_n int)`.
  // For Phase 1 use an RPC — easier to tune than a view.
  const { data: top, error } = await supabase.rpc('top_symbols_by_volume', { limit_n: topN })
  if (error) throw error
  if (!top || !Array.isArray(top)) return { inserted: 0, symbols: 0 }

  const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString()
  let inserted = 0
  let symbols = 0

  for (const row of top.slice(0, topN)) {
    symbols++
    const items = await fetchNews(row.symbol, since)
    if (!items.length) continue

    // Dedupe by url within this batch — the UNIQUE(url) constraint
    // also catches cross-batch dupes at insert time.
    const seen = new Set<string>()
    const unique = items.filter(i => {
      if (seen.has(i.url)) return false
      seen.add(i.url)
      return true
    })

    // Use insert with onConflict ignore so cross-batch dupes don't error.
    // Supabase JS: .upsert with ignoreDuplicates: true on the conflict column.
    const { error: insErr } = await supabase
      .from('news_items')
      .upsert(unique, { onConflict: 'url', ignoreDuplicates: true })
    if (insErr) {
      // Log but continue — partial success is acceptable.
      console.warn('[news-ingestion] insert error for', row.symbol, insErr.message)
      continue
    }
    inserted += unique.length
  }

  return { inserted, symbols }
}

export function makeFinnhubNewsFetcher(apiKey: string): FetchNews {
  return async (symbol, sinceISO) => {
    try {
      const from = sinceISO.slice(0, 10)
      const to = new Date().toISOString().slice(0, 10)
      const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) return []
      const json: any = await res.json()
      if (!Array.isArray(json)) return []
      return json
        .filter((n: any) => n.url && n.headline)
        .map((n: any) => ({
          symbol,
          headline: String(n.headline),
          summary: n.summary ? String(n.summary) : null,
          url: String(n.url),
          source: n.source ? String(n.source) : null,
          published_at: new Date((n.datetime ?? Date.now() / 1000) * 1000).toISOString(),
        }))
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Add `top_symbols_by_volume` RPC migration**

This RPC is referenced by Step 3. Add to a follow-up SQL file:

```bash
cat > supabase/migrations/008b_top_symbols_rpc.sql <<'EOF'
-- 008b_top_symbols_rpc.sql
-- RPC consumed by worker/src/news-ingestion.ts to scope news fetching
-- to the most-held symbols across all portfolios.
--
-- Numbered 008b (suffix, not 009) to keep with the worker-expansion
-- Phase 1 scope; 009/010 are reserved for Phases 2/3 per spec §5.1.

CREATE OR REPLACE FUNCTION top_symbols_by_volume(limit_n INT)
RETURNS TABLE (symbol TEXT, volume NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    p.symbol,
    SUM(p.quantity * COALESCE(cp.price, 0))::NUMERIC AS volume
  FROM positions p
  LEFT JOIN current_prices cp ON cp.symbol = p.symbol
  WHERE p.quantity > 0
  GROUP BY p.symbol
  ORDER BY volume DESC
  LIMIT limit_n
$$;

-- Grant execute to authenticated and service_role.
GRANT EXECUTE ON FUNCTION top_symbols_by_volume(INT) TO authenticated, service_role;
EOF
supabase db push
```

> **Numbering note:** Suffix `b` is acceptable for an additive RPC inside the same Phase 1 scope. If the project's convention rejects suffixes, rename to a fresh sequential number (e.g., 008b → 008_2 or fold into 008 as one file before any of these migrations are applied to production). Pick the convention before commit; do not mix.

- [ ] **Step 5: Run news test, expect pass**

```bash
pnpm --filter worker test news-ingestion
```

Expected: 3 PASS.

- [ ] **Step 6: Wire into Worker `*/30` handler**

Edit `worker/src/index.ts`:

```typescript
import { runNewsIngestion, makeFinnhubNewsFetcher } from './news-ingestion'

// Modify the existing case for '*/30 * * * *':
case '*/30 * * * *':
  ctx.waitUntil(Promise.all([
    fetchWarmPrices(supabase, env),
    runNewsIngestion(supabase, makeFinnhubNewsFetcher(env.FINNHUB_API_KEY))
      .then(r => console.log('[news-ingestion]', r))
      .catch(e => { console.error('[news-ingestion]', e); throw e }),
  ]))
  break
```

- [ ] **Step 7: Commit**

```bash
git add worker/src/news-ingestion.ts worker/src/__tests__/news-ingestion.test.ts worker/src/index.ts supabase/migrations/008b_top_symbols_rpc.sql
git commit -m "feat(worker): 30-min news ingestion — Finnhub /company-news (top 50, 24h)

Pure runNewsIngestion(supabase, fetcher); RPC top_symbols_by_volume
ranks symbols by aggregate market value. classified_at remains null
until Phase 3 classifier writes it. Dedupes by url in-batch + UNIQUE
constraint catches cross-batch."
```

### Task 5.6: Deploy worker to dev and verify cron history

**Files:** none (operational)

- [ ] **Step 1: Deploy**

```bash
cd worker && wrangler deploy && cd ..
```

Expected: deployment succeeds; `wrangler tail` shows `[sectors-cron]`, `[dividends-cron]`, `[earnings-cron]`, `[news-ingestion]` entries during their respective windows.

- [ ] **Step 2: Verify rows landed in Supabase**

```bash
supabase db query "SELECT COUNT(*) FROM company_profile;"
supabase db query "SELECT COUNT(*) FROM dividend_calendar WHERE ex_date >= CURRENT_DATE;"
supabase db query "SELECT COUNT(*) FROM earnings_calendar WHERE earnings_date >= CURRENT_DATE;"
supabase db query "SELECT COUNT(*) FROM news_items WHERE fetched_at > now() - INTERVAL '2 hours';"
```

Expected: non-zero counts (or zero only for tables whose cron hasn't fired yet within the dev observation window).

- [ ] **Step 3: Open Sentry → `worker-dev` → confirm zero new errors after first full cycle (~30 min)**

If errors appear, triage by `cron` tag and fix the corresponding cron implementation before promoting.

---

## Chunk 6: Supabase Realtime — price push

After the Worker upserts `current_prices`, broadcast on the `prices` channel via Supabase Realtime REST so subscribed clients receive `{ symbol, price, change_pct, ts }` within ~1s. The Next.js hook `useRealtimePrices(symbols)` maintains a `Map<symbol, PriceUpdate>` consumed by SWR. SWR polling at 60s remains as fallback. The PostHog flag `realtime_prices_enabled` (Task 3.3) is the kill switch.

> **Why broadcast and not Postgres changes?** Realtime CDC on `current_prices` would replay every row UPSERT (~hundreds per minute), incurring needless bandwidth. Broadcast is server-initiated, payload-controlled, and the Worker already holds the data.

### Task 6.1: Worker → Realtime broadcast

**Files:**
- Create: `worker/src/realtime-publish.ts`
- Test: `worker/src/__tests__/realtime-publish.test.ts`
- Modify: `worker/src/index.ts` (call from `fetchHotPrices` and `fetchWarmPrices` after upsert)

- [ ] **Step 1: Write failing test**

```typescript
// worker/src/__tests__/realtime-publish.test.ts
import { describe, it, expect, vi } from 'vitest'
import { publishPriceUpdates } from '../realtime-publish'

describe('publishPriceUpdates', () => {
  it('POSTs once per symbol batch to the prices channel', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    globalThis.fetch = fetchSpy as any
    const updates = [
      { symbol: 'AAPL', price: 178.2, change_pct: 1.2, ts: Date.now() },
      { symbol: 'MSFT', price: 410.1, change_pct: -0.3, ts: Date.now() },
    ]
    await publishPriceUpdates(updates, {
      url: 'https://x.supabase.co',
      serviceRoleKey: 'sk',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchSpy.mock.calls[0]
    expect(calledUrl).toMatch(/realtime\/v1\/api\/broadcast/)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toMatchObject({ topic: 'prices', event: 'price_update' })
  })

  it('skips empty batch', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as any
    await publishPriceUpdates([], { url: 'x', serviceRoleKey: 'y' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not throw on non-2xx (logs and returns)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any
    await expect(publishPriceUpdates(
      [{ symbol: 'X', price: 1, change_pct: 0, ts: 0 }],
      { url: 'x', serviceRoleKey: 'y' }
    )).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter worker test realtime-publish
```

Expected: `Cannot find module '../realtime-publish'`.

- [ ] **Step 3: Implement**

```typescript
// worker/src/realtime-publish.ts
export interface PriceUpdate {
  symbol: string
  price: number
  change_pct: number
  ts: number             // unix ms
}

export interface BroadcastConfig {
  url: string            // SUPABASE_URL, e.g. https://x.supabase.co
  serviceRoleKey: string
}

/**
 * Broadcast price updates to the `prices` channel via Supabase Realtime
 * REST. Multiple symbols are batched into a single POST. Errors log
 * but do not throw — Realtime is a best-effort enhancement; SWR polling
 * remains the source of truth.
 */
export async function publishPriceUpdates(
  updates: PriceUpdate[],
  cfg: BroadcastConfig
): Promise<void> {
  if (!updates.length) return
  const endpoint = `${cfg.url.replace(/\/$/, '')}/realtime/v1/api/broadcast`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': cfg.serviceRoleKey,
        'Authorization': `Bearer ${cfg.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: updates.map(u => ({
          topic: 'prices',
          event: 'price_update',
          payload: u,
        })),
      }),
    })
    if (!res.ok) {
      console.warn('[realtime-publish] non-2xx', res.status)
    }
  } catch (err) {
    console.warn('[realtime-publish] fetch error', err)
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter worker test realtime-publish
```

Expected: 3 PASS.

- [ ] **Step 5: Wire into existing price fetch flow**

Edit `worker/src/index.ts` — find the `fetchHotPrices` function. After it upserts to `current_prices`, call `publishPriceUpdates`:

```typescript
import { publishPriceUpdates } from './realtime-publish'

// Inside fetchHotPrices (after upsert):
const updates = pricesArray.map(p => ({
  symbol: p.symbol,
  price: p.price,
  change_pct: p.change_pct,
  ts: Date.now(),
}))
await publishPriceUpdates(updates, {
  url: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
})

// Same call inside fetchWarmPrices.
```

> If the existing `fetchHotPrices` doesn't accumulate prices into a single array, add the broadcast inside the per-symbol upsert loop with a buffered flush (or the simpler: collect into a local array then flush once at end). The simplest correct version is the latter.

- [ ] **Step 6: Commit**

```bash
git add worker/src/realtime-publish.ts worker/src/__tests__/realtime-publish.test.ts worker/src/index.ts
git commit -m "feat(worker): broadcast price upserts to Supabase Realtime prices channel

Best-effort: errors log and continue; SWR polling remains source of truth.
Hook useRealtimePrices (next commit) consumes the channel. See spec §2.5."
```

### Task 6.2: Client hook `useRealtimePrices`

**Files:**
- Create: `src/lib/hooks/useRealtimePrices.ts`
- Test: `src/lib/hooks/__tests__/useRealtimePrices.test.ts`

- [ ] **Step 1: Write failing test**

```tsx
// src/lib/hooks/__tests__/useRealtimePrices.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn(function (this: any, cb?: (status: string) => void) {
    cb?.('SUBSCRIBED')
    return this
  }),
  unsubscribe: vi.fn().mockResolvedValue('ok'),
}
const mockSupabase = {
  channel: vi.fn().mockReturnValue(mockChannel),
}
vi.mock('@/lib/supabase/client', () => ({ supabase: mockSupabase }))

const mockFlag = vi.fn()
vi.mock('@/lib/posthog/client', () => ({ isFeatureEnabled: (k: string) => mockFlag(k) }))

import { useRealtimePrices } from '../useRealtimePrices'

beforeEach(() => {
  mockChannel.on.mockClear()
  mockChannel.subscribe.mockClear()
  mockChannel.unsubscribe.mockClear()
  mockSupabase.channel.mockClear()
  mockFlag.mockReset()
})

describe('useRealtimePrices', () => {
  it('subscribes to the prices channel when realtime_prices_enabled is true', () => {
    mockFlag.mockReturnValue(true)
    renderHook(() => useRealtimePrices(['AAPL', 'MSFT']))
    expect(mockSupabase.channel).toHaveBeenCalledWith('prices')
    expect(mockChannel.on).toHaveBeenCalledWith('broadcast', { event: 'price_update' }, expect.any(Function))
    expect(mockChannel.subscribe).toHaveBeenCalled()
  })

  it('does NOT subscribe when realtime_prices_enabled is false (kill switch)', () => {
    mockFlag.mockReturnValue(false)
    renderHook(() => useRealtimePrices(['AAPL']))
    expect(mockSupabase.channel).not.toHaveBeenCalled()
  })

  it('updates the returned map when a matching broadcast arrives', () => {
    mockFlag.mockReturnValue(true)
    let payloadHandler: any
    mockChannel.on = vi.fn(function (_t: string, _f: any, h: any) {
      payloadHandler = h
      return this
    })
    const { result } = renderHook(() => useRealtimePrices(['AAPL']))
    act(() => payloadHandler({ payload: { symbol: 'AAPL', price: 200, change_pct: 1, ts: 1 } }))
    expect(result.current.get('AAPL')).toEqual({ symbol: 'AAPL', price: 200, change_pct: 1, ts: 1 })
  })

  it('ignores broadcasts for symbols not in the watch list', () => {
    mockFlag.mockReturnValue(true)
    let payloadHandler: any
    mockChannel.on = vi.fn(function (_t: string, _f: any, h: any) {
      payloadHandler = h
      return this
    })
    const { result } = renderHook(() => useRealtimePrices(['AAPL']))
    act(() => payloadHandler({ payload: { symbol: 'TSLA', price: 1, change_pct: 0, ts: 0 } }))
    expect(result.current.has('TSLA')).toBe(false)
  })

  it('unsubscribes on unmount', () => {
    mockFlag.mockReturnValue(true)
    const { unmount } = renderHook(() => useRealtimePrices(['AAPL']))
    unmount()
    expect(mockChannel.unsubscribe).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test src/lib/hooks/__tests__/useRealtimePrices.test.ts
```

Expected: `Cannot find module '../useRealtimePrices'` and `Cannot find module '@/lib/posthog/client'`.

- [ ] **Step 3: Implement client-side flag helper**

```typescript
// src/lib/posthog/client.ts
import posthog from 'posthog-js'

/** Returns the boolean value of a flag, or `false` if PostHog is uninitialized. */
export function isFeatureEnabled(key: string): boolean {
  // posthog-js exposes __loaded after init; before that, `getFeatureFlag` is unsafe.
  if (!(posthog as any).__loaded) return false
  const value = posthog.getFeatureFlag(key)
  return value === true
}
```

- [ ] **Step 4: Implement `useRealtimePrices`**

```typescript
// src/lib/hooks/useRealtimePrices.ts
'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { isFeatureEnabled } from '@/lib/posthog/client'

export interface PriceUpdate {
  symbol: string
  price: number
  change_pct: number
  ts: number
}

/**
 * Subscribe to Supabase Realtime broadcasts on the `prices` channel and
 * return a Map<symbol, PriceUpdate> of latest values. Returns an empty map
 * when the `realtime_prices_enabled` PostHog flag is off or PostHog is
 * uninitialized — SWR polling continues independently as fallback.
 *
 * `symbols` should be stable across renders (memoise upstream).
 */
export function useRealtimePrices(symbols: string[]): Map<string, PriceUpdate> {
  const [updates, setUpdates] = useState<Map<string, PriceUpdate>>(new Map())
  const watchSet = useMemo(() => new Set(symbols), [symbols.join(',')])

  useEffect(() => {
    if (!isFeatureEnabled('realtime_prices_enabled')) return
    if (watchSet.size === 0) return

    const channel = supabase.channel('prices')
      .on('broadcast', { event: 'price_update' }, (msg: any) => {
        const u: PriceUpdate = msg.payload
        if (!u || typeof u.symbol !== 'string') return
        if (!watchSet.has(u.symbol)) return
        setUpdates(prev => {
          const next = new Map(prev)
          next.set(u.symbol, u)
          return next
        })
      })
      .subscribe()

    return () => {
      void channel.unsubscribe()
    }
  }, [watchSet])

  return updates
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test src/lib/hooks/__tests__/useRealtimePrices.test.ts
```

Expected: 5 PASS.

- [ ] **Step 6: Smoke-wire into one consumer (dashboard or portfolio page)**

> The hook's *consumer* integration is intentionally minimal in Phase 1: the deliverable is "Realtime channel working for at least 1 test portfolio" (spec §2.7 item 4). Pick the smallest existing component that already shows live prices (e.g., `src/components/dashboard/kpi-cards.tsx`) and merge `useRealtimePrices(heldSymbols)` values over the SWR-fetched prices. Do NOT refactor the SWR layer — overlay only.

Identify the consumer (depends on existing structure):

```bash
grep -rn "current_prices" src/components/dashboard/ src/components/portfolio/
```

Pick a single component, add:

```tsx
const realtime = useRealtimePrices(symbols)
const merged = symbols.map(s => realtime.get(s)?.price ?? swrData.prices[s])
```

- [ ] **Step 7: Manual verification**

```bash
pnpm dev &
# Open http://localhost:3000 with PostHog flag realtime_prices_enabled=ON.
# In another terminal, force the worker to publish:
curl -X POST "https://price-engine.<workers-subdomain>.workers.dev/__test/broadcast" \
  -d '{"symbol":"AAPL","price":999,"change_pct":1,"ts":'$(date +%s%3N)'}'
# Observe price flicker to 999 within ~1s.
kill %1
```

> If the worker has no `/__test/broadcast` route, add a temporary one behind `INTERNAL_KEY` for manual smoke testing only — remove before commit.

- [ ] **Step 8: Commit**

```bash
git add src/lib/posthog/client.ts src/lib/hooks/useRealtimePrices.ts src/lib/hooks/__tests__/useRealtimePrices.test.ts src/components/<chosen-consumer>.tsx
git commit -m "feat(realtime): useRealtimePrices hook + first consumer integration

Subscribes to Supabase Realtime prices channel; respects
realtime_prices_enabled flag. SWR polling remains as fallback. See
spec §2.5."
```

---

## Chunk 7: Internal `/admin/metrics` dashboard

Single page, accessible only to users with the `admin` role (already exists in the project's role system — verify via `src/lib/auth/roles.ts` or equivalent before starting). Server component fetches PostHog (cache_lookup events), Sentry (recent errors), and Cloudflare Analytics (cron health) in parallel, then renders.

> **Auth gate:** Block at the route level via the existing `(app)` layout group's role check. If the role system isn't already there, add a single guard inside the route that calls `redirect('/dashboard')` for non-admin users.

### Task 7.1: API route `GET /api/admin/metrics`

**Files:**
- Create: `src/app/api/admin/metrics/route.ts`
- Create: `src/lib/services/admin-metrics.ts`
- Test: `src/lib/services/__tests__/admin-metrics.test.ts`

- [ ] **Step 1: Write failing test for the service aggregator**

```typescript
// src/lib/services/__tests__/admin-metrics.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockPosthog = vi.fn()
const mockSentry = vi.fn()
const mockCron = vi.fn()

vi.mock('@/lib/services/posthog-query', () => ({ queryCacheHitRatios: () => mockPosthog() }))
vi.mock('@/lib/services/sentry-query', () => ({ queryOpenIssues: () => mockSentry() }))
vi.mock('@/lib/services/cron-status', () => ({ queryCronHealth: () => mockCron() }))

import { collectAdminMetrics } from '../admin-metrics'

describe('collectAdminMetrics', () => {
  it('aggregates from all 3 sources in parallel', async () => {
    mockPosthog.mockResolvedValue({ analytics_risk: 0.82, price: 0.91 })
    mockSentry.mockResolvedValue([{ id: 's1', title: 'boom', count: 12 }])
    mockCron.mockResolvedValue([{ name: 'sectors-cron', last_run: '2026-04-20', ok: true }])

    const m = await collectAdminMetrics()
    expect(m.cache_hit_ratios).toEqual({ analytics_risk: 0.82, price: 0.91 })
    expect(m.open_issues).toHaveLength(1)
    expect(m.cron_health).toHaveLength(1)
  })

  it('returns degraded sentinel on partial failure (does not throw)', async () => {
    mockPosthog.mockResolvedValue({ price: 0.9 })
    mockSentry.mockRejectedValue(new Error('sentry down'))
    mockCron.mockResolvedValue([])
    const m = await collectAdminMetrics()
    expect(m.cache_hit_ratios.price).toBe(0.9)
    expect(m.open_issues).toEqual([])
    expect(m.errors).toContain('sentry')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test src/lib/services/__tests__/admin-metrics.test.ts
```

Expected: `Cannot find module '../admin-metrics'` and the three mock targets.

- [ ] **Step 3: Implement service**

```typescript
// src/lib/services/admin-metrics.ts
import { queryCacheHitRatios } from './posthog-query'
import { queryOpenIssues } from './sentry-query'
import { queryCronHealth } from './cron-status'

export interface AdminMetrics {
  cache_hit_ratios: Record<string, number>
  open_issues: Array<{ id: string; title: string; count: number }>
  cron_health: Array<{ name: string; last_run: string; ok: boolean }>
  errors: string[]
}

export async function collectAdminMetrics(): Promise<AdminMetrics> {
  const errors: string[] = []
  const [posthog, sentry, cron] = await Promise.allSettled([
    queryCacheHitRatios(),
    queryOpenIssues(),
    queryCronHealth(),
  ])

  if (posthog.status === 'rejected') errors.push('posthog')
  if (sentry.status === 'rejected') errors.push('sentry')
  if (cron.status === 'rejected') errors.push('cron')

  return {
    cache_hit_ratios: posthog.status === 'fulfilled' ? posthog.value : {},
    open_issues: sentry.status === 'fulfilled' ? sentry.value : [],
    cron_health: cron.status === 'fulfilled' ? cron.value : [],
    errors,
  }
}
```

- [ ] **Step 4: Stub the three query helpers (real implementations follow in Step 5)**

```typescript
// src/lib/services/posthog-query.ts
export async function queryCacheHitRatios(): Promise<Record<string, number>> {
  const projectId = process.env.POSTHOG_PROJECT_ID
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
  if (!projectId || !apiKey) return {}
  const url = `${process.env.NEXT_PUBLIC_POSTHOG_HOST}/api/projects/${projectId}/query`
  const body = {
    query: {
      kind: 'HogQLQuery',
      query: `
        SELECT
          properties.key_prefix AS prefix,
          countIf(properties.hit) / count() AS hit_ratio
        FROM events
        WHERE event = 'cache_lookup'
          AND timestamp > now() - INTERVAL 24 HOUR
        GROUP BY prefix
      `,
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`posthog query ${res.status}`)
  const json: any = await res.json()
  const out: Record<string, number> = {}
  for (const row of json.results ?? []) {
    out[row[0]] = Number(row[1])
  }
  return out
}

// src/lib/services/sentry-query.ts
export async function queryOpenIssues(): Promise<Array<{ id: string; title: string; count: number }>> {
  const token = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  if (!token || !org || !project) return []
  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?statsPeriod=24h&limit=10&query=is:unresolved`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`sentry ${res.status}`)
  const list: any[] = await res.json()
  return list.map(i => ({ id: i.id, title: i.title, count: Number(i.count ?? 0) }))
}

// src/lib/services/cron-status.ts
export async function queryCronHealth(): Promise<Array<{ name: string; last_run: string; ok: boolean }>> {
  // Sourced from worker logs aggregated into Supabase by an existing cron_runs
  // table (see analytics overhaul plan §A1) OR by parsing wrangler logs API.
  // Phase 1 simplification: read from cron_runs (created in migration 007).
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb
    .from('cron_runs')
    .select('name, started_at, ok')
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []).map(r => ({ name: r.name, last_run: r.started_at, ok: !!r.ok }))
}
```

> **Verify before merging:** `cron_runs` table existence. The analytics overhaul plan adds it in migration 007. If absent in your branch, replace `queryCronHealth` body with a stub that returns `[]` until that table lands.

```bash
grep -rn "CREATE TABLE.*cron_runs" supabase/migrations/
```

If no match: replace body of `queryCronHealth` with `return []` and add a TODO referencing the analytics overhaul migration.

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test src/lib/services/__tests__/admin-metrics.test.ts
```

Expected: 2 PASS.

- [ ] **Step 6: Implement the API route with Sentry + auth**

```typescript
// src/app/api/admin/metrics/route.ts
import { apiHandler } from '@/lib/api/handler'
import { json, error } from '@/lib/api/response'
import { collectAdminMetrics } from '@/lib/services/admin-metrics'
import { createServerClient } from '@/lib/supabase/server'

export const GET = apiHandler(async (req) => {
  const supabase = await createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return error('unauthorized', 401)

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return error('forbidden', 403)

  const metrics = await collectAdminMetrics()
  return json(metrics)
})
```

> Confirm the actual import paths for `createServerClient` and the role column name in `user_profiles`. If the project uses a different role-check helper, use it instead.

- [ ] **Step 7: Add env vars to `.env.local.example`**

```bash
cat >> .env.local.example <<'EOF'

# ── Phase 1 — Admin metrics (read-only API tokens) ───────────────────
POSTHOG_PROJECT_ID=
POSTHOG_PERSONAL_API_KEY=
EOF
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/admin-metrics.ts src/lib/services/posthog-query.ts src/lib/services/sentry-query.ts src/lib/services/cron-status.ts src/lib/services/__tests__/admin-metrics.test.ts src/app/api/admin/metrics/route.ts .env.local.example
git commit -m "feat(admin): /api/admin/metrics aggregator (PostHog + Sentry + cron health)

Promise.allSettled so partial failures degrade gracefully (errors[]
field surfaces which source). Admin role required. See spec §2.6."
```

### Task 7.2: Page `/admin/metrics`

**Files:**
- Create: `src/app/(app)/admin/metrics/page.tsx`

- [ ] **Step 1: Write the page (server component — no test, smoke-only)**

```tsx
// src/app/(app)/admin/metrics/page.tsx
import { redirect } from 'next/navigation'
import { collectAdminMetrics } from '@/lib/services/admin-metrics'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'   // always fetch fresh

export default async function AdminMetricsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/metrics')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const metrics = await collectAdminMetrics()

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Métricas internas</h1>

      {metrics.errors.length > 0 && (
        <div className="rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm">
          Fuentes con error: {metrics.errors.join(', ')} (datos parciales)
        </div>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">Cache hit ratio (24h)</h2>
        <table className="w-full border text-sm">
          <thead><tr><th className="border p-2 text-left">Prefijo</th><th className="border p-2 text-right">Ratio</th></tr></thead>
          <tbody>
            {Object.entries(metrics.cache_hit_ratios).map(([k, v]) => (
              <tr key={k}><td className="border p-2 font-mono">{k}</td><td className="border p-2 text-right">{(v * 100).toFixed(1)}%</td></tr>
            ))}
            {Object.keys(metrics.cache_hit_ratios).length === 0 && (
              <tr><td className="border p-2" colSpan={2}>Sin datos</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Sentry — issues abiertas (top 10)</h2>
        <ul className="space-y-1 text-sm">
          {metrics.open_issues.map(i => (
            <li key={i.id} className="flex justify-between border-b py-1">
              <span className="truncate">{i.title}</span>
              <span className="font-mono">{i.count}</span>
            </li>
          ))}
          {metrics.open_issues.length === 0 && <li className="text-muted-foreground">Sin errores abiertos</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Crons (últimos 20)</h2>
        <table className="w-full border text-sm">
          <thead><tr><th className="border p-2 text-left">Cron</th><th className="border p-2 text-left">Última ejecución</th><th className="border p-2">Estado</th></tr></thead>
          <tbody>
            {metrics.cron_health.map((c, i) => (
              <tr key={`${c.name}-${i}`}>
                <td className="border p-2 font-mono">{c.name}</td>
                <td className="border p-2">{new Date(c.last_run).toLocaleString('es-MX')}</td>
                <td className="border p-2 text-center">{c.ok ? '✅' : '❌'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Manual smoke**

```bash
pnpm dev &
sleep 5
# Sign in as admin user, then:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/metrics
kill %1
```

Expected: `307` (redirect when no session in the curl call) or `200` (when authed). For a more complete check, open in browser logged in as admin.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/admin/metrics/page.tsx
git commit -m "feat(admin): /admin/metrics dashboard page (server component)

Renders cache hit ratios, open Sentry issues, cron health. Admin-only.
Errors[] fallback shown if any source degrades. See spec §2.6."
```

---

## Chunk 8: Playwright — chromium-only smoke harness

Phase 1 ships exactly one E2E spec (login → dashboard → no console errors / no Sentry events captured). The harness is wired so Phase 2 / Phase 3 specs can land in their own commits without re-doing infrastructure.

> **Decision (Q2):** chromium-only. Adding webkit/firefox would require keeping `playwright.config.ts` `projects` and the `playwright install` command in sync — extra cost with no current return. Revisit when a real cross-browser issue surfaces.

### Task 8.1: Install Playwright + config + .gitignore

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Add scripts to `package.json`**

```json
"scripts": {
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui",
  "e2e:report": "playwright show-report"
}
```

- [ ] **Step 3: Create `playwright.config.ts`**

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',     // trace once retried — keeps disk usage low
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Q2 scope: chromium only. Add webkit/firefox here AND update the
    // `playwright install` line in CI when a cross-browser issue surfaces.
  ],
  webServer: process.env.CI
    ? undefined
    : { command: 'pnpm dev', url: baseURL, reuseExistingServer: true, timeout: 60_000 },
})
```

- [ ] **Step 4: Add gitignore entries**

```bash
cat >> .gitignore <<'EOF'

# Playwright
playwright-report/
test-results/
/playwright/.cache/
EOF
```

- [ ] **Step 5: Commit harness**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts .gitignore
git commit -m "chore(test): install Playwright (chromium-only), add config + gitignore"
```

### Task 8.2: Phase 1 smoke spec — `tests/e2e/smoke.spec.ts`

**Files:**
- Create: `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/fixtures/auth.ts`

- [ ] **Step 1: Add an auth fixture (test user via env)**

```typescript
// tests/e2e/fixtures/auth.ts
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const email = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!email || !password) {
      throw new Error('E2E_USER_EMAIL / E2E_USER_PASSWORD must be set')
    }
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/contraseña|password/i).fill(password)
    await page.getByRole('button', { name: /entrar|iniciar|sign in/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
    await use(page)
  },
})

export { expect }
```

> The selectors above are tentative — verify against the actual `src/app/(auth)/login/page.tsx` markup. If the form uses different labels, update the fixture in this same task.

- [ ] **Step 2: Write the spec**

```typescript
// tests/e2e/smoke.spec.ts
import { test, expect } from './fixtures/auth'

test.describe('Phase 1 smoke', () => {
  test('login → dashboard renders without console errors', async ({ authedPage: page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    await expect(page).toHaveURL(/\/dashboard/)
    // Wait for the dashboard primary KPI to render
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 10_000 })

    // Allow noise from PostHog/Sentry network waivers — filter known benign:
    const blockedPatterns = [
      /Failed to load resource/i,        // 404s on optional preview assets
      /sentry\.io.*ingest/i,             // Sentry CORS during dev
    ]
    const real = errors.filter(e => !blockedPatterns.some(p => p.test(e)))
    expect(real, `unexpected console errors:\n${real.join('\n')}`).toEqual([])
  })

  test('cookie banner shown on first visit, hidden after accept', async ({ page }) => {
    await page.goto('/')
    const banner = page.getByRole('region', { name: /cookies/i })
    await expect(banner).toBeVisible()
    await page.getByRole('button', { name: /aceptar/i }).click()
    await expect(banner).toBeHidden()
    // Reload — banner stays hidden (consent persisted)
    await page.reload()
    await expect(page.getByRole('region', { name: /cookies/i })).toBeHidden()
  })
})
```

- [ ] **Step 3: Run locally**

```bash
E2E_USER_EMAIL='e2e@investtracker.local' E2E_USER_PASSWORD='<seeded-password>' pnpm e2e
```

Expected: 2 PASS. If the test user doesn't exist yet, seed via Supabase Studio (one-off; document in `docs/runbooks/health-checks.md` Step 9.2 of this plan).

- [ ] **Step 4: Commit smoke spec**

```bash
git add tests/e2e/smoke.spec.ts tests/e2e/fixtures/auth.ts
git commit -m "test(e2e): Phase 1 smoke — login → dashboard + cookie banner persistence

Console-error budget enforced (filters known benign patterns). Run with
E2E_USER_EMAIL / E2E_USER_PASSWORD against a seeded test account."
```

### Task 8.3: GitHub Actions — smoke on PR + nightly E2E

**Files:**
- Modify: `.github/workflows/ci.yml` (or create if absent)

- [ ] **Step 1: Inspect existing workflow**

```bash
ls .github/workflows/
cat .github/workflows/ci.yml 2>/dev/null | head -60
```

- [ ] **Step 2: Add or extend the workflow**

```yaml
# .github/workflows/ci.yml — add these jobs (merge with existing)
jobs:
  # ... existing lint/test/build jobs unchanged ...

  e2e-smoke:
    name: E2E smoke (PR)
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - name: Wait for Vercel preview
        # Use vercel/preview-url-action or rely on gh deployment status — concrete
        # mechanism depends on existing deploy setup; skeleton:
        id: preview
        run: echo "url=https://placeholder" >> $GITHUB_OUTPUT
      - name: Run smoke
        env:
          PLAYWRIGHT_BASE_URL: ${{ steps.preview.outputs.url }}
          E2E_USER_EMAIL: ${{ secrets.E2E_USER_EMAIL }}
          E2E_USER_PASSWORD: ${{ secrets.E2E_USER_PASSWORD }}
        run: pnpm e2e tests/e2e/smoke.spec.ts
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  e2e-nightly:
    name: E2E nightly (full)
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - env:
          PLAYWRIGHT_BASE_URL: ${{ secrets.PRODUCTION_URL }}
          E2E_USER_EMAIL: ${{ secrets.E2E_USER_EMAIL }}
          E2E_USER_PASSWORD: ${{ secrets.E2E_USER_PASSWORD }}
        run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report-nightly, path: playwright-report/ }
      - if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `E2E nightly failed — ${new Date().toISOString().slice(0,10)}`,
              body: 'Trace artifact attached to the workflow run.',
              labels: ['e2e','nightly']
            })

on:
  pull_request:
  schedule:
    - cron: '0 6 * * *'    # nightly 06:00 UTC
```

> **Preview URL discovery** depends on the project's existing Vercel integration. If the repo already has a preview-comment bot, parse `${{ github.event.pull_request.head.sha }}` from the bot's deployment URL. If not, use the official `vercel/preview-action` or the manual `vercel pull`/`vercel build`/`vercel deploy --prebuilt --yes` flow inside the job. Pick one before merging this workflow.

- [ ] **Step 3: Add the secrets in GitHub repo Settings → Secrets**

(`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `PRODUCTION_URL`. Document in `docs/runbooks/health-checks.md`.)

- [ ] **Step 4: Commit workflow**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Playwright smoke (PR) + nightly full E2E

Smoke runs on PRs against Vercel preview URL. Nightly runs against
production at 06:00 UTC and auto-creates a GitHub issue on failure
with the trace artifact attached. See spec §5.3 / §5.4."
```

---

## Chunk 9: Closing slice — runbooks, deploy, verification

Final mile: ship the remaining runbooks (Sentry, secret-rotation, health-checks), add Sentry source-map upload to CI, deploy production, and run the verification checklist that satisfies spec §2.7's 7 items.

### Task 9.1: Sentry runbook

**Files:**
- Create: `docs/runbooks/sentry.md`

- [ ] **Step 1: Write runbook**

```bash
mkdir -p docs/runbooks
cat > docs/runbooks/sentry.md <<'EOF'
# Sentry runbook

## Projects + environments

Single Sentry org `investtracker`. One Next.js project (`web`) and one
Cloudflare Worker project (`price-engine`). Environments per project:

- `web` — `production` (Vercel main deploy), `preview` (Vercel PR builds)
- `price-engine` — `worker-prod`, `worker-dev`
- *Phase 2 will add `python-quant` env on a third project.*

## Quotas + sample rates

| Project | Errors/month | Trace rate |
|---------|--------------|------------|
| web (production) | unlimited (paid) | 10% |
| web (preview) | shared | 100% |
| price-engine (prod) | unlimited | 10% |
| price-engine (dev) | shared | 100% |

Hard alert: > 1,000 errors/h per project (spec §5.5). Triage in #alerts.

## beforeSend filters

`sentry.client.config.ts` drops:
- `AbortError` from SWR navigation cancellations
- Browser extension noise (frames containing `extension://`)

`sentry.server.config.ts` keeps Supabase RLS denials but tags
`kind=rls_denied` for separate triage.

## Source maps

Uploaded via `withSentryConfig` during `pnpm build`. CI step needs
`SENTRY_AUTH_TOKEN` (from org Settings → Auth Tokens, scopes:
project:write + project:releases). Token rotation: annual.

## On-call triage

1. Sort by frequency × users affected.
2. RLS-denied: check whether the user lacks the role they should have, or
   whether the route is asking for too much.
3. Worker errors: check `cron` tag — sectors / dividends / earnings /
   news; rate-limit 429s are expected during free-tier saturation.
4. Realtime errors: usually network — check Supabase status page.

## Future hardening

- Wire `x-user-id` propagation from API routes to handler so
  `Sentry.setUser` always has the real authenticated id (currently
  defensive — null when header missing).
- Add OpenTelemetry instrumentation for cross-service traces once Phase
  2 Modal calls land.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/sentry.md
git commit -m "docs(runbook): sentry — projects, quotas, beforeSend, on-call triage"
```

### Task 9.2: Secret-rotation runbook (initial template)

**Files:**
- Create: `docs/runbooks/secret-rotation.md`

- [ ] **Step 1: Write template**

```bash
cat > docs/runbooks/secret-rotation.md <<'EOF'
# Secret rotation runbook

## Schedule (per spec §5.2)

| Secret | Rotation cadence |
|--------|------------------|
| ANTHROPIC_API_KEY | Quarterly |
| QUANT_SERVICE_HMAC_KEY | Quarterly |
| INTERNAL_KEY (Worker ↔ Next.js) | Quarterly |
| SUPABASE_SERVICE_ROLE_KEY | Annual |
| UPSTASH_REDIS_REST_TOKEN | Annual |
| SENTRY_AUTH_TOKEN | Annual |
| RESEND_API_KEY | Annual |
| WEB_PUSH_VAPID_PRIVATE_KEY | NEVER (breaks subscriptions) |

## Procedure (single secret)

1. Generate new value at the issuing service (Supabase / Anthropic / etc.).
2. **Two-key window:** add new value alongside old in Vercel (`SECRET_NEW`)
   and rotate code to read new first, fall back to old. Deploy.
3. Wait for any in-flight requests using the old key to drain (≥ 5 min).
4. Remove old key from Vercel env. Remove fallback code. Deploy.
5. Revoke old key at issuing service.
6. Append entry to bitácora at bottom of this file.

## RLS sanity check (Phase 1 invariant)

The four market-data tables added in migration 008 must keep RLS enabled.
Run during the next rotation:

```sql
SELECT relname FROM pg_class
WHERE relname IN ('company_profile','dividend_calendar','earnings_calendar','news_items')
  AND relrowsecurity = false;
```

Expected: zero rows. If any row returns, re-apply the `ALTER TABLE … ENABLE
ROW LEVEL SECURITY` lines from migration 008 immediately.

## Bitácora

| Date | Secret | Rotated by |
|------|--------|------------|
| (none yet) | | |
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/secret-rotation.md
git commit -m "docs(runbook): secret-rotation — schedule, procedure, RLS invariant check"
```

### Task 9.3: Health-checks runbook

**Files:**
- Create: `docs/runbooks/health-checks.md`

- [ ] **Step 1: Write runbook**

```bash
cat > docs/runbooks/health-checks.md <<'EOF'
# Health checks runbook

Per-service status check matrix. Run end-to-end before declaring an
incident resolved or before promoting a deploy past beta.

## Service matrix

| Service | Healthy signal | Where to look |
|---------|----------------|---------------|
| Vercel (web) | 200 from `/` | https://app.investtracker.com |
| Cloudflare Worker | 200 from `/health` | `https://price-engine.<sub>.workers.dev/health` |
| Supabase Postgres | `select 1` succeeds | Supabase dashboard → Database → Query |
| Supabase Auth | new session can be created | curl `/auth/v1/token?grant_type=password` |
| Supabase Realtime | `prices` channel returns SUBSCRIBED | DevTools console: `supabase.channel('prices').subscribe(s => console.log(s))` |
| Upstash Redis | `PING` returns `PONG` | Upstash console → CLI |
| Sentry ingest | recent event landed (any env) | Sentry → Issues → All projects, last 1h |
| PostHog ingest | recent event landed | PostHog → Activity, last 1h |
| Worker cron — sectors | `company_profile` rowcount > 0 | `select count(*) from company_profile` |
| Worker cron — dividends | `dividend_calendar` rowcount > 0 (next 90d) | SQL |
| Worker cron — earnings | `earnings_calendar` rowcount > 0 (next 4w) | SQL |
| Worker cron — news | `news_items` rowcount in last 2h > 0 | SQL |
| Realtime broadcast | hook receives a `price_update` within 30s | Open `/dashboard` with flag ON |

## E2E test account

The Playwright smoke spec needs a seeded test account:

- Email: `e2e@investtracker.local`
- Password: stored in GitHub Actions secret `E2E_USER_PASSWORD`
- Created via Supabase Studio → Auth → Add user. Confirm email manually.
- Has at least one portfolio with one position so `/dashboard` renders KPIs.

If the account is wiped, re-create with the same email and update the
secret to the new password.

## Cron schedule note (DST)

Worker crons use **UTC** time. The earnings cron `0 9 * * 1-5` fires at
09:00 UTC, which is 04:00 / 05:00 ET depending on DST — earlier than the
spec's nominal "9 AM ET". Acceptable for Q2 (review acknowledged this).
If a Phase 3 alert times out due to drift, switch to a Vercel Cron
(timezone-aware) or duplicate the trigger at 13:00 / 14:00 UTC.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/health-checks.md
git commit -m "docs(runbook): health-checks — per-service matrix + E2E account + DST note"
```

### Task 9.4: Update worker/ARCHITECTURE.md with new crons

**Files:**
- Modify: `worker/ARCHITECTURE.md`

- [ ] **Step 1: Append a Phase 1 expansion section**

```bash
cat >> worker/ARCHITECTURE.md <<'EOF'

## Phase 1 expansion (2026-04-20)

### New crons

| Cron | Function | Target table |
|------|----------|--------------|
| `0 */1 * * *` | `runSectorsCron` (Twelve Data /profile) | `company_profile` |
| `0 */4 * * *` | `runDividendsCron` (Finnhub /calendar/dividend, 90d) | `dividend_calendar` |
| `0 9 * * 1-5` | `runEarningsCron` (Finnhub /calendar/earnings, 4w) | `earnings_calendar` |
| `*/30 * * * *` | `runNewsIngestion` (Finnhub /company-news, 24h × top 50) — runs alongside warm prices | `news_items` |

Each cron is implemented as a pure `(supabase, fetcher) → Promise<{processed, skipped}>`
function for testability; the production fetchers are `make…Fetcher(apiKey)` factories
in the same file. See `worker/src/__tests__/` for fixtures.

### Realtime broadcast

After each price upsert (`fetchHotPrices` / `fetchWarmPrices`),
`publishPriceUpdates` POSTs to Supabase Realtime `/api/broadcast` for
the `prices` channel. Best-effort: errors log and continue; SWR polling
remains source of truth.

### Sentry

Worker entrypoint wrapped with `withSentry`. Two environments:
`worker-dev` (default) and `worker-prod` (set in `wrangler.toml`
`[env.production].vars`). 10% trace sample in production.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add worker/ARCHITECTURE.md
git commit -m "docs(worker): architecture — Phase 1 crons + realtime + Sentry sections"
```

### Task 9.5: Production deploy + verification

**Files:** none (operational)

- [ ] **Step 1: Deploy migration 008 + 008b to production Supabase**

Use Supabase dashboard → SQL editor → paste contents of:

```bash
cat supabase/migrations/008_worker_expansion.sql
cat supabase/migrations/008b_top_symbols_rpc.sql
```

Apply each in order. Re-run the verification queries from Task 1.1 Step 4–6.

- [ ] **Step 2: Push secrets to Worker production**

```bash
cd worker
echo "$SENTRY_DSN_FOR_WORKER" | wrangler secret put SENTRY_DSN --env production
# Other secrets (TWELVE_DATA_API_KEY, FINNHUB_API_KEY, SUPABASE_SERVICE_ROLE_KEY) should already be set; verify:
wrangler secret list --env production
cd ..
```

- [ ] **Step 3: Deploy Worker**

```bash
cd worker && wrangler deploy --env production && cd ..
```

Expected: deployment succeeds. `wrangler tail --env production` shows the new cron handlers firing within their next windows.

- [ ] **Step 4: Push Vercel env vars + deploy**

In Vercel UI → project Settings → Environment Variables, add:

```
NEXT_PUBLIC_SENTRY_DSN
SENTRY_DSN
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
POSTHOG_PROJECT_ID
POSTHOG_PERSONAL_API_KEY
```

Trigger a production deploy (push to `master` or `vercel --prod`).

- [ ] **Step 5: Verify Phase 1 closing-slice checklist (spec §2.7)**

Tick each item:

- [ ] Sentry capturing errors in Next.js + Worker — open Sentry → both projects show recent events from the test traffic
- [ ] PostHog capturing events + 1 working flag — flip `quant_engine_enabled` ON for own user, verify exposure registers
- [ ] Cookie banner gates PostHog — clear localStorage in production, reload, verify no PostHog requests until Accept
- [ ] Four new tables populated — run `select count(*) from company_profile / dividend_calendar / earnings_calendar / news_items`
- [ ] news_items Phase 3 columns present and nullable — `\d news_items` in psql shows all 7 classifier columns
- [ ] Realtime channel working for at least 1 test portfolio — open `/dashboard`, observe price flicker after Worker fires
- [ ] `/admin/metrics` shows real data — sign in as admin, verify cache ratios + Sentry issues + cron health populate
- [ ] Playwright smoke passes locally and in CI nightly — `pnpm e2e` green; check Actions tab for nightly green
- [ ] `docs/runbooks/health-checks.md` published — file exists on `master`

- [ ] **Step 6: Tag release**

```bash
git tag -a v0.q2-phase1 -m "Q2 Phase 1 — Foundation & Worker expansion shipped"
git push origin v0.q2-phase1
```

- [ ] **Step 7: Bitácora — append to Obsidian Roadmap note**

```bash
# Done outside the repo; via obsidian CLI:
obsidian append file="Roadmap Q2 2026" content="- 2026-MM-DD — Phase 1 (Foundation) shipped. Sentry + PostHog en producción, 4 nuevas tablas pobladas por crons, /admin/metrics funcionando, Playwright smoke en CI nightly. Tag v0.q2-phase1."
```

(Substitute the actual ship date.)

- [ ] **Step 8: Final commit if any docs were touched in verification**

```bash
git add -A
git diff --cached --quiet || git commit -m "docs: Phase 1 verification touch-ups"
```

---

## Phase 1 done criteria recap

From spec §2.7, all 7 items must be ticked in Task 9.5 Step 5. From spec §5.7, every new API route added in this phase (`/api/admin/metrics`) must satisfy items 1–12 of the operational checklist — verify before tagging.

**Next:** Phase 2 plan (Quant Engine) — `docs/superpowers/plans/2026-04-20-q2-phase2-quant-engine-plan.md`.



