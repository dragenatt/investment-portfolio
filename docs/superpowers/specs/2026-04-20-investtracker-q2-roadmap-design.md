# InvestTracker Q2 2026 Roadmap — Quant Engine, Smart Alerts & Platform

**Date:** 2026-04-20
**Status:** Draft (pending review)
**Duration:** 6 weeks (3 phases of 2 weeks)
**Scope:** Quantitative optimization (A2), smart alerts and anomaly detection (A4), platform observability and worker expansion (B)
**Architecture:** Hybrid TypeScript + Python (option Z)

---

## Executive summary

InvestTracker is a mature Next.js 16 + Supabase application with a Cloudflare Worker price engine, Upstash Redis caching, PWA support, i18n, and analytics. This roadmap adds three intertwined capability layers, executed foundation-first in three two-week phases:

1. **Phase 1 — Foundation/Observability (Weeks 1-2):** Sentry across stack, PostHog product analytics + flags + replay, cache hit metrics, Cloudflare Worker expansion (sectors, dividends, earnings, news ingestion), Supabase Realtime price push, internal admin metrics dashboard.
2. **Phase 2 — Quantitative engine (Weeks 3-4):** Python microservice on Modal with FastAPI + numpy/scipy/cvxpy/riskfolio-lib/empyrical, exposing optimize/monte-carlo/factors/rebalance endpoints. Companion TypeScript library `@/lib/quant` for lightweight metrics. Vertical slice: full Smart Rebalance UI at `/portfolio/[id]/optimize`.
3. **Phase 3 — Intelligence layer (Weeks 5-6):** Anomaly detection engine (statistical, runs in Worker), news classifier (Anthropic Claude Haiku 4.5 with prompt caching), predictive alerts (earnings/dividends), daily insights (Claude Sonnet 4.6), multi-channel delivery (in-app, email, Web Push).

Each phase ends with a deployable vertical slice. Total estimated added monthly cost at **~500 total users (~100 of which are daily-active)**: ~$59. Cost projection uses the daily-active figure for Sonnet insights and total users for Sentry/PostHog/Modal — see Section 5.5 table for the breakdown.

---

## Section 1 — Architecture overview

### 1.1 Component map

```
                     ┌─────────────────────────────────────────┐
                     │         USER (Browser/PWA)              │
                     │   Next.js 16 + React 19 + Service Worker│
                     └────────────────┬────────────────────────┘
                                      │
                       ┌──────────────┼─────────────────────┐
                       │              │                      │
                       │         (Web Push)            (SWR + Realtime)
                       │              │                      │
                       ▼              │                      │
              ┌────────────────┐      │                      │
              │  Vercel Edge   │      │                      │
              │  (Next.js 16)  │      │                      │
              │                │      │                      │
              │  • API routes  │      │                      │
              │  • RSC pages   │      │                      │
              │  • Sentry SDK  │      │                      │
              │  • PostHog SDK │      │                      │
              └───────┬────────┘      │                      │
                      │               │                      │
        ┌─────────────┼───────────────┼──────────────┐       │
        │             │               │              │       │
        ▼             ▼               ▼              ▼       │
  ┌──────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐ │
  │ Upstash  │ │  Supabase   │ │ Anthropic   │ │  Modal   │ │
  │  Redis   │ │  Postgres   │ │ Claude API  │ │ (Python) │ │
  │ (cache)  │ │  + Realtime │ │  + caching  │ │ FastAPI  │ │
  │          │ │  + Auth+RLS │ │             │ │ + scipy  │ │
  └──────────┘ └──────┬──────┘ └─────────────┘ │ + cvxpy  │ │
                      │                         │ + rfolio │ │
                      │                         └──────────┘ │
                      ▼                                       │
              ┌─────────────────────────────────────────┐    │
              │     CLOUDFLARE WORKER (existing)         │    │
              │     • /prices, /price/:sym (REST)        │    │
              │     • Cron: 5min hot, 30min warm, 12h    │    │
              │     ───── NEW IN PHASE 1 ─────           │◄───┘
              │     • Cron: 1h sectors, 4h dividends     │
              │     • Cron: 30min news (Finnhub)         │
              │     • Cron: daily earnings calendar      │
              │     • Cron: hourly anomaly scan (P3)     │
              │     • Sentry SDK                         │
              │     • Pushes to Supabase Realtime topics │
              └─────────────────────────────────────────┘
```

### 1.2 Architectural decisions

1. **Vercel as orchestrator.** Next.js API routes are the entry point for all user-facing operations. Modal and the Worker are called from API routes; the frontend never talks to them directly.
2. **Modal over Fly.io/Railway** for the Python service. Reasons: pure serverless (scales to zero), Python-native ergonomics (decorators), and the 2-3s cold start is acceptable because optimization is an explicit user action, not a page render. Estimated cost <$5/mo. Fallback if Modal proves unsuitable: Fly.io with Dockerfile.
3. **Supabase Realtime for price push** instead of polling. Worker publishes to `prices:{symbol}` channel after upsert. Frontend subscribes via `@supabase/supabase-js` (already installed). Reduces bandwidth and latency.
4. **Sentry across all runtimes** (Next.js + Worker + Python service) with one project but separated environments (`production`, `preview`, `worker`, `python-quant`). Single thread for cross-stack issue correlation.
5. **PostHog for everything non-error** — product analytics, feature flags, session replay, A/B testing. Replaces three separate tools. Cloud default; self-hosted possible if privacy demands.
6. **Anthropic Claude tiered usage:**
   - **Haiku 4.5** (`claude-haiku-4-5-20251001`) — high-volume news classification (~500/day) with prompt caching = ~10x cost reduction on cached portion.
   - **Sonnet 4.6** (`claude-sonnet-4-6`) — daily portfolio insights, narrative analysis.
   - **Opus 4.7** (`claude-opus-4-7`) — reserved for future "advisor" feature or complex macro reasoning.
7. **Zero runtime changes to existing stack.** No framework migration, no React downgrade, no edits to existing migrations. Additive-only.

### 1.3 Critical flows

**"Optimize my portfolio"** (Phase 2):
```
User → Click "Optimize" → Next.js API /api/portfolio/[id]/optimize
                          ├→ Read positions from Supabase
                          ├→ Read price_history (12 months)
                          ├→ POST to Modal /optimize with {returns, cov, constraints}
                          ├→ Modal runs cvxpy (1-3s)
                          └→ Return optimal weights + frontier + metrics
                             → Cache result 1h in Upstash
                             → Render UI with Recharts (frontier) + trade table
```

**"Anomaly alert"** (Phase 3):
```
Worker cron (hourly) →
  ├→ Read active positions + price history (last 60 days)
  ├→ Compute z-score per symbol
  ├→ If |z| > 2.5 → POST to Next.js /api/internal/anomalies/process
  ├→ Next.js → classify with Claude Haiku (real anomaly or expected vol?)
  ├→ If confirmed → insert into `alerts` table
  ├→ Supabase Realtime broadcasts to `alerts:{userId}` channel
  ├→ Frontend shows toast + badge
  └→ If user has web push enabled → send notification
```

### 1.4 Out of scope (explicit)

- Conversational assistant with tool use (was option A1, not selected)
- Long-form narrative daily insights (was A3; only mini-summary included in alerts)
- Real broker integrations / paper trading (was C, not selected)
- Copy-trading social features (was C)
- Major visual redesign (was D)
- Native mobile app
- New heavy frontend dependencies (preserve bundle size)

---

## Section 2 — Phase 1: Foundation & Worker expansion (Weeks 1-2)

### 2.1 Sentry (cross-stack error tracking)

**Setup:**
- Install `@sentry/nextjs` in Next.js project. Wizard generates `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`. 10% trace sample rate in production, 100% for errors.
- Install `@sentry/cloudflare` in the Worker. Initialize in both `fetch` and `scheduled` handlers.
- Single Sentry project with environments: `production`, `preview`, `worker-prod`, `worker-dev`. `python-quant` added in Phase 2.
- Enable Source Maps upload via Vercel build hook and `wrangler deploy` step.

**Integrations:**
- Auto-capture `userId` in all API routes via wrapper in `src/lib/api/handler.ts` (existing handler — add `Sentry.setUser`).
- Filter known non-actionable errors (e.g., `AbortError` from SWR on navigation) via `beforeSend` hook.
- Custom breadcrumbs for cache operations and Supabase queries.

**New dependencies:** `@sentry/nextjs`, `@sentry/cloudflare`.

### 2.2 PostHog (product analytics + flags + replay)

**Setup:**
- Install `posthog-js` (client, lazy-loaded to protect LCP) and `posthog-node` (server-side).
- Provider in `src/providers/posthog-provider.tsx` initialized only after the user accepts the **cookie consent banner** (`src/components/consent/CookieBanner.tsx`, new in Phase 1 — see deliverable 2.7). Consent stored in `localStorage` key `consent_v1` with values `accepted` | `declined` | unset. Until set, banner is shown and PostHog stays uninitialized. Sentry still loads (error tracking is legitimate-interest, not analytics).
- Auto-capture pageviews, clicks, form submissions. Custom events for: `portfolio_created`, `transaction_added`, `comparison_run`, `discover_filter_applied`, `share_clicked`.

**Feature flags (immediate use):**
- `quant_engine_enabled` — gates Phase 2 to beta users before GA.
- `smart_alerts_enabled` — gates Phase 3.
- `realtime_prices_enabled` — kill switch for Realtime channel.

**Session replay:** Enabled at 5% of authenticated sessions. Auto-mask inputs of type `password` and `email`.

**New dependencies:** `posthog-js`, `posthog-node`.

### 2.3 Cache metrics (Upstash visibility)

**Problem:** Today there's no observability into Redis hit/miss patterns.

**Solution:**
- Wrapper `cacheGetWithMetrics<T>(key)` around `cacheGet`, emits PostHog event `cache_lookup` with `{ key_prefix, hit, latency_ms }`.
- Progressively replace existing call sites (`compare/route.ts`, `discover/leaderboard/route.ts`, etc.).
- PostHog dashboard "Cache Performance" with hit ratio per prefix, p50/p95 latency.
- Alert if hit ratio < 50% in a 1h sustained window.

### 2.4 Worker expansion (data for A2 + A4)

The current Worker only fetches prices for positions and watchlists. A2 (factor analysis) and A4 (news classification) need additional background data.

**New crons in `worker/src/index.ts`:**

| Cron | Purpose | Target table |
|------|---------|--------------|
| `0 */1 * * *` (hourly, market hours) | Sectors: for each held symbol, fetch Twelve Data `/profile` (sector/industry/market cap) | `company_profile` (new) |
| `0 */4 * * *` (every 4h) | Dividends: Finnhub `/calendar/dividend` next 90 days | `dividend_calendar` (new) |
| `0 9 * * 1-5` (daily 9 AM ET) | Earnings: Finnhub `/calendar/earnings` next 4 weeks | `earnings_calendar` (new) |
| `*/30 * * * *` (every 30 min, market hours) | News: Finnhub `/company-news` last 24h for top 50 symbols by portfolio volume | `news_items` (new) |

**Migration 007:**
```sql
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

CREATE TABLE dividend_calendar (
  symbol TEXT,
  ex_date DATE,
  pay_date DATE,
  amount NUMERIC,
  currency TEXT,
  PRIMARY KEY (symbol, ex_date)
);

CREATE TABLE earnings_calendar (
  symbol TEXT,
  earnings_date DATE,
  hour TEXT,                -- 'bmo' | 'amc'
  eps_estimate NUMERIC,
  revenue_estimate NUMERIC,
  PRIMARY KEY (symbol, earnings_date)
);

CREATE TABLE news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  url TEXT UNIQUE,
  source TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  -- Phase 3 (classifier) will populate these. Schema lives here so the
  -- Phase 3 classifier ships without an additional migration:
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

-- RLS: market data tables are readable by all authenticated users; writes
-- only via service role (Worker/Next.js cron). Same policy pattern as
-- existing market tables in migration 006.
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_data_read" ON company_profile FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON dividend_calendar FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON earnings_calendar FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_data_read" ON news_items FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE: service role only (no policies = denied for non-service).
```

**Notes:**
- `news_items` is populated in Phase 1 but classified in Phase 3. By the time Phase 3 starts, there will be ~4 weeks of news for validation.
- The Worker only ingests; classification happens in Next.js (Anthropic SDK lives there).
- All Phase 3 classifier columns (`relevance`, `topics`, `summary_es`, `action_hint`, `impact_score`, `impact_label`) ship in this migration as nullable so the Phase 3 classifier can write them without a follow-up DDL change.

### 2.5 Supabase Realtime price push

**Solution:**
- After Worker upserts `current_prices`, publish to `prices` channel with `{ symbol, price, change_pct, ts }` via Supabase Realtime broadcast REST API.
- Hook `useRealtimePrices(symbols)` in `src/lib/hooks/` subscribes to user's positions and maintains a local Map<symbol, PriceUpdate> store consumed by SWR.
- Fallback: if Realtime fails (network, suspended), SWR continues polling at 60s intervals.
- Feature flag `realtime_prices_enabled` from PostHog as instant kill switch.

**Cost:** Supabase free tier includes 200 concurrent connections, 2M messages/mo — sufficient for current scale.

### 2.6 Internal `/admin/metrics` dashboard

Single page, RLS-protected by `admin` role:
- Cache hit ratio per prefix (24h, 7d) — sourced from PostHog API
- Open Sentry errors by area (top 10) — Sentry API
- Worker cron success/failure rate (`failed_fetches` table + Cloudflare Analytics API)
- Active users, sessions, key events (PostHog)
- Cron status (last run, latency, items processed)

Server component with direct API fetches. Internal-use only — not user-facing.

### 2.7 Phase 1 deliverable (closing slice)

End-of-phase production deployment:
1. Sentry capturing errors in Next.js + Worker
2. PostHog capturing key events + 1 working feature flag, gated by a **cookie consent banner** (`src/components/consent/CookieBanner.tsx`) that defers PostHog initialization until accept. If declined, PostHog never loads — Sentry still loads (legitimate-interest error tracking).
3. Four new tables populated with real data (verify in Supabase) — including the Phase-3-bound `news_items` columns from Migration 007 that ship empty.
4. Realtime channel working for at least 1 test portfolio
5. `/admin/metrics` showing real data
6. **Playwright** installed (`@playwright/test`, `playwright.config.ts`, `tests/e2e/`); Phase 1 smoke spec passes locally and in CI nightly.
7. `docs/runbooks/health-checks.md` published with the per-service status check matrix referenced in R3.

**Commit milestones:** ~7 independent PRs (one per component), each with tests where applicable.

### 2.8 Phase 1 risks

| Risk | Mitigation |
|------|------------|
| Sentry quota exceeded by noisy errors | Aggressive `beforeSend` filters, rate limit per fingerprint |
| PostHog impacts LCP | Lazy load + async script + Lighthouse before/after |
| Worker quota with new crons | Workers Free includes 100k req/day — crons use ~100/day. No risk. |
| Finnhub rate limit on news polling | Existing exponential backoff; tune batch size |

---

## Section 3 — Phase 2: Quantitative engine + Smart Rebalance (Weeks 3-4)

### 3.1 Python microservice on Modal

**Repo structure:**
```
quant-service/
  pyproject.toml
  modal_app.py             # Modal entry point
  src/
    __init__.py
    api.py                 # FastAPI app, routers
    auth.py                # HMAC validation
    schemas.py             # Pydantic models
    optimize.py            # Markowitz, efficient frontier
    monte_carlo.py         # Forward-looking simulations
    factors.py             # Factor regression
    rebalance.py           # Trade calculation
    metrics.py             # Empyrical wrappers
    data.py                # Input parsing helpers
    errors.py              # Exception types
  tests/
    test_optimize.py
    test_monte_carlo.py
    test_factors.py
    test_rebalance.py
    fixtures/              # Synthetic + real datasets
  README.md
  DEPLOYMENT.md
```

**Stack:**
- Modal as runtime (`@app.function(secrets=[...], image=...)`)
- FastAPI as HTTP framework
- Pydantic v2 for validation
- numpy + pandas + scipy.optimize
- cvxpy (convex optimization, the workhorse)
- riskfolio-lib (mean-variance, risk parity, HRP)
- empyrical (industry-standard performance metrics)
- pytest

**Why Modal:**
- Cold start ~2s for scipy/cvxpy image. Acceptable because optimization is explicit.
- Pay-per-CPU-second. Estimated <$5/mo raw + ~$2/mo for `keep_warm=1` (one always-warm replica) = baseline ~$7-8/mo for ~50-200 optimizations/day. The cost table in 5.5 assumes keep_warm is enabled by default; turning it off would save ~$2/mo at the cost of a 2s penalty on the first request after idle.
- Deploy: `modal deploy modal_app.py`. CI runs on push to `main` when `quant-service/` changes.
- Native web endpoints via `@modal.web_endpoint`. No load balancer or DNS provisioning needed.

### 3.2 Endpoint contracts

#### `POST /optimize`

**Request:**
```json
{
  "returns": {
    "AAPL": [0.001, -0.002, 0.005, ...],
    "MSFT": [0.002, 0.001, -0.003, ...]
  },
  "constraints": {
    "min_weight": 0.0,
    "max_weight": 0.30,
    "sector_caps": { "Technology": 0.50, "Energy": 0.20 },
    "target_return": 0.12,
    "risk_aversion": 2.0
  },
  "method": "mean_variance" | "risk_parity" | "hrp",
  "frontier_points": 50
}
```

**Response:**
```json
{
  "optimal_weights": { "AAPL": 0.25, "MSFT": 0.30 },
  "expected_return": 0.118,
  "expected_volatility": 0.16,
  "sharpe_ratio": 0.74,
  "frontier": [
    { "return": 0.05, "vol": 0.08, "weights": {} }
  ],
  "computed_at": "2026-04-20T15:30:00Z",
  "elapsed_ms": 847
}
```

#### `POST /monte-carlo`

**Request:**
```json
{
  "current_value": 50000,
  "weights": { "AAPL": 0.25 },
  "expected_returns": { "AAPL": 0.10 },
  "covariance": [[0.04, 0.02], [0.02, 0.05]],
  "horizon_days": 252,
  "n_simulations": 10000,
  "percentiles": [5, 25, 50, 75, 95]
}
```

**Response:**
```json
{
  "trajectories": {
    "p5":  [50000, 49800, ...],
    "p50": [50000, 50200, ...],
    "p95": [50000, 50500, ...]
  },
  "final_distribution": {
    "mean": 55000,
    "std": 8000,
    "var_95": 42000,
    "cvar_95": 39000
  },
  "probability_loss": 0.18,
  "elapsed_ms": 1230
}
```

#### `POST /factors`

**Request:**
```json
{
  "portfolio_returns": [0.001, -0.002],
  "factor_returns": {
    "MKT": [], "SMB": [], "HML": [], "RMW": [], "CMA": [], "MOM": []
  }
}
```

> **Contract:** all six factor return arrays MUST have the same length as `portfolio_returns`. Pydantic validates this at the Modal boundary; Zod validates it at the Next.js boundary before the request leaves. Mismatched lengths → 400 with error code `FACTOR_DIMENSION_MISMATCH`.

**Response:**
```json
{
  "loadings": { "MKT": 1.05, "SMB": 0.12, "HML": -0.30 },
  "alpha": 0.0008,
  "alpha_t_stat": 1.8,
  "r_squared": 0.87,
  "interpretation": {
    "tilt": "growth",
    "size_bias": "large_cap",
    "quality": "high"
  }
}
```

#### `POST /rebalance`

**Request:**
```json
{
  "current_holdings": { "AAPL": 100, "MSFT": 50 },
  "current_prices": { "AAPL": 175, "MSFT": 410 },
  "target_weights": { "AAPL": 0.30, "MSFT": 0.25, "GOOGL": 0.45 },
  "cash_available": 5000,
  "min_trade_value": 100,
  "transaction_cost_bps": 5
}
```

**Response:**
```json
{
  "trades": [
    { "symbol": "AAPL", "action": "buy", "shares": 12, "estimated_cost": 2100, "post_weight": 0.30 }
  ],
  "total_turnover": 9880,
  "estimated_costs": 4.94,
  "drift_before": 0.12,
  "drift_after": 0.005
}
```

### 3.3 Auth between Next.js and Modal

Modal endpoints are public by default. Validation via **HMAC**:
- Shared secret `QUANT_SERVICE_HMAC_KEY` in Vercel env + Modal secret.
- Next.js request includes header `X-Signature: hmac_sha256(body + timestamp, key)`.
- Modal validates and rejects if timestamp older than 5 min (replay protection).
- Wrapper in `src/lib/services/quant.ts` encapsulates this.

No user JWT propagation — Next.js validates auth/authorization before calling Modal.

### 3.3a Error envelope (TS ↔ Python contract)

All Modal endpoints return errors using a normalized JSON envelope so the Next.js wrapper can type-check against it once and surface consistent UX.

**Shape:**
```json
{
  "error": {
    "code": "CVXPY_INFEASIBLE",
    "message": "Optimization problem is infeasible under the given constraints.",
    "details": { "constraint_violated": "sector_caps.Energy", "value_attempted": 0.20 }
  }
}
```

**HTTP status mapping:**

| Status | Meaning | Example codes |
|--------|---------|---------------|
| 200 | Success | — |
| 400 | Validation error (bad input shape, dimension mismatch, NaN/Inf) | `FACTOR_DIMENSION_MISMATCH`, `WEIGHTS_DO_NOT_SUM_TO_ONE`, `COVARIANCE_NOT_POSITIVE_DEFINITE` |
| 401 | HMAC missing/invalid or timestamp expired | `HMAC_INVALID`, `HMAC_EXPIRED` |
| 422 | Computationally infeasible (problem well-formed but unsolvable) | `CVXPY_INFEASIBLE`, `MONTE_CARLO_DEGENERATE`, `INSUFFICIENT_HISTORY` |
| 429 | Rate limited (Modal-side) | `RATE_LIMITED` |
| 500 | Internal Python error (caught by FastAPI exception handler, sent to Sentry) | `INTERNAL_ERROR` |
| 503 | Service warming or dependency down | `COLD_START_TIMEOUT` |

The Next.js wrapper (`src/lib/services/quant.ts`) maps codes to user-facing strings via i18n keys (`quant.errors.<code>`); unknown codes fall back to a generic message + Sentry breadcrumb. Error responses always include `details` (object, may be empty) so error analytics can drill into root cause without re-fetching.

### 3.4 Python dependencies

```toml
[project]
dependencies = [
  "fastapi>=0.115",
  "pydantic>=2.9",
  "numpy>=2.1",
  "pandas>=2.2",
  "scipy>=1.14",
  "cvxpy>=1.5",
  "riskfolio-lib>=6.0",
  "empyrical>=0.5.5",
  "modal>=0.66",
  "sentry-sdk[fastapi]>=2.0"
]
```

### 3.5 TypeScript library `@/lib/quant`

```
src/lib/quant/
  index.ts
  metrics.ts           # Sharpe, Sortino, beta, alpha, max DD, calmar, info ratio
  correlation.ts       # Pearson + Spearman + rolling correlation matrix
  concentration.ts     # HHI, top-N exposure (move from services/concentration.ts)
  drift.ts             # L1 distance current vs target
  drawdown.ts          # Drawdown series + max DD
  __tests__/
    metrics.test.ts
```

**Design:**
- Pure functions, no I/O.
- No new heavy dependencies — use `Math.*` and reducers. `simple-statistics` only if it legitimately simplifies.
- Tests verify mathematical properties: Sharpe = 0 when r = rf; max DD = 0 for monotonic series; HHI = 1 for single-asset portfolio.

### 3.6 Next.js integration

**Service layer** (`src/lib/services/quant.ts`):
```typescript
export async function optimizePortfolio(
  portfolioId: string,
  options: OptimizeOptions
): Promise<OptimizeResult> {
  // 1. Fetch positions + price_history from Supabase (12 months)
  // 2. Build returns matrix
  // 3. POST to Modal /optimize with HMAC
  // 4. Cache result 1h in Upstash
  // 5. Insert audit row into `quant_runs` (request, response, elapsed_ms,
  //    cached=false; cached=true if step 4 hit). Required by done criteria 6.3.
  // 6. Return typed
}
```

> **Audit invariant:** every successful Modal call (and every cache hit serving a Modal-backed result) MUST insert into `quant_runs`. The same wrapper handles all four endpoints — there is no untracked path. The wrapper writes via service role so RLS does not interfere; the `quant_runs` row is keyed by `portfolio_id` and `user_id` so dashboards can filter.

**New API routes:**

| Route | Method | Body | Cache |
|-------|--------|------|-------|
| `/api/portfolio/[id]/optimize` | POST | `{ method, constraints }` | 1h |
| `/api/portfolio/[id]/monte-carlo` | POST | `{ horizon_days, n_simulations }` | 6h |
| `/api/portfolio/[id]/factors` | GET | — | 24h |
| `/api/portfolio/[id]/rebalance` | POST | `{ target_weights, cash_available }` | none |

All use existing handler with auth + Sentry breadcrumbs + rate limit.

### 3.7 Vertical slice: `/portfolio/[id]/optimize` UI

**Layout:** Two-column. Left: Recharts ScatterChart with current + optimal markers and frontier line. Right: constraints form (method dropdown, max weight slider, sector caps, target return). Below: comparison table (current vs optimal) with action column showing recommended trades. Footer: turnover summary, expected Sharpe vs current, "Export CSV" / "Create rebalance plan" buttons.

**Components** (`src/components/optimize/`):
- `EfficientFrontierChart.tsx` — Recharts ScatterChart with custom markers
- `ConstraintsForm.tsx` — react-hook-form + zod, shadcn sliders, dynamic sector caps
- `OptimalAllocationTable.tsx` — shadcn table with diff column, color-coded
- `RebalanceTradeList.tsx` — list with "Create transactions" action that pre-fills existing transactions modal
- `OptimizeSummary.tsx` — KPI cards (turnover, costs, expected vs current Sharpe)

**Interaction:**
1. Open page → SWR fetch defaults → render with skeleton.
2. Adjust constraint → **debounce on commit, not on change**: slider changes update local state; only the "Apply" button (or 1500ms idle after last change) triggers SWR mutate. Reason: cvxpy on Modal is metered per CPU-second; firing on every slider tick would multiply optimizer cost ~50× during a constraint exploration session.
3. "Create rebalance plan" → modal with editable trades → confirm → creates N rows in `transactions` table (reuses `services/transaction.ts`).
4. PostHog tracking on every action.

**Performance UX:**
- Loading skeleton during Modal call (1-3s typical).
- After 5s, show "Taking longer than usual..." banner with cancel button.
- Optional: prefetch last cached result on portfolio list entry.

**Feature flag:** Entire UI gated by `quant_engine_enabled`. Default off in production.

### 3.8 Phase 2 deliverable

1. `quant-service/` deployed on Modal with 4 endpoints + HMAC auth
2. `src/lib/quant/` with metric tests
3. 4 Next.js API routes orchestrating
4. Full UI `/portfolio/[id]/optimize` working for flagged users
5. Sentry capturing Python service errors
6. PostHog events: `optimize_run`, `rebalance_plan_created`, `monte_carlo_run`

### 3.9 Phase 2 risks

| Risk | Mitigation |
|------|------------|
| cvxpy fails to converge on degenerate inputs | scipy.optimize fallback, strict input validation (positive-definite cov matrix), clear error response |
| Few positions (N=1 or 2) → trivial optimization | Clear "Need minimum 3 assets" message; hide feature for small portfolios |
| Modal cold start hurts UX | `keep_warm=1` keeps 1 instance hot — extra ~$2/mo, dramatic UX improvement |
| HMAC secret leak | Quarterly rotation documented in runbook; each call logs fingerprint to detect anomalous use |

---

## Section 4 — Phase 3: Intelligence layer + alerts (Weeks 5-6)

### 4.1 Anomaly engine (statistics + rules)

Lives in the Worker as a new cron. **No AI at this layer** — only deterministic math. AI enriches downstream.

**Detectors:**

| Detector | What | Default threshold |
|----------|------|-------------------|
| Price z-score | Daily price outside 60-day distribution | \|z\| ≥ 2.5 |
| Volume spike | Volume vs 20-day MA | ratio ≥ 3.0 |
| Correlation break | Pair's rolling 30d correlation deviates >0.40 from 90d | Δρ ≥ 0.4 |
| Allocation drift | L1 distance current vs target weights | drift ≥ 5% |

**Cron `0 */1 * * *`** (hourly, market hours + 1h post-close):
```typescript
// worker/src/anomaly.ts
async function scanAnomalies(env: Env, supabase: SupabaseClient) {
  const userPositions = await fetchUserPositions(supabase)
  for (const [userId, positions] of userPositions) {
    const symbols = positions.map(p => p.symbol)
    const history = await fetchPriceHistory(supabase, symbols, 90)
    const anomalies: AnomalyCandidate[] = []
    // Z-score, volume, correlation, drift checks...
    if (anomalies.length > 0) {
      await fetch(env.NEXT_INTERNAL_URL + '/api/internal/anomalies/process', {
        method: 'POST',
        headers: { 'X-Internal-Key': env.INTERNAL_KEY },
        body: JSON.stringify({ userId, anomalies })
      })
    }
  }
}
```

**Service responsibility:** The Worker only **detects** anomaly candidates; the Next.js side enriches them (Claude Haiku classification → "real anomaly?"), persists into `alerts`, and triggers delivery. Logic lives in `src/lib/services/anomaly-enricher.ts` and is invoked from the `/api/internal/anomalies/process` route.

**Migration 009** (alert thresholds, alerts, push subscriptions):
```sql
CREATE TABLE alert_thresholds (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  price_z_threshold NUMERIC DEFAULT 2.5,
  volume_spike_ratio NUMERIC DEFAULT 3.0,
  correlation_break_delta NUMERIC DEFAULT 0.4,
  allocation_drift_pct NUMERIC DEFAULT 0.05,
  -- in-app delivery is always on (it's the canonical UI for alerts).
  -- This JSONB toggles the *additional* delivery channels.
  channels JSONB DEFAULT '{"email": false, "push": false}',
  quiet_hours JSONB DEFAULT '{"start": "22:00", "end": "07:00", "tz": "America/Mexico_City"}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,                    -- 'info' | 'warning' | 'critical'
  symbol TEXT,
  payload JSONB NOT NULL,
  ai_summary TEXT,
  ai_action_suggestion TEXT,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  delivered_channels TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alerts_user_unread ON alerts(user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, endpoint)
);

-- RLS: each user sees only their own data. INSERT into `alerts` happens via
-- service role from the anomaly-enricher / news-classifier / predictive-alerts
-- code paths (no client INSERT policy).
ALTER TABLE alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_thresholds" ON alert_thresholds FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_alerts_read" ON alerts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own_alerts_update" ON alerts FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_push_subscriptions" ON push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

### 4.2 News classifier (Claude Haiku 4.5)

News is ingested in Phase 1; classified here.

**Service responsibility:** Logic lives in `src/lib/services/news-classifier.ts` and is invoked from `/api/internal/news/classify`. Responsibilities: select unclassified items (`classified_at IS NULL`), batch (≤25), call Anthropic, validate response with Zod, persist columns added in Migration 007 (`relevance`, `topics`, `summary_es`, `action_hint`, `impact_score`, `impact_label`, `classified_at`), then trigger alert delivery for high-impact items.

**Cron `*/15 * * * *`** (every 15 min): Worker → calls `/api/internal/news/classify` in Next.js (Anthropic SDK lives there).

**System prompt with caching:**
```
You are a financial news classifier. For each item, return:
- impact_score: -100 (very negative) to +100 (very positive) for shareholders
- impact_label: "positive" | "negative" | "neutral"
- relevance: "high" | "medium" | "low"
- topics: array of labels (earnings, regulation, merger, product, leadership, macro, etc.)
- summary_es: 1-2 sentence Spanish summary
- action_hint: if high relevance + significant impact, 1-sentence actionable suggestion. Otherwise null.

Calibration:
- Earnings beat without guidance change → +20 to +40
- Earnings miss → -30 to -60
- SEC investigation → -50 to -80
- Major buyback announcement → +20 to +40
- CEO change → -10 to +10 (context-dependent)
- Irrelevant PR fluff → relevance "low", impact 0

Return ONLY valid JSON, no markdown, no extra text.
```

**Implementation:**
```typescript
async function classifyBatch(items: NewsItem[]) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [{
      role: 'user',
      // Finnhub items occasionally arrive with a NULL summary. The classifier
      // must work on headline alone in that case — coerce to empty string so
      // the prompt structure stays stable, and downgrade `relevance` to
      // 'medium' max in post-validation when summary was missing.
      content: `Classify these ${items.length} news items, return JSON array (same order):\n\n${JSON.stringify(items.map(({id, symbol, headline, summary}) => ({id, symbol, headline, summary: summary ?? ''})))}`
    }]
  })
  // Parse + validate with Zod, persist to news_items
}
```

**Cost estimate:** ~500 news/day with cached system prompt + 200 input tokens + 200 output tokens per item ≈ $15/mo.

**Alert trigger `news_impact`:** If `relevance == 'high'` AND `|impact_score| >= 50` AND symbol in user positions → create alert with severity proportional to `|impact_score|`.

### 4.3 Predictive alerts (earnings + dividends)

Daily cron `0 8 * * *` reads `earnings_calendar` and `dividend_calendar`, creates alerts for users holding the symbols.

> **Planner verification:** the query below assumes `positions.quantity > 0`. The planner must confirm `positions` has a `quantity` column (or the equivalent — `shares`, `units`) by reading `supabase/migrations/006_performance_optimization.sql` and prior migrations. If named differently, replace in the snippet below and in any other position queries added in this spec.

```typescript
async function createPredictiveAlerts(supabase) {
  const upcomingEarnings = await supabase
    .from('earnings_calendar')
    .select('*')
    .gte('earnings_date', today)
    .lte('earnings_date', plus48h)

  for (const earning of upcomingEarnings) {
    const usersHolding = await supabase
      .from('positions')
      .select('portfolio_id, portfolios!inner(user_id)')
      .eq('symbol', earning.symbol)
      .gt('quantity', 0)

    for (const u of usersHolding) {
      await insertAlert({
        user_id: u.portfolios.user_id,
        type: 'earnings_upcoming',
        severity: 'info',
        symbol: earning.symbol,
        payload: { earnings_date: earning.earnings_date, hour: earning.hour, eps_estimate: earning.eps_estimate }
      })
    }
  }
  // Same for dividends with ex-date in next 7 days
}
```

### 4.4 Daily insights (Claude Sonnet 4.6)

Cron `0 14 * * *` UTC (= 8 AM ET / 9 AM CT) for each **daily-active user** with positions.

**"Daily-active" definition:** `auth.users.last_sign_in_at >= now() - interval '7 days'` AND has at least one row in `positions` with `quantity > 0`. This filter runs in the Postgres query (no PostHog dependency, no extra round-trips). Expected size at ~500 total users: ~100 daily-active receiving insights.

**Input context:**
```typescript
const userContext = {
  portfolio_value: 52340,
  daily_change_pct: -1.2,
  daily_change_value: -635,
  top_movers_up: [{ symbol: 'NVDA', pct: 2.8 }],
  top_movers_down: [{ symbol: 'AAPL', pct: -3.1 }],
  news_today: [{ symbol: 'AAPL', headline: '...', impact_score: -55, summary_es: '...' }],
  upcoming_events: [{ type: 'earnings', symbol: 'NVDA', date: '2026-04-22' }],
  open_alerts_count: 3
}
```

**Cached system prompt:**
```
You are InvestTracker's financial assistant. Generate a daily portfolio summary of MAX 80 words in Spanish, professional yet warm.

Structure:
1. One sentence with daily change and identifiable cause.
2. If relevant news exists, mention 1-2 with estimated impact.
3. If 48h-upcoming events, recall most important.
4. Close with a micro-action if it makes sense, without alarming.

Never invent data. Omit points without info. No emojis. No greetings.
```

**Output:** Persisted as alert type `daily_insight`, `severity: 'info'`. Rendered as a large card (not toast) in UI.

**Cost:** Per insight with prompt caching ≈ ~$0.0042 (1500 cached system + 500 fresh input + 150 output, Sonnet 4.6 pricing). At ~100 daily-active users × 30 days ≈ **~$13/mo**. The cost table in 5.5 rounds this to ~$10 because not every daily-active user has positions every day.

### 4.5 Multi-channel delivery

**In-app (toast + badge):**
- `useUnreadAlerts()` subscribed to Realtime channel `alerts:{userId}`.
- Bell icon with unread count badge in topbar.
- `AlertsDrawer.tsx` with chronological list + filters + actions (mark read, dismiss).
- Auto-toast when alert with `severity != 'info'` arrives and page is in foreground.

**Email:**
- Reuse existing setup if any. If none, add **Resend** (`resend` npm package, free 3k/mo).
- Simple HTML template with title, summary, CTA "View in InvestTracker".
- Trigger: in `/api/internal/anomalies/process`, if `channels.email == true` AND severity ≥ warning, send email.

**Web Push (PWA):**
- `public/sw.js` — Service Worker with `push` handler.
- `src/lib/push/` — client utilities: `requestPermission()`, `subscribeUser()`, `unsubscribeUser()`.
- `src/lib/services/push-server.ts` — uses `web-push` library to send from Next.js API. VAPID keys in env.
- Settings UI at `/settings/notifications` for opt-in and subscription management.

**New dependencies:** `resend`, `web-push`. Generate VAPID keys once.

**Delivery logic:**
```typescript
// Channel rules:
//  - in-app: always delivered (the alerts table itself + Realtime broadcast IS
//    the in-app channel — there is no opt-out, just a quiet-hours suppression).
//  - email/push: opt-in via prefs.channels.{email,push}.
//  - quiet hours suppress non-critical alerts on ALL channels including in-app
//    Realtime; the alert is still inserted, the user just doesn't get pushed
//    awake. They'll see it next time they open the app.
async function deliverAlert(alert: Alert) {
  const prefs = await getUserPrefs(alert.user_id)
  const inQuietHours = isInQuietHours(prefs.quiet_hours)
  if (inQuietHours && alert.severity !== 'critical') {
    // Insert silently — no realtime broadcast, no email, no push.
    return
  }
  await broadcastRealtime(`alerts:${alert.user_id}`, alert)
  alert.delivered_channels.push('in_app')
  if (prefs.channels.email && alert.severity !== 'info') {
    await sendAlertEmail(alert)
    alert.delivered_channels.push('email')
  }
  if (prefs.channels.push && alert.severity !== 'info') {
    await sendPush(alert)
    alert.delivered_channels.push('push')
  }
  await updateAlert(alert.id, { delivered_channels: alert.delivered_channels })
}
```

### 4.6 Notification UI

**Topbar:** Bell icon with unread badge → opens AlertsDrawer.

**`/settings/notifications`:**
- Per-channel toggles for the **additional** channels: email (off by default), push (off by default). The in-app channel is always on by design — disclosed in copy ("Las alertas siempre aparecen dentro de la app; aquí decides si también te llegan por email o push").
- Sliders for 4 anomaly thresholds
- Quiet hours selector (mutes non-critical realtime/email/push during the window)
- "Test push" button
- List of subscribed devices with revoke option

**Alerts drawer:** Grouped by day, severity-indicator color, ai_summary if present, "Mark as read" / "Dismiss" actions.

### 4.7 Phase 3 deliverable

1. Anomaly engine running in Worker, populating alerts table
2. News classifier processing batches, filling impact fields
3. Predictive alerts (earnings/dividends) daily
4. Daily insights generating for opt-in beta users
5. Web Push functional end-to-end (permission flow, send, click → app)
6. Full UI: drawer + settings + topbar badge
7. Realtime channel `alerts:{userId}` operational
8. PostHog events: `alert_received`, `alert_clicked`, `alert_dismissed`, `daily_insight_opened`

### 4.8 Phase 3 risks

| Risk | Mitigation |
|------|------------|
| Alert fatigue | Per-user rate limit (max 10/day default), 1h grouping by type, severity-based filtering |
| Haiku misclassifies critical movement | Disclaimer "Automated analysis, not financial advice"; user can report for telemetry-driven prompt improvement |
| Web Push permission denied → useless feature | Educational onboarding before permission request; email fallback works without permissions |
| Anthropic costs spike | Per-feature daily budget caps (insights $5/day, classifier $2/day) → exceeded = skip + admin alert |
| Anomaly engine noisy initially | z ≥ 2.5 already conservative (~1% of days); A/B in PostHog measuring CTR and dismiss-rate per threshold |

---

## Section 5 — Cross-cutting concerns

### 5.1 Consolidated data model

**Migration 007 — Worker expansion (Phase 1):** `company_profile`, `dividend_calendar`, `earnings_calendar`, `news_items`.

**Migration 008 — Quant + targets (Phase 2):**
- New `portfolios` columns: `target_weights JSONB`, `optimization_constraints JSONB`
- `quant_runs` audit table:
```sql
CREATE TABLE quant_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL,                    -- 'optimize' | 'monte_carlo' | 'factors' | 'rebalance'
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  elapsed_ms INT,
  cached BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_quant_runs_portfolio ON quant_runs(portfolio_id, created_at DESC);

ALTER TABLE quant_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_quant_runs_read" ON quant_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- INSERT only via service role from services/quant.ts (no client INSERT policy).
```

**Migration 009 — Alerts + push (Phase 3):** `alert_thresholds`, `alerts`, `push_subscriptions`. The Phase 3 classifier columns (`relevance`, `topics`, `summary_es`, `action_hint`, `impact_score`, `impact_label`) live in Migration 007 — see Section 2.4 — so the classifier code in Phase 3 has nothing to migrate, only data to write.

**RLS policies (following migration 006 pattern):**
- `quant_runs`: portfolio owner only (SELECT/UPDATE/DELETE checked against `portfolios.user_id = auth.uid()`); INSERT only via service role from `services/quant.ts`.
- `alert_thresholds`: own user only — DDL inline in Migration 009 (Section 4.1).
- `alerts`: own user (SELECT/UPDATE for mark/dismiss); INSERT only via service role — DDL inline in Migration 009 (Section 4.1).
- `push_subscriptions`: own user — DDL inline in Migration 009 (Section 4.1).
- `company_profile`, `news_items`, `earnings_calendar`, `dividend_calendar`: public read for authenticated users; INSERT/UPDATE service role only — DDL inline in Migration 007 (Section 2.4).

The DDL for these policies ships **inside the same migration** as the table creation so a partially-applied migration cannot leave a table without RLS enabled.

### 5.2 Security & authentication

**Layered auth:**
```
User → Vercel/Next.js [Supabase Auth JWT] → API route → Service layer
                                                          ├─→ Supabase [RLS + JWT]
                                                          ├─→ Modal [HMAC]
                                                          ├─→ Anthropic [server API key]
                                                          ├─→ Upstash [server token]
                                                          └─→ Worker [internal key]
```

**Secrets management:**

| Secret | Lives in | Rotation |
|--------|----------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + Worker + Modal | Annual |
| `ANTHROPIC_API_KEY` | Vercel only | Quarterly |
| `QUANT_SERVICE_HMAC_KEY` | Vercel + Modal | Quarterly |
| `INTERNAL_KEY` (Worker ↔ Next.js) | Worker + Vercel | Quarterly |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel + Worker | Annual |
| `SENTRY_AUTH_TOKEN` | Vercel build only | Annual |
| `RESEND_API_KEY` | Vercel only | Annual |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Vercel only | Never (breaks subscriptions) |

Rotation runbook at `docs/runbooks/secret-rotation.md`. Each rotation logged in runbook bitácora.

**Rate limiting (extending existing `@upstash/ratelimit`):**

| Endpoint | Limit | Reason |
|----------|-------|--------|
| `POST /api/portfolio/[id]/optimize` | 10/h per user | cvxpy is expensive |
| `POST /api/portfolio/[id]/monte-carlo` | 5/h per user | Even more expensive |
| `POST /api/portfolio/[id]/rebalance` | 30/h per user | Cheap but prevent abuse |
| `/api/internal/*` (Worker → Next) | 100/min global | Sanity check |

429 responses include `Retry-After` header + log to Sentry for abuse detection.

**Input validation:** Pydantic at Modal boundary, Zod at Next.js boundary. Validators ensure: returns matrix consistent dimensions / no NaN/Inf, weights sum 1.0 ± 0.001, constraints non-contradictory, sizes bounded (N ≤ 100 symbols, days ≤ 5000).

### 5.3 Testing strategy

**TypeScript (Vitest):**

| Layer | Type | Coverage target |
|-------|------|-----------------|
| `src/lib/quant/*` | Unit with math properties | 100% lines |
| `src/lib/services/*` | Unit with Supabase mocks + nock | 80%+ |
| `src/app/api/**/route.ts` | Integration with test DB | Critical flows |
| `src/components/optimize/*`, `src/components/alerts/*` | RTL + jsdom | Render + happy path |

**Python (pytest):**

| Module | Strategy |
|--------|----------|
| `optimize.py` | Synthetic datasets with known solutions + golden tests with fixed seed |
| `monte_carlo.py` | Validate percentile convergence to theoretical as N→∞; fixed seed in CI |
| `factors.py` | Regression against statsmodels on identical data |
| `rebalance.py` | Property-based with hypothesis: turnover ≥ 0, post-trade weights within constraints |
| `api.py` | FastAPI TestClient: status codes, validation, HMAC reject |

**Worker (Vitest + miniflare):** Unit anomaly detectors with fixtures, mock Supabase + KV for full flow tests.

**E2E (Playwright — new dependency, set up in Phase 1):**

Install:
- `@playwright/test` as devDependency
- `playwright.config.ts` at repo root (baseURL = `http://localhost:3000` locally / preview URL in CI; chromium + webkit projects; trace on first retry)
- Test files in `tests/e2e/*.spec.ts`
- Browsers downloaded in CI via `npx playwright install --with-deps chromium`
- `.gitignore` add `playwright-report/`, `test-results/`

Initial scenarios (added incrementally per phase):
1. **Phase 1 smoke:** Login → dashboard → no console errors, no Sentry events captured. (1 spec)
2. **Phase 2 vertical slice:** Open `/portfolio/[id]/optimize` → adjust constraint → click "Apply" → frontier updates → "Create rebalance plan" → confirm → see N transactions in table. (1 spec)
3. **Phase 3 vertical slice:** Open dashboard → manually insert test alert via service-role client in test setup → toast appears within 3s → click → drawer opens with detail → mark read → unread badge decrements. (1 spec)

Runs nightly via cron in GitHub Actions + on every release tag. Does not block PRs (smoke only blocks PRs in Phase 1; full suite advisory). Failed runs auto-create a GitHub issue with the trace artifact attached.

**Load testing (one-shot before flag GA):** k6 script simulating 100 concurrent optimizations → measure p95 latency, errors. Validate Modal autoscale, Sentry not flooded, Supabase queries hold.

### 5.4 CI/CD

**GitHub Actions pipeline:**

```
on push (any branch):
  - lint (eslint + ruff)
  - typecheck (tsc + mypy if hints introduced)
  - test (vitest + pytest)
  - build (next build)

on PR:
  - all above +
  - playwright smoke
  - Vercel preview deploy
  - bot comment with metrics (bundle size diff, Lighthouse)

on push to main:
  - all above +
  - Vercel production deploy
  - if quant-service/** changed → modal deploy
  - if worker/** changed → wrangler deploy
  - if supabase/migrations/** changed → bot comment "manually apply migration"
```

**Migrations:** Numbered sequentially (007, 008, 009). Never modified after merge. Manual application via Supabase dashboard until branching configured.

**Feature flag rollout:** 0% → own account → 5% beta → 25% → 50% → 100%. Kill switch per flag. Error rate per flag visible in PostHog dashboard.

### 5.5 Cost projection (~500 active users)

| Service | Usage | Cost |
|---------|-------|------|
| Vercel Pro | Existing | $20 |
| Supabase Pro | Existing | $25 |
| Cloudflare Workers | Free tier (100k req/day) | $0 |
| Upstash Redis | Free tier (500k commands/day) | $0 |
| Modal | ~200 optimizations/day × 2s + `keep_warm=1` always-on | ~$8 |
| Anthropic Haiku 4.5 | ~500 news/day classification (cached system prompt) | ~$15 |
| Anthropic Sonnet 4.6 | ~100 daily-active users × 1 insight/day (cached system prompt) | ~$10 |
| Sentry Team | 50k errors/mo | $26 |
| PostHog Cloud | Free tier (1M events/mo) | $0 |
| Resend | Free tier (3k emails/mo) | $0 |
| Web Push | Free | $0 |
| **Total added** | | **~$59/mo** |

**Hard budget caps & rationale:**
- **Anthropic $50/day** total across both models. At expected usage (Haiku ~$0.50/day + Sonnet ~$0.43/day = ~$1/day), this is **~50× headroom** — intentional to absorb a runaway-loop bug or a viral signup spike without the kill switch firing during normal operation. If we trigger this cap, something is wrong (not just busy).
- **Modal alert if monthly CPU-seconds > 50,000.** Roughly 6× expected usage; same headroom rationale.
- **Sentry 1,000 errors/h per project.** Catches loops; 1k/h is well above realistic incident rate.

Per-feature daily soft caps (`DAILY_INSIGHT_BUDGET_USD`, `NEWS_CLASSIFIER_BUDGET_USD`, see Appendix B) live closer to actual usage and skip+log+admin-alert when crossed — those are the operational early warning, not the $50/day cap.

### 5.6 Documentation deliverables

Per phase, alongside code:

**Phase 1:** `docs/runbooks/sentry.md`, `docs/runbooks/posthog.md`, `docs/runbooks/cache-monitoring.md`, `docs/runbooks/health-checks.md` (per-service status check matrix referenced in R3 mitigation), `docs/runbooks/secret-rotation.md` (initial template — populated as secrets get rotated). Update `worker/ARCHITECTURE.md`.

**Phase 2:** `quant-service/README.md`, `quant-service/DEPLOYMENT.md`, `docs/api/quant.md`, `docs/runbooks/quant-incidents.md`.

**Phase 3:** `docs/runbooks/alerts-tuning.md`, `docs/runbooks/anthropic-budget.md`, `docs/api/web-push.md`.

Important docs duplicated to Obsidian `06 - Dev/Runbooks/` for browsable access.

### 5.7 Operational checklist for new endpoints

Every new API route added in Phases 2/3 — and any future route — must satisfy this list before merge. Consolidated here so the planner and reviewer can use it as a single source.

| # | Item | Where it lives |
|---|------|----------------|
| 1 | **Auth check.** Caller is authenticated (or HMAC-validated for `/api/internal/*`) | `src/lib/api/handler.ts` wrapper |
| 2 | **Zod input schema.** Body and search params validated; reject 400 with shaped error | Route file or `src/lib/schemas/` |
| 3 | **Rate limit.** Documented in Section 5.2 table; uses existing `@upstash/ratelimit` | Route file |
| 4 | **Cache key naming.** Prefix: `{feature}:{userId}:{resourceId}:{params-hash}`. TTL documented in Section 3.6 table | Service layer |
| 5 | **RLS check.** Underlying Supabase queries respect RLS; service role only when explicitly justified | Service layer |
| 6 | **Sentry breadcrumb.** Add `Sentry.addBreadcrumb({ category, message, data })` at entry | Route file |
| 7 | **PostHog event.** `postHogServer.capture` for the user-facing action | Route file |
| 8 | **Audit row.** If endpoint calls Modal → insert into `quant_runs`. If creates an `alerts` row → record `delivered_channels` | Service layer |
| 9 | **Error envelope.** Errors returned as `{ error: { code, message, details } }` matching the contract in 3.3a | Route file |
| 10 | **i18n.** User-facing error strings via `quant.errors.<code>` or equivalent namespace | Service layer / route |
| 11 | **Tests.** Vitest unit (service layer) + integration (route) per Section 5.3 | `__tests__/` colocated |
| 12 | **Documentation.** New runbook entry if alerting behavior differs from existing patterns | `docs/runbooks/` |

---

## Section 6 — Risks, success metrics, done criteria

### 6.1 Cross-cutting risks

**R1 — Scope creep.** High probability. Mitigation: out-of-scope list is immutable; new ideas go to `docs/superpowers/specs/backlog.md`. Weekly Monday review. If a phase risks >3 days overrun, cut features instead of extending deadline.

**R2 — Tech debt accumulation.** Medium probability. Mitigation: PR checklist enforces tests + docs + justified TODOs. 1-day "polish + cleanup" slot at end of each phase, pre-allocated. Sentry as arbiter — no advancing if new recurring errors persist.

**R3 — External dependency outage.** Per-service: Modal down → optimization unavailable, rest of app works. Anthropic down → classifier pauses, daily insights skip. Twelve Data down → existing Finnhub fallback. Mitigation: documented health checks runbook; status page cron; circuit breaker in `services/quant.ts` (3x 5xx in 5min → reject for 10min).

**R4 — Quant calculation errors damaging trust.** Low probability with rigorous tests, but high cost. Mitigation: tests with known historical datasets; visible disclaimer on every output; `quant_runs` versioning (identify affected runs if bug found); sanity checker before display (weights sum to 1.0 ± 0.01, no negative when constraints disallow, no >50% outliers).

**R5 — GDPR / privacy.** Low-medium. Mitigation: PostHog input masking on password/email fields; Anthropic receives no PII (only public symbols/prices/headlines); daily insights say "your portfolio dropped 1.2%" not user identifiers; updated privacy page lists subprocessors.

**R6 — Burnout over 6 weeks.** Real. Mitigation: roadmap memorized (already done); atomic tasks in 2-3h chunks; optional break slot between phases (dependencies allow it).

### 6.2 Success metrics

**DORA-style:**

| Metric | Baseline | Target |
|--------|----------|--------|
| MTTD (bugs in prod) | Days | <15 min |
| MTTR | Hours | <1h non-critical |
| Deploy frequency | Variable | ≥3/week |
| Change failure rate | Unknown | <15% |
| Lead time | Variable | <2 days small features |

**Product (PostHog dashboards):**

| Metric | Target (30 days post-launch) |
|--------|------------------------------|
| Cache hit ratio (compare) | ≥80% |
| Cache hit ratio (leaderboard) | ≥90% |
| Optimize feature adoption | ≥30% beta users running ≥1/week |
| Smart Rebalance plan creation | ≥15% of optimize runs |
| Alert engagement (CTR) | ≥25% |
| Alert dismiss rate | <30% |
| Daily insight open rate | ≥40% (among opt-ins) |
| Push notification opt-in | ≥20% beta users |
| Realtime adoption | ≥60% pages with >30s connection |
| p95 `/optimize` latency | <3s |
| p95 `/api/dashboard` latency | <500ms |

**Business proxies:**

| Metric | Target |
|--------|--------|
| 7-day retention post quant exposure | +5pp vs control (PostHog A/B) |
| Avg session duration | +20% post-Phase 3 |
| Bounce rate `/portfolio/[id]` | -10pp |

Targets are estimates. Recalibrate if week-2 numbers diverge significantly.

### 6.3 Done criteria

**Phase 1 done:**
- [ ] Sentry capturing errors in Next.js prod, Worker prod, source maps legible
- [ ] PostHog receiving events in prod ≥7 days, basic dashboards exist
- [ ] All 4 new tables have ≥30 days of historical data
- [ ] Cache hit ratio dashboard functional
- [ ] Realtime verified: KV price change → frontend toast in <2s
- [ ] `/admin/metrics` accessible to admins, 5 key widgets shown
- [ ] Zero performance regressions (Lighthouse equal or better)

**Phase 2 done:**
- [ ] `quant-service` deployed on Modal, 4 endpoints respond correctly
- [ ] HMAC working (invalid key → 401)
- [ ] `src/lib/quant/*` complete test suite, all algorithms covered
- [ ] UI `/portfolio/[id]/optimize` accessible to flagged users, fully functional
- [ ] "Create rebalance plan" creates real `transactions` rows
- [ ] p95 of `/optimize` < 3s in prod (Sentry traces)
- [ ] `quant_runs` table receiving entries
- [ ] E2E optimize flow tests passing
- [ ] API + DEPLOYMENT documentation published

**Phase 3 done:**
- [ ] Anomaly engine running hourly, generating alerts for accounts with positions
- [ ] News classifier processing ≥80% of news_items in ≤1h
- [ ] Predictive alerts (earnings/dividends) reaching users day-before
- [ ] Daily insights generated for opt-in beta users
- [ ] Web Push working end-to-end (subscribe, notify, click → app)
- [ ] Full UI: drawer, settings, badge accessible
- [ ] Quiet hours respected in testing
- [ ] CTR of alerts measured, tuning dashboards available
- [ ] Budget caps configured (Anthropic + Modal + Sentry)
- [ ] "Not financial advice" disclaimer on all AI output

**Roadmap done:**
- [ ] All 3 phase checks complete
- [ ] Living docs in `docs/runbooks/` and Obsidian `06 - Dev/Runbooks/`
- [ ] Obsidian roadmap bitácora updated with what shipped per phase
- [ ] Claude memory updated to final state
- [ ] Retro written: what worked, what didn't, what to prioritize next

### 6.4 Contingency plans

**Phase 1 — Realtime doesn't scale as expected:** Fallback to SWR polling at 15s. Rest of Phase 1 proceeds. Realtime moves to backlog.

**Phase 2 — cvxpy install/debug nightmare on Modal:**
- A: scipy.optimize only (more limited but enough for basic Markowitz)
- B: Switch Modal → Cloudflare Containers or Fly.io with custom Dockerfile
- Re-evaluate end of week 3 if no clear convergence

**Phase 3 — Anthropic costs spike:** Reduce frequency (classifier 30min, not 15). Daily insights tier-gated to paid users (future). Switch insights from Sonnet 4.6 → Haiku 4.5 (lower quality, 10x cheaper).

**Roadmap not finished in 6 weeks:** Re-prioritize Phase 3 features (anomaly engine = critical, daily insights = optional). Cut non-critical, keep shipped stable, push remainder to Q3.

### 6.5 Post-roadmap candidates (Q3 inputs, not commitments)

- Conversational assistant with tool use (now has real tools to use)
- Visual backtesting ("what if you'd followed the optimal strategy?")
- Real broker integration (paper trading first)
- Pro tier with advanced factor analysis, attribution, tax optimization
- React Native app reusing TS quant lib
- Full multi-currency (FX rates already partial)
- Native iOS/Android push (APNs/FCM)

Each gets its own brainstorm in due time.

---

## Appendix A — File structure additions

```
investment-portfolio/
  docs/
    api/
      quant.md                              # Phase 2
      web-push.md                           # Phase 3
    runbooks/
      sentry.md                             # Phase 1
      posthog.md                            # Phase 1
      cache-monitoring.md                   # Phase 1
      quant-incidents.md                    # Phase 2
      alerts-tuning.md                      # Phase 3
      anthropic-budget.md                   # Phase 3
      secret-rotation.md                    # Cross-cutting
      health-checks.md                      # Cross-cutting
    superpowers/
      specs/
        2026-04-20-investtracker-q2-roadmap-design.md   # this doc
        backlog.md                           # NEW
      plans/
        2026-04-20-investtracker-q2-roadmap-plan.md     # next step

  quant-service/                             # NEW (Phase 2)
    pyproject.toml
    modal_app.py
    src/
    tests/
    README.md
    DEPLOYMENT.md

  src/
    app/
      (app)/
        admin/
          metrics/page.tsx                   # Phase 1
        portfolio/[id]/
          optimize/page.tsx                  # Phase 2
        settings/
          notifications/page.tsx             # Phase 3
      api/
        admin/
          metrics/route.ts                   # Phase 1
        internal/
          anomalies/process/route.ts         # Phase 3
          news/classify/route.ts             # Phase 3
        portfolio/[id]/
          optimize/route.ts                  # Phase 2
          monte-carlo/route.ts               # Phase 2
          factors/route.ts                   # Phase 2
          rebalance/route.ts                 # Phase 2
        push/
          subscribe/route.ts                 # Phase 3
          unsubscribe/route.ts               # Phase 3
    components/
      alerts/
        AlertsDrawer.tsx                     # Phase 3
        AlertCard.tsx                        # Phase 3
        AlertBadge.tsx                       # Phase 3
        NotificationSettings.tsx             # Phase 3
      consent/
        CookieBanner.tsx                     # Phase 1
      optimize/
        EfficientFrontierChart.tsx           # Phase 2
        ConstraintsForm.tsx                  # Phase 2
        OptimalAllocationTable.tsx           # Phase 2
        RebalanceTradeList.tsx               # Phase 2
        OptimizeSummary.tsx                  # Phase 2
    lib/
      quant/                                 # NEW (Phase 2)
        index.ts
        metrics.ts
        correlation.ts
        concentration.ts
        drift.ts
        drawdown.ts
        __tests__/
      services/
        quant.ts                             # NEW (Phase 2)
        news-classifier.ts                   # NEW (Phase 3)
        anomaly-enricher.ts                  # NEW (Phase 3)
        alert-delivery.ts                    # NEW (Phase 3)
        push-server.ts                       # NEW (Phase 3)
        daily-insight.ts                     # NEW (Phase 3)
      hooks/
        useRealtimePrices.ts                 # NEW (Phase 1)
        useUnreadAlerts.ts                   # NEW (Phase 3)
        usePushNotifications.ts              # NEW (Phase 3)
      push/                                  # NEW (Phase 3)
        client.ts
        vapid.ts
      cache/
        with-metrics.ts                      # NEW (Phase 1)
    providers/
      posthog-provider.tsx                   # NEW (Phase 1)

  worker/
    src/
      anomaly.ts                             # NEW (Phase 3)
      news-ingestion.ts                      # NEW (Phase 1)
      sectors-cron.ts                        # NEW (Phase 1)
      dividends-cron.ts                      # NEW (Phase 1)
      earnings-cron.ts                       # NEW (Phase 1)

  supabase/migrations/
    007_worker_expansion.sql                 # NEW
    008_quant_engine.sql                     # NEW
    009_alerts_and_push.sql                  # NEW

  public/
    sw.js                                    # NEW (Phase 3)

  sentry.client.config.ts                    # NEW (Phase 1)
  sentry.server.config.ts                    # NEW (Phase 1)
  sentry.edge.config.ts                      # NEW (Phase 1)
  instrumentation.ts                         # NEW (Phase 1)

  playwright.config.ts                       # NEW (Phase 1)
  tests/
    e2e/
      smoke.spec.ts                          # NEW (Phase 1)
      optimize.spec.ts                       # NEW (Phase 2)
      alerts.spec.ts                         # NEW (Phase 3)
```

## Appendix B — New environment variables

```
# Phase 1 — Sentry
NEXT_PUBLIC_SENTRY_DSN=                     # Browser/edge runtime DSN (public)
SENTRY_DSN=                                 # Node server runtime DSN (private — keep server-only)
SENTRY_AUTH_TOKEN=                          # Build-time, source map upload
SENTRY_ORG=
SENTRY_PROJECT=

# Phase 1 — PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=

# Phase 1 — Worker ↔ Next.js shared secret + base URL
INTERNAL_KEY=                               # Shared secret, header X-Internal-Key
NEXT_INTERNAL_URL=                          # Base URL the Worker uses to reach Next.js
                                            # (e.g., https://app.investtracker.com).
                                            # Set on the Worker side; Next.js doesn't read it.

# Phase 2 — Quant service
QUANT_SERVICE_URL=                          # Modal deploy URL
QUANT_SERVICE_HMAC_KEY=                     # Shared with Modal secrets

# Phase 3 — Anthropic + budget caps
ANTHROPIC_API_KEY=
DAILY_INSIGHT_BUDGET_USD=                   # Per-day soft cap for Sonnet daily insights
NEWS_CLASSIFIER_BUDGET_USD=                 # Per-day soft cap for Haiku news classifier

# Phase 3 — Email (Resend)
RESEND_API_KEY=

# Phase 3 — Web Push (VAPID, generate once with `web-push generate-vapid-keys`)
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=      # Public key, exposed to client subscribe()
WEB_PUSH_VAPID_PRIVATE_KEY=                 # Private key, server-only
WEB_PUSH_VAPID_SUBJECT=                     # mailto:admin@investtracker.app
```

**Notes on which env vars live where:**
- All `NEXT_PUBLIC_*` are bundled to the client. Never put secrets there.
- `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser/edge) are typically the same DSN value but separated so server-only code paths and client code paths can be configured independently per `@sentry/nextjs` convention.
- `INTERNAL_KEY` is needed in both Vercel env (Next.js verifies header) and the Worker env (Worker sets header). Same value both sides.
- `QUANT_SERVICE_HMAC_KEY` is needed in both Vercel env and Modal secrets. Same value both sides.
- VAPID public key is `NEXT_PUBLIC_*` because the browser passes it to `pushManager.subscribe()`. Private key is server-only.
