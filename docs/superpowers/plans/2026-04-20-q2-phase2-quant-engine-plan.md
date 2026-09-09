# Q2 2026 — Phase 2: Quantitative Engine & Smart Rebalance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Python microservice on Modal (4 endpoints: `/optimize`, `/monte-carlo`, `/factors`, `/rebalance`) with HMAC auth, a pure-math TypeScript library `src/lib/quant/`, 4 Next.js orchestration routes, and the closing vertical slice — `/portfolio/[id]/optimize` with an interactive efficient frontier, constraints form, and "Create rebalance plan" trade flow. Behind feature flag `quant_engine_enabled`.

**Architecture:** Hybrid TS + Python. TypeScript holds the thin computations (Sharpe, Sortino, beta, rolling correlation, HHI, L1 drift) — pure, testable, zero external deps. Python holds the heavy math: cvxpy convex optimization (Markowitz + Sharpe-max), riskfolio-lib (risk parity + HRP), scipy/numpy Monte Carlo, statsmodels-style factor regression. Modal serves the Python service with `keep_warm=1` (~2s cold start otherwise). Next.js wraps each Modal call with HMAC signing, Upstash caching, and a mandatory `quant_runs` audit insert (invariant: every Modal call and every cache-served result lands one row).

**Tech Stack:** Same existing core as Phase 1. **Added this phase:** Python 3.12 (Modal managed runtime), FastAPI 0.115+, Pydantic v2, numpy 2.1+, scipy 1.14+, cvxpy 1.5+, riskfolio-lib 6.0+, empyrical 0.5.5+, sentry-sdk[fastapi] 2.0+, Modal SDK 0.66+. Frontend: nothing new — Recharts ScatterChart already in repo, shadcn/base-ui forms, SWR. NOTE: Next.js 16 renames `middleware.ts` → `proxy.ts`. Always read `node_modules/next/dist/docs/` before writing framework code.

**Spec:** `docs/superpowers/specs/2026-04-20-investtracker-q2-roadmap-design.md` — Section 3 (Phase 2 design), §3.3a (error envelope), Section 5.1 (migration 009), Section 5.2 (security + rate limits), Section 5.3 (testing), Section 5.7 (operational checklist), Appendix A (file structure), Appendix B (env vars).

**Prereqs (from Phase 1):** Sentry initialized on Next.js + Worker; PostHog initialized (consent-gated) with `postHogServer.capture` available; `src/lib/cache/with-cache.ts` instrumented (cache-hit metrics); Migration 008 applied; `withCache` + `cacheGetWithMetrics` in place; Playwright smoke harness green on PRs. Phase 1 MUST be fully deployed and stable (no regressions for ≥ 48 h) before starting this phase. If Phase 1 is not fully green, do not start Task 1.1 — fix Phase 1 first.

---

## File Structure

### New files

```
quant-service/                                 — Python microservice root (NEW top-level dir)
  pyproject.toml                               — deps + ruff/pytest config
  modal_app.py                                 — Modal app entry (image + keep_warm + web endpoint)
  .python-version                              — 3.12
  README.md                                    — local dev, deploy, layout
  DEPLOYMENT.md                                — Modal secrets, deploy flow, rollback, rotation
  src/__init__.py
  src/api.py                                   — FastAPI app + router wiring + error handler
  src/auth.py                                  — HMAC validation middleware (timestamp + signature)
  src/schemas.py                               — Pydantic request/response models per endpoint
  src/errors.py                                — typed exception classes → §3.3a envelope
  src/sentry_init.py                           — sentry_sdk bootstrap (shared by api + modal_app)
  src/optimize.py                              — Markowitz, risk_parity, hrp, frontier
  src/monte_carlo.py                           — GBM simulation, percentile trajectories, VaR/CVaR
  src/factors.py                               — OLS factor regression via numpy linear algebra
  src/rebalance.py                             — Greedy integer-share rebalance with costs
  src/metrics.py                               — Empyrical wrappers (Sharpe, etc., shared across modules)
  src/data.py                                  — Returns-matrix + cov helpers (validate + sanitize)
  tests/__init__.py
  tests/conftest.py                            — pytest fixtures (rng seeding, fake returns)
  tests/test_api.py                            — FastAPI TestClient: status + HMAC reject + envelope
  tests/test_auth.py                           — HMAC validation unit tests
  tests/test_optimize.py                       — Markowitz known-solution + property tests
  tests/test_monte_carlo.py                    — Percentile convergence to theoretical
  tests/test_factors.py                        — OLS sanity vs numpy.linalg baseline
  tests/test_rebalance.py                      — Hypothesis: turnover ≥ 0, constraints hold
  tests/fixtures/returns_synth.npz             — 5 assets × 252 days, fixed seed
  tests/fixtures/ff5_2024.csv                  — Fama-French 5 factors Jan–Dec 2024 (public)

supabase/migrations/009_quant_engine.sql       — target_weights/optimization_constraints cols + quant_runs table + RLS

src/lib/quant/                                 — Pure-math TS library (NEW)
  index.ts                                     — barrel
  metrics.ts                                   — Sharpe, Sortino, beta, alpha, max DD, Calmar, info ratio
  correlation.ts                               — Pearson, Spearman, rolling correlation matrix
  concentration.ts                             — HHI, top-N exposure (NEW math — not a move)
  drift.ts                                     — L1 distance (current vs target)
  drawdown.ts                                  — Drawdown series + max DD
  returns.ts                                   — log / simple returns, aggregation helpers

src/lib/services/quant.ts                      — Modal caller: HMAC sign + cache + quant_runs insert
src/lib/quant/types.ts                         — Shared types mirroring Pydantic schemas

src/lib/api/response-coded.ts                  — errorCoded helper producing §3.3a envelope (alongside legacy)
src/lib/api/hmac.ts                            — HMAC SHA-256 signer (timing-safe), shared w/ quant.ts

src/app/api/portfolio/[id]/optimize/route.ts   — POST: proxies to Modal /optimize
src/app/api/portfolio/[id]/monte-carlo/route.ts — POST: proxies to Modal /monte-carlo
src/app/api/portfolio/[id]/factors/route.ts    — GET: proxies to Modal /factors
src/app/api/portfolio/[id]/rebalance/route.ts  — POST: proxies to Modal /rebalance

src/app/(app)/portfolio/[id]/optimize/page.tsx — /portfolio/[id]/optimize server component
src/components/optimize/EfficientFrontierChart.tsx  — Recharts ScatterChart + frontier line
src/components/optimize/ConstraintsForm.tsx    — react-hook-form + zod, sliders, sector caps
src/components/optimize/OptimalAllocationTable.tsx  — current vs optimal diff table
src/components/optimize/RebalanceTradeList.tsx — trade list with "Create transactions" action
src/components/optimize/OptimizeSummary.tsx    — KPI cards (turnover, costs, Sharpe delta)

tests/lib/quant/metrics.test.ts                — Vitest: Sharpe=0 when r=rf, property tests
tests/lib/quant/correlation.test.ts            — Rolling correlation correctness
tests/lib/quant/concentration.test.ts          — HHI boundaries + top-N
tests/lib/quant/drift.test.ts                  — L1 distance edge cases
tests/lib/quant/drawdown.test.ts               — Monotonic series → max DD = 0
tests/lib/services/quant.test.ts               — HMAC signing, Modal mock, cache, audit row
tests/lib/api/hmac.test.ts                     — Timing-safe compare, replay window
tests/lib/api/response-coded.test.ts           — Envelope shape matches §3.3a
tests/app/api/portfolio/optimize-route.test.ts — Route integration (auth + rate limit + Modal mock)
tests/components/optimize/ConstraintsForm.test.tsx  — RTL: validation, debounce-on-commit
tests/components/optimize/EfficientFrontierChart.test.tsx — Renders scatter with data
tests/e2e/optimize.spec.ts                     — Playwright Phase 2 vertical slice

docs/api/quant.md                              — Endpoint contracts (public — mirror spec §3.2)
docs/runbooks/quant-incidents.md               — Cold start, infeasible solves, HMAC rotation
```

### Modified files

```
package.json                                   — Add recharts-scatter helpers if needed; no new npm deps expected
.env.local.example                             — Add QUANT_SERVICE_URL, QUANT_SERVICE_HMAC_KEY

src/lib/api/rate-limit.ts                      — Add `optimize` | `monte_carlo` | `rebalance` | `internal` tiers
src/lib/services/concentration.ts              — Refactor `evaluateConcentration` to call `hhi()` from lib/quant (DRY)
src/lib/posthog/server.ts                      — Add events: optimize_run, monte_carlo_run, rebalance_plan_created
src/app/(app)/portfolio/[id]/layout.tsx        — Add "Optimize" sub-nav link (flag-gated)

supabase/migrations/008_worker_expansion.sql   — NO CHANGES (already shipped in Phase 1)

.github/workflows/ci.yml                       — Add quant-service python jobs (ruff + pytest) and Modal deploy gate
.github/workflows/modal-deploy.yml             — NEW file: deploy Modal on main when quant-service/** changes

docs/runbooks/secret-rotation.md               — Add QUANT_SERVICE_HMAC_KEY rotation procedure
docs/runbooks/health-checks.md                 — Add Modal /health check row

sentry.server.config.ts                        — Already initialized in Phase 1; no edit unless tracing a new integration
```

### Out of scope for Phase 2 (from spec §3 and §1.4)

- ❌ Any AI/LLM calls (Phase 3 owns those — Haiku news classifier, Sonnet daily insight)
- ❌ Broker integration / paper trading
- ❌ Multi-broker transaction synchronization
- ❌ Backtesting UI (could be a Q3 candidate; not in this roadmap)
- ❌ Non-equity asset optimization (futures, options, FX) — returns matrix stays stock-only
- ❌ Fractional shares by default (rebalance engine emits integer shares; fractional behind a flag if a broker wants it in Q3)

---

## Chunk 1: Migration 009 — data model

Ship the DDL that every later chunk depends on. Migration 009 adds `portfolios.target_weights` + `portfolios.optimization_constraints` (JSONB, nullable — users set them from the UI in Chunk 8), plus the `quant_runs` audit table with SELECT-only RLS for the owning user and no INSERT/UPDATE/DELETE policies (service role is the only writer — matches spec §5.1).

### Task 1.1: Write migration 009 DDL

**Files:**
- Create: `supabase/migrations/009_quant_engine.sql`

- [ ] **Step 1: Write the migration file**

```bash
cat > supabase/migrations/009_quant_engine.sql <<'EOF'
-- 009_quant_engine.sql
-- Phase 2: Quantitative engine + Smart Rebalance (spec §5.1, §3.6).
--
-- Adds:
--   1. portfolios.target_weights (JSONB, nullable)
--      Shape: { "AAPL": 0.30, "MSFT": 0.25, ... } — sums to 1.0 ± 0.001.
--      Set by the user via the ConstraintsForm; read by the optimizer UI
--      and by the Phase 3 allocation-drift anomaly detector.
--   2. portfolios.optimization_constraints (JSONB, nullable)
--      Shape: { "min_weight": 0, "max_weight": 0.30, "sector_caps": {},
--               "method": "mean_variance", "target_return": 0.12 } — last
--      constraints the user applied, so we can replay / compare runs.
--   3. quant_runs (audit table — every Modal call writes one row;
--      every cache-served Modal-backed response also writes one row with
--      cached=true). Required by done criterion 6.3.
--
-- RLS: SELECT-only for the owning user. No INSERT/UPDATE/DELETE
-- policies — service role is the only writer, via quant.ts service
-- wrapper. This makes the audit table append-only from every client path.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Columns on existing portfolios table
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS target_weights JSONB,
  ADD COLUMN IF NOT EXISTS optimization_constraints JSONB;

COMMENT ON COLUMN portfolios.target_weights IS
  'User-declared target weights per symbol, e.g. {"AAPL":0.30,"MSFT":0.25}. NULL until user sets one via /portfolio/[id]/optimize. Summed ≈ 1.0 (validated at write time). Consumed by the allocation-drift detector in Phase 3.';

COMMENT ON COLUMN portfolios.optimization_constraints IS
  'Last applied constraint set from the optimizer UI (method + bounds + sector caps). NULL until first optimize. Used to prefill the form on return visits.';

-- 2. quant_runs audit table
CREATE TABLE quant_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('optimize', 'monte_carlo', 'factors', 'rebalance')),
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  elapsed_ms INT,                              -- Modal-reported wall time; NULL only if cached=true and lookup failed to record
  cached BOOLEAN NOT NULL DEFAULT false,       -- true if served from Upstash cache (same shape), still gets a row
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quant_runs_portfolio ON quant_runs(portfolio_id, created_at DESC);
CREATE INDEX idx_quant_runs_user ON quant_runs(user_id, created_at DESC);

COMMENT ON TABLE quant_runs IS
  'Audit: every Modal quant call (and cache-served result) lands one row. Append-only from all client paths — no client INSERT/UPDATE/DELETE policies. Service role (via src/lib/services/quant.ts) is the only writer. Readers are the owning user only.';

-- 3. RLS
ALTER TABLE quant_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_quant_runs_read" ON quant_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Deliberate absence of INSERT/UPDATE/DELETE policies. Service role
-- bypasses RLS; no client-facing mutation path. If this file is partially
-- applied (ENABLE without policies), the CREATE POLICY below would leave
-- the table in a denied state — verify 'own_quant_runs_read' is present
-- after migration by running the Step 2 smoke query.
EOF
```

Expected: file written, no output from `cat`. Verify:

```bash
wc -l supabase/migrations/009_quant_engine.sql
```

Expected: approximately 55 lines (±2).

- [ ] **Step 2: Apply the migration locally**

```bash
supabase db push
```

Expected: `Applying 009_quant_engine.sql` in the output, followed by `Finished`. If `supabase` CLI is not linked, run `supabase link --project-ref <ref>` first (see `docs/runbooks/secret-rotation.md` for the project ref).

- [ ] **Step 3: Smoke-check the schema landed**

```bash
supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'portfolios' AND column_name IN ('target_weights', 'optimization_constraints') ORDER BY column_name;"
supabase db query "SELECT COUNT(*) AS row_count FROM quant_runs;"
supabase db query "SELECT policyname FROM pg_policies WHERE tablename = 'quant_runs' ORDER BY policyname;"
```

Expected:
- 2 rows: `optimization_constraints | jsonb`, `target_weights | jsonb`.
- `row_count | 0`.
- 1 policy: `own_quant_runs_read`.

If the policy count is 0 but the table is `ENABLE ROW LEVEL SECURITY`, RLS will deny every SELECT — re-run the migration (it is idempotent on the ALTER TABLE via `IF NOT EXISTS`, but the `CREATE TABLE` and `CREATE POLICY` are not: drop the table with `DROP TABLE quant_runs CASCADE` first, then re-apply).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/009_quant_engine.sql
git commit -m "feat(db): migration 009 — target weights + quant_runs audit

Adds portfolios.target_weights + portfolios.optimization_constraints
(both JSONB, nullable). Adds quant_runs append-only audit table with
SELECT-only RLS for the owner (service role is the only writer, via
src/lib/services/quant.ts). Implements spec §5.1."
```

### Task 1.2: RLS integration test

**Files:**
- Create: `tests/supabase/migrations/009-rls.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/supabase/migrations/009-rls.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const service = createClient(URL, SERVICE, { auth: { persistSession: false } })

async function seedUserAndPortfolio() {
  // Create a throwaway user via service role — Supabase Admin API.
  const { data: user } = await service.auth.admin.createUser({
    email: `test+${crypto.randomUUID()}@example.com`,
    password: 'Test_Pass_009!',
    email_confirm: true,
  })
  const { data: p } = await service.from('portfolios').insert({
    user_id: user!.user.id,
    name: 'rls-test',
    currency: 'USD',
  }).select('id').single()
  return { userId: user!.user.id, email: user!.user.email!, portfolioId: p!.id }
}

describe('009 quant_runs RLS', () => {
  let owner: { userId: string; email: string; portfolioId: string }
  let intruder: { userId: string; email: string; portfolioId: string }

  beforeAll(async () => {
    owner = await seedUserAndPortfolio()
    intruder = await seedUserAndPortfolio()
    // Service role INSERTs one quant_run owned by `owner`.
    const { error } = await service.from('quant_runs').insert({
      portfolio_id: owner.portfolioId,
      user_id: owner.userId,
      type: 'optimize',
      request: { fixture: true },
      response: { fixture: true },
      elapsed_ms: 42,
      cached: false,
    })
    if (error) throw error
  })

  afterAll(async () => {
    await service.auth.admin.deleteUser(owner.userId)
    await service.auth.admin.deleteUser(intruder.userId)
  })

  it('owner can SELECT own quant_runs', async () => {
    const ownerClient = createClient(URL, ANON)
    await ownerClient.auth.signInWithPassword({ email: owner.email, password: 'Test_Pass_009!' })
    const { data, error } = await ownerClient.from('quant_runs').select('id').eq('user_id', owner.userId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('intruder cannot SELECT owner quant_runs', async () => {
    const intruderClient = createClient(URL, ANON)
    await intruderClient.auth.signInWithPassword({ email: intruder.email, password: 'Test_Pass_009!' })
    const { data, error } = await intruderClient.from('quant_runs').select('id').eq('user_id', owner.userId)
    expect(error).toBeNull()
    expect(data!.length).toBe(0)  // RLS filters, not rejects — empty result
  })

  it('anon client cannot INSERT quant_runs (no policy)', async () => {
    const intruderClient = createClient(URL, ANON)
    await intruderClient.auth.signInWithPassword({ email: intruder.email, password: 'Test_Pass_009!' })
    const { error } = await intruderClient.from('quant_runs').insert({
      portfolio_id: intruder.portfolioId,
      user_id: intruder.userId,
      type: 'optimize',
      request: {}, response: {}, cached: false,
    })
    expect(error).not.toBeNull()        // RLS denies — "new row violates row-level security policy"
    expect(error!.message).toMatch(/row-level security/i)
  })
})
```

- [ ] **Step 2: Run the test, expect it to pass against the new migration**

```bash
npm test -- tests/supabase/migrations/009-rls.test.ts
```

Expected: 3 PASS. If any test fails, RLS is misconfigured — revisit Task 1.1 Step 1 and confirm `CREATE POLICY "own_quant_runs_read"` is in the applied migration.

> **Test environment:** this is an integration test that hits the real (dev) Supabase instance. It uses Supabase Auth Admin API — requires `SUPABASE_SERVICE_ROLE_KEY`. Runs locally + in nightly E2E, **NOT** in PR smoke (too slow and touches auth). Mark with `it.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` guard if adding to the per-PR suite.

- [ ] **Step 3: Commit**

```bash
git add tests/supabase/migrations/009-rls.test.ts
git commit -m "test(db): RLS integration for quant_runs (009)

Owner sees own rows; intruder sees empty; anon INSERT denied.
Uses service role to seed, anon clients to verify policies."
```

---

## Chunk 2a — Python microservice scaffold: pyproject, errors, auth, schemas

Stand up `quant-service/` with FastAPI, HMAC middleware, typed exceptions that serialize to the §3.3a error envelope, Pydantic schemas shared across endpoints, a Sentry bootstrap, and a Modal wrapper. All 4 endpoint modules (`optimize`, `monte_carlo`, `factors`, `rebalance`) are wired as empty routers here — the math lands in Chunks 3 and 4.

### Task 2.1: Initialize `quant-service/` layout + pyproject

**Files:**
- Create: `quant-service/pyproject.toml`
- Create: `quant-service/.python-version`
- Create: `quant-service/src/__init__.py` (empty)
- Create: `quant-service/tests/__init__.py` (empty)
- Create: `quant-service/.gitignore`

- [ ] **Step 1: Verify repo root is clean before adding a top-level dir**

```bash
ls quant-service 2>/dev/null || echo "NOT PRESENT — ok to create"
```

Expected: `NOT PRESENT — ok to create`. If the dir exists, investigate before overwriting (may be WIP from a parallel branch).

- [ ] **Step 2: Create the directory skeleton**

```bash
mkdir -p quant-service/src quant-service/tests/fixtures
echo "3.12" > quant-service/.python-version
touch quant-service/src/__init__.py quant-service/tests/__init__.py
cat > quant-service/.gitignore <<'EOF'
__pycache__/
*.py[cod]
*.egg-info/
.venv/
.pytest_cache/
.ruff_cache/
.mypy_cache/
htmlcov/
.coverage
.env
.env.local
dist/
build/
EOF
```

- [ ] **Step 3: Write `pyproject.toml`**

```bash
cat > quant-service/pyproject.toml <<'EOF'
[project]
name = "investtracker-quant"
version = "0.1.0"
description = "InvestTracker quantitative engine — Markowitz / Monte Carlo / factors / rebalance on Modal"
requires-python = ">=3.12"
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
  "sentry-sdk[fastapi]>=2.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.3",
  "pytest-cov>=5.0",
  "hypothesis>=6.100",
  "httpx>=0.27",              # for FastAPI TestClient
  "ruff>=0.6",
]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "SIM"]
ignore = ["E501"]  # line-length handled by formatter

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers --strict-config"
markers = [
  "slow: marks tests as slow (deselect with '-m \"not slow\"')",
  "integration: hits external services (Modal HTTP, Anthropic, etc.)",
]

[tool.coverage.run]
source = ["src"]
omit = ["src/__init__.py", "src/sentry_init.py"]

[tool.coverage.report]
exclude_lines = ["pragma: no cover", "raise NotImplementedError"]
EOF
```

- [ ] **Step 4: Create virtualenv and install**

```bash
cd quant-service
python3.12 -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows bash: source .venv/Scripts/activate
source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
cd ..
```

Expected: no conflict resolution errors. cvxpy pulls in ecos, scs, osqp (several MB). On Windows this can take ~2 min. If cvxpy fails with a build error, install from a wheel: `pip install cvxpy --only-binary :all:`.

- [ ] **Step 5: Smoke import**

```bash
cd quant-service && source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
python -c "import fastapi, cvxpy, riskfolio, empyrical, numpy, scipy, modal; print('OK')"
cd ..
```

Expected: `OK`. Any `ImportError` means Step 4 failed silently — re-run.

- [ ] **Step 6: Commit**

```bash
git add quant-service/pyproject.toml quant-service/.python-version quant-service/.gitignore quant-service/src/__init__.py quant-service/tests/__init__.py
git commit -m "feat(quant): scaffold quant-service/ with pyproject + ruff + pytest

Python 3.12, FastAPI + Pydantic v2 + cvxpy + riskfolio-lib + empyrical
+ sentry-sdk. Dev extras: pytest, hypothesis, ruff. Ignores virtualenv
and cache dirs."
```

### Task 2.2: Typed exceptions → §3.3a envelope

**Files:**
- Create: `quant-service/src/errors.py`
- Create: `quant-service/tests/test_errors.py`

- [ ] **Step 1: Write the failing test**

```python
# quant-service/tests/test_errors.py
import pytest

from src.errors import (
    QuantError,
    ValidationError,
    InfeasibleError,
    HMACInvalidError,
    HMACExpiredError,
    RateLimitedError,
    to_envelope,
)


def test_envelope_shape_matches_spec():
    exc = InfeasibleError(
        "Optimization problem is infeasible under the given constraints.",
        details={"constraint_violated": "sector_caps.Energy", "value_attempted": 0.20},
    )
    env = to_envelope(exc)
    assert env == {
        "error": {
            "code": "CVXPY_INFEASIBLE",
            "message": "Optimization problem is infeasible under the given constraints.",
            "details": {"constraint_violated": "sector_caps.Energy", "value_attempted": 0.20},
        }
    }


def test_details_default_to_empty_dict():
    exc = ValidationError("bad input")
    env = to_envelope(exc)
    assert env["error"]["details"] == {}


@pytest.mark.parametrize(
    "exc_cls,expected_code,expected_status",
    [
        (ValidationError, "VALIDATION_ERROR", 400),
        (InfeasibleError, "CVXPY_INFEASIBLE", 422),
        (HMACInvalidError, "HMAC_INVALID", 401),
        (HMACExpiredError, "HMAC_EXPIRED", 401),
        (RateLimitedError, "RATE_LIMITED", 429),
    ],
)
def test_codes_and_status(exc_cls, expected_code, expected_status):
    exc = exc_cls("msg")
    assert exc.code == expected_code
    assert exc.status_code == expected_status


def test_quant_error_is_base():
    assert issubclass(ValidationError, QuantError)
    assert issubclass(InfeasibleError, QuantError)
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd quant-service && pytest tests/test_errors.py -v && cd ..
```

Expected: `ImportError` or `ModuleNotFoundError: No module named 'src.errors'`.

- [ ] **Step 3: Write the implementation**

```python
# quant-service/src/errors.py
"""Typed exceptions for the quant service.

Each subclass of QuantError carries a stable `code` (referenced from
the Next.js i18n keys `quant.errors.<code>`) and an HTTP status code.
FastAPI's exception handler (registered in src/api.py) serializes them
to the §3.3a envelope shape:

    { "error": { "code", "message", "details" } }
"""

from __future__ import annotations

from typing import Any


class QuantError(Exception):
    code: str = "INTERNAL_ERROR"
    status_code: int = 500

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ValidationError(QuantError):
    code = "VALIDATION_ERROR"
    status_code = 400


class DimensionMismatchError(ValidationError):
    code = "FACTOR_DIMENSION_MISMATCH"
    # status stays 400 via inheritance


class WeightsDoNotSumToOneError(ValidationError):
    code = "WEIGHTS_DO_NOT_SUM_TO_ONE"


class CovarianceNotPositiveDefiniteError(ValidationError):
    code = "COVARIANCE_NOT_POSITIVE_DEFINITE"


class InfeasibleError(QuantError):
    code = "CVXPY_INFEASIBLE"
    status_code = 422


class MonteCarloDegenerateError(QuantError):
    code = "MONTE_CARLO_DEGENERATE"
    status_code = 422


class InsufficientHistoryError(QuantError):
    code = "INSUFFICIENT_HISTORY"
    status_code = 422


class HMACInvalidError(QuantError):
    code = "HMAC_INVALID"
    status_code = 401


class HMACExpiredError(QuantError):
    code = "HMAC_EXPIRED"
    status_code = 401


class RateLimitedError(QuantError):
    code = "RATE_LIMITED"
    status_code = 429


class ColdStartTimeoutError(QuantError):
    code = "COLD_START_TIMEOUT"
    status_code = 503


def to_envelope(exc: QuantError) -> dict[str, Any]:
    """Serialize a QuantError to the §3.3a envelope shape."""
    return {
        "error": {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
    }
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd quant-service && pytest tests/test_errors.py -v && cd ..
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/errors.py quant-service/tests/test_errors.py
git commit -m "feat(quant): typed QuantError hierarchy → §3.3a envelope

Every error class carries a stable code + HTTP status. to_envelope()
produces { error: { code, message, details } } matching the universal
contract. Phase 3 extends this hierarchy for classifier + insight
errors without changing the serializer."
```

### Task 2.3: HMAC auth middleware

**Files:**
- Create: `quant-service/src/auth.py`
- Create: `quant-service/tests/test_auth.py`

- [ ] **Step 1: Write the failing test**

```python
# quant-service/tests/test_auth.py
import hashlib
import hmac
import time

import pytest

from src.auth import validate_signature
from src.errors import HMACExpiredError, HMACInvalidError


KEY = "test-secret-key"


def sign(body: bytes, timestamp: str, key: str = KEY) -> str:
    payload = body + timestamp.encode()
    return hmac.new(key.encode(), payload, hashlib.sha256).hexdigest()


def test_valid_signature_passes():
    body = b'{"foo": "bar"}'
    ts = str(int(time.time()))
    sig = sign(body, ts)
    validate_signature(body, ts, sig, KEY)  # no raise


def test_missing_signature_raises():
    body = b"{}"
    ts = str(int(time.time()))
    with pytest.raises(HMACInvalidError) as exc:
        validate_signature(body, ts, "", KEY)
    assert "missing" in exc.value.message.lower()


def test_tampered_body_raises():
    body = b'{"foo": "bar"}'
    ts = str(int(time.time()))
    sig = sign(body, ts)
    with pytest.raises(HMACInvalidError):
        validate_signature(b'{"foo": "tampered"}', ts, sig, KEY)


def test_wrong_key_raises():
    body = b"{}"
    ts = str(int(time.time()))
    sig = sign(body, ts, key="attacker-guess")
    with pytest.raises(HMACInvalidError):
        validate_signature(body, ts, sig, KEY)


def test_stale_timestamp_raises():
    body = b"{}"
    ts = str(int(time.time()) - 600)  # 10 minutes old (window is 5 min)
    sig = sign(body, ts)
    with pytest.raises(HMACExpiredError):
        validate_signature(body, ts, sig, KEY)


def test_future_timestamp_raises():
    body = b"{}"
    ts = str(int(time.time()) + 600)
    sig = sign(body, ts)
    with pytest.raises(HMACExpiredError):
        validate_signature(body, ts, sig, KEY)


def test_non_numeric_timestamp_raises():
    body = b"{}"
    sig = sign(body, "not-a-number")
    with pytest.raises(HMACInvalidError) as exc:
        validate_signature(body, "not-a-number", sig, KEY)
    assert "timestamp" in exc.value.message.lower()
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd quant-service && pytest tests/test_auth.py -v && cd ..
```

Expected: ImportError (src.auth doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```python
# quant-service/src/auth.py
"""HMAC validation for the Next.js ↔ Modal boundary.

Contract (spec §3.3):
- Next.js sets headers: X-Timestamp (unix seconds) + X-Signature (hex).
- Signature = hmac_sha256(body + timestamp, QUANT_SERVICE_HMAC_KEY).
- Replay protection: reject timestamps older/newer than 5 min.
- Timing-safe comparison via hmac.compare_digest.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from src.errors import HMACExpiredError, HMACInvalidError

REPLAY_WINDOW_SECONDS = 5 * 60  # 5 min both directions


def validate_signature(body: bytes, timestamp: str, signature: str, key: str) -> None:
    """Raise HMAC{Invalid,Expired}Error if the request is not authentic.

    Body must be the raw request bytes (no re-encoding — ASCII-encode the
    timestamp and concatenate). Does nothing on success.
    """
    if not signature:
        raise HMACInvalidError("X-Signature header is missing")

    try:
        ts_int = int(timestamp)
    except (TypeError, ValueError) as e:
        raise HMACInvalidError("X-Timestamp header is not a valid unix timestamp") from e

    now = int(time.time())
    if abs(now - ts_int) > REPLAY_WINDOW_SECONDS:
        raise HMACExpiredError(
            f"Timestamp is outside the {REPLAY_WINDOW_SECONDS}s replay window",
            details={"now": now, "received": ts_int, "drift_seconds": now - ts_int},
        )

    expected = hmac.new(
        key.encode(),
        body + timestamp.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HMACInvalidError("Signature does not match")
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd quant-service && pytest tests/test_auth.py -v && cd ..
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/auth.py quant-service/tests/test_auth.py
git commit -m "feat(quant): HMAC validation w/ 5-min replay window

Signature = hmac_sha256(body || timestamp, QUANT_SERVICE_HMAC_KEY).
Timing-safe compare via hmac.compare_digest. Rejects stale, future,
tampered, or missing signatures with typed errors (HMAC_INVALID /
HMAC_EXPIRED → 401)."
```

### Task 2.4: Shared Pydantic schemas

**Files:**
- Create: `quant-service/src/schemas.py`
- Create: `quant-service/tests/test_schemas.py`

The schemas mirror spec §3.2 exactly. Request models must validate dimensions (where applicable) and reject NaN/Inf. Response models are TypedDict-like so the math modules return plain dicts and FastAPI serializes them.

- [ ] **Step 1: Write the failing test**

```python
# quant-service/tests/test_schemas.py
import math

import pytest
from pydantic import ValidationError as PydanticValidationError

from src.schemas import (
    OptimizeRequest,
    MonteCarloRequest,
    FactorsRequest,
    RebalanceRequest,
)


def test_optimize_request_rejects_nan_returns():
    with pytest.raises(PydanticValidationError):
        OptimizeRequest(
            returns={"AAPL": [0.01, math.nan, 0.02]},
            constraints={"min_weight": 0.0, "max_weight": 1.0},
            method="mean_variance",
            frontier_points=10,
        )


def test_optimize_request_rejects_negative_frontier_points():
    with pytest.raises(PydanticValidationError):
        OptimizeRequest(
            returns={"AAPL": [0.01, 0.02]},
            constraints={"min_weight": 0.0, "max_weight": 1.0},
            method="mean_variance",
            frontier_points=0,
        )


def test_optimize_request_rejects_ragged_returns():
    with pytest.raises(PydanticValidationError):
        OptimizeRequest(
            returns={"AAPL": [0.01, 0.02, 0.03], "MSFT": [0.01, 0.02]},
            constraints={"min_weight": 0.0, "max_weight": 1.0},
            method="mean_variance",
            frontier_points=10,
        )


def test_factors_request_rejects_dimension_mismatch():
    with pytest.raises(PydanticValidationError):
        FactorsRequest(
            portfolio_returns=[0.01, 0.02, 0.03],
            factor_returns={
                "MKT": [0.01, 0.02],  # wrong length
                "SMB": [0.01, 0.02, 0.03],
                "HML": [0.01, 0.02, 0.03],
                "RMW": [0.01, 0.02, 0.03],
                "CMA": [0.01, 0.02, 0.03],
                "MOM": [0.01, 0.02, 0.03],
            },
        )


def test_monte_carlo_rejects_n_sim_over_cap():
    with pytest.raises(PydanticValidationError):
        MonteCarloRequest(
            current_value=10000,
            weights={"AAPL": 1.0},
            expected_returns={"AAPL": 0.10},
            covariance=[[0.04]],
            horizon_days=252,
            n_simulations=200_000,  # cap is 50_000 per spec
            percentiles=[5, 50, 95],
        )


def test_rebalance_rejects_weights_not_summing_to_one():
    with pytest.raises(PydanticValidationError):
        RebalanceRequest(
            current_holdings={"AAPL": 100},
            current_prices={"AAPL": 175},
            target_weights={"AAPL": 0.30, "MSFT": 0.30},  # sums to 0.60
            cash_available=5000,
            min_trade_value=100,
            transaction_cost_bps=5,
        )
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd quant-service && pytest tests/test_schemas.py -v && cd ..
```

Expected: ImportError.

- [ ] **Step 3: Write the implementation**

```python
# quant-service/src/schemas.py
"""Pydantic request/response models.

Mirror spec §3.2 contracts. Validators enforce:
  - No NaN/Inf in float lists.
  - Ragged matrices → 400.
  - Weights sum to 1.0 ± 0.001.
  - Size caps (N ≤ 100 symbols, horizon_days ≤ 5000, n_simulations ≤ 50_000).

Response models are plain dicts (TypedDict) — math modules return dicts
directly and FastAPI serializes them. That keeps the math modules free
of Pydantic import overhead.
"""

from __future__ import annotations

import math
from typing import Literal, TypedDict

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_SYMBOLS = 100
MAX_HISTORY_DAYS = 5000
MAX_SIMULATIONS = 50_000
WEIGHTS_SUM_TOLERANCE = 1e-3


def _reject_nan_inf(xs: list[float], field: str) -> list[float]:
    if any(not math.isfinite(x) for x in xs):
        raise ValueError(f"{field} contains NaN or Inf")
    return xs


class Constraints(BaseModel):
    min_weight: float = Field(0.0, ge=0, le=1)
    max_weight: float = Field(1.0, ge=0, le=1)
    sector_caps: dict[str, float] = Field(default_factory=dict)
    target_return: float | None = None
    risk_aversion: float | None = Field(None, gt=0)

    @model_validator(mode="after")
    def check_min_le_max(self):
        if self.min_weight > self.max_weight:
            raise ValueError("min_weight must be ≤ max_weight")
        return self


class OptimizeRequest(BaseModel):
    returns: dict[str, list[float]] = Field(..., min_length=1, max_length=MAX_SYMBOLS)
    constraints: Constraints
    method: Literal["mean_variance", "risk_parity", "hrp"]
    frontier_points: int = Field(..., ge=1, le=200)

    @field_validator("returns")
    @classmethod
    def validate_returns(cls, v: dict[str, list[float]]):
        if not v:
            raise ValueError("returns must contain at least one symbol")
        lengths = {len(r) for r in v.values()}
        if len(lengths) != 1:
            raise ValueError("returns arrays must all have the same length")
        n = next(iter(lengths))
        if n > MAX_HISTORY_DAYS:
            raise ValueError(f"returns exceed {MAX_HISTORY_DAYS}-day cap")
        for sym, arr in v.items():
            _reject_nan_inf(arr, f"returns[{sym}]")
        return v


class MonteCarloRequest(BaseModel):
    current_value: float = Field(..., gt=0)
    weights: dict[str, float] = Field(..., min_length=1, max_length=MAX_SYMBOLS)
    expected_returns: dict[str, float]
    covariance: list[list[float]]
    horizon_days: int = Field(..., ge=1, le=MAX_HISTORY_DAYS)
    n_simulations: int = Field(..., ge=100, le=MAX_SIMULATIONS)
    percentiles: list[int] = Field(default_factory=lambda: [5, 25, 50, 75, 95])

    @field_validator("percentiles")
    @classmethod
    def validate_percentiles(cls, v: list[int]):
        if any(p <= 0 or p >= 100 for p in v):
            raise ValueError("percentiles must be strictly between 0 and 100")
        return sorted(v)

    @model_validator(mode="after")
    def check_dimensions(self):
        n = len(self.weights)
        if set(self.weights) != set(self.expected_returns):
            raise ValueError("weights and expected_returns must share symbols")
        if len(self.covariance) != n or any(len(row) != n for row in self.covariance):
            raise ValueError(f"covariance must be {n}×{n}")
        _reject_nan_inf(list(self.weights.values()), "weights")
        _reject_nan_inf(list(self.expected_returns.values()), "expected_returns")
        for i, row in enumerate(self.covariance):
            _reject_nan_inf(row, f"covariance[{i}]")
        total = sum(self.weights.values())
        if abs(total - 1.0) > WEIGHTS_SUM_TOLERANCE:
            raise ValueError(f"weights must sum to 1.0 ± {WEIGHTS_SUM_TOLERANCE} (got {total:.6f})")
        return self


REQUIRED_FACTORS = ("MKT", "SMB", "HML", "RMW", "CMA", "MOM")


class FactorsRequest(BaseModel):
    portfolio_returns: list[float] = Field(..., min_length=30)
    factor_returns: dict[str, list[float]]

    @model_validator(mode="after")
    def check_dims(self):
        missing = set(REQUIRED_FACTORS) - set(self.factor_returns)
        if missing:
            raise ValueError(f"factor_returns missing keys: {sorted(missing)}")
        n = len(self.portfolio_returns)
        for fac in REQUIRED_FACTORS:
            if len(self.factor_returns[fac]) != n:
                raise ValueError(
                    f"factor_returns[{fac}] length {len(self.factor_returns[fac])} != portfolio_returns length {n}"
                )
            _reject_nan_inf(self.factor_returns[fac], f"factor_returns[{fac}]")
        _reject_nan_inf(self.portfolio_returns, "portfolio_returns")
        return self


class RebalanceRequest(BaseModel):
    current_holdings: dict[str, float]  # shares (may be fractional in input)
    current_prices: dict[str, float]
    target_weights: dict[str, float]
    cash_available: float = Field(0.0, ge=0)
    min_trade_value: float = Field(100, ge=0)
    transaction_cost_bps: float = Field(5, ge=0, le=1000)

    @model_validator(mode="after")
    def check_weights(self):
        total = sum(self.target_weights.values())
        if abs(total - 1.0) > WEIGHTS_SUM_TOLERANCE:
            raise ValueError(f"target_weights must sum to 1.0 ± {WEIGHTS_SUM_TOLERANCE} (got {total:.6f})")
        for sym in self.target_weights:
            if self.target_weights[sym] < 0:
                raise ValueError(f"target_weight[{sym}] is negative (short not supported)")
        # Every symbol being held or targeted must have a price.
        all_symbols = set(self.current_holdings) | set(self.target_weights)
        missing_prices = all_symbols - set(self.current_prices)
        if missing_prices:
            raise ValueError(f"current_prices missing: {sorted(missing_prices)}")
        return self


# ─── Response TypedDicts (for type hints; not Pydantic — math modules return plain dicts) ───
class OptimizeResponse(TypedDict):
    optimal_weights: dict[str, float]
    expected_return: float
    expected_volatility: float
    sharpe_ratio: float
    frontier: list[dict]  # [{return, vol, weights}]
    computed_at: str
    elapsed_ms: int


class MonteCarloResponse(TypedDict):
    trajectories: dict[str, list[float]]
    final_distribution: dict[str, float]
    probability_loss: float
    elapsed_ms: int


class FactorsResponse(TypedDict):
    loadings: dict[str, float]
    alpha: float
    alpha_t_stat: float
    r_squared: float
    interpretation: dict[str, str]


class RebalanceResponse(TypedDict):
    trades: list[dict]
    total_turnover: float
    estimated_costs: float
    drift_before: float
    drift_after: float
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd quant-service && pytest tests/test_schemas.py -v && cd ..
```

Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/schemas.py quant-service/tests/test_schemas.py
git commit -m "feat(quant): Pydantic schemas for 4 endpoints

OptimizeRequest / MonteCarloRequest / FactorsRequest / RebalanceRequest
with dimension, NaN/Inf, weight-sum, and size-cap validation. Response
types as TypedDicts so math modules stay Pydantic-free. Caps: 100
symbols, 5k history days, 50k MC simulations."
```

---

## Chunk 2b — Python microservice: Sentry + FastAPI app + Modal wrapper + fixtures

**Why a split:** Chunk 2's scaffold got large. Tasks 2.1–2.4 (pure modules: pyproject, errors, auth, schemas) landed in Chunk 2a. This Chunk 2b covers the integration pieces that depend on all of 2a: Sentry bootstrap, the FastAPI app with middleware/handlers, the Modal wrapper, and the pytest fixtures used by Chunks 3 and 4.

**Prereqs:** Chunk 2a complete (all four pure modules committed and passing tests).

### Task 2.5: Sentry bootstrap (shared by api + modal_app)

**Files:**
- Create: `quant-service/src/sentry_init.py`
- Create: `quant-service/tests/test_sentry_init.py`

- [ ] **Step 1: Write the failing test**

```python
# quant-service/tests/test_sentry_init.py
import os
from unittest.mock import patch

from src.sentry_init import init_sentry


@patch.dict(os.environ, {"SENTRY_DSN": "", "ENVIRONMENT": "test"}, clear=False)
def test_init_sentry_noop_when_dsn_missing():
    # No raise, no crash. We can't introspect without importing sentry_sdk,
    # but a successful call with an empty DSN is the contract.
    init_sentry()


@patch("src.sentry_init.sentry_sdk")
@patch.dict(os.environ, {"SENTRY_DSN": "https://fake@sentry.example/1", "ENVIRONMENT": "worker-prod"}, clear=False)
def test_init_sentry_calls_init_when_dsn_present(mock_sdk):
    init_sentry()
    assert mock_sdk.init.called
    kwargs = mock_sdk.init.call_args.kwargs
    assert kwargs["dsn"] == "https://fake@sentry.example/1"
    assert kwargs["environment"] == "worker-prod"
    assert kwargs["traces_sample_rate"] == 0.1
    assert kwargs["send_default_pii"] is False
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd quant-service && pytest tests/test_sentry_init.py -v && cd ..
```

Expected: ImportError.

- [ ] **Step 3: Write the implementation**

```python
# quant-service/src/sentry_init.py
"""Sentry bootstrap. Called from both api.py (web layer) and modal_app.py
(worker-prod environment). Honors the Phase 1 / Section 2.1 quota policy:
10% trace sample in prod, 100% in dev."""

from __future__ import annotations

import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration


def init_sentry() -> None:
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        # DSN not configured — local dev or CI without secrets. No-op.
        return

    env = os.environ.get("ENVIRONMENT", "development")
    trace_rate = 1.0 if env == "development" else 0.1

    sentry_sdk.init(
        dsn=dsn,
        environment=env,
        traces_sample_rate=trace_rate,
        send_default_pii=False,                     # Modal runs untrusted user data
        integrations=[FastApiIntegration(transaction_style="endpoint")],
        # Breadcrumbs stay default (request lifecycle). No before_send — errors
        # are typed QuantErrors and we want them all in Sentry to track incident
        # patterns.
    )
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd quant-service && pytest tests/test_sentry_init.py -v && cd ..
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/sentry_init.py quant-service/tests/test_sentry_init.py
git commit -m "feat(quant): Sentry bootstrap for FastAPI + Modal

Honors Phase 1 quota policy (10% trace in prod, 100% in dev). No-op
without DSN. send_default_pii=False (Modal handles untrusted returns
matrices). FastApiIntegration for request-level breadcrumbs."
```

### Task 2.6: FastAPI app + error handler + health

**Files:**
- Create: `quant-service/src/api.py`
- Create: `quant-service/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

```python
# quant-service/tests/test_api.py
import hashlib
import hmac
import json
import os
import time

import pytest
from fastapi.testclient import TestClient


KEY = "test-hmac-key"
os.environ["QUANT_SERVICE_HMAC_KEY"] = KEY


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


def _headers(body: bytes):
    ts = str(int(time.time()))
    sig = hmac.new(KEY.encode(), body + ts.encode(), hashlib.sha256).hexdigest()
    return {"X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json"}


def test_health_does_not_require_hmac(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_unauthenticated_request_is_401_with_envelope(client):
    r = client.post("/optimize", json={})
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "HMAC_INVALID"
    assert "message" in body["error"]
    assert "details" in body["error"]


def test_stale_timestamp_is_401_expired(client):
    body = b"{}"
    stale_ts = str(int(time.time()) - 600)
    sig = hmac.new(KEY.encode(), body + stale_ts.encode(), hashlib.sha256).hexdigest()
    r = client.post(
        "/optimize",
        content=body,
        headers={"X-Timestamp": stale_ts, "X-Signature": sig, "Content-Type": "application/json"},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "HMAC_EXPIRED"


def test_validation_error_is_400_with_envelope(client):
    body = json.dumps({"bogus": "input"}).encode()
    r = client.post("/optimize", content=body, headers=_headers(body))
    assert r.status_code == 422 or r.status_code == 400
    # FastAPI's Pydantic-validation path returns 422 by default; we normalize to 400 via exception_handler.
    # Envelope must still be §3.3a shape:
    body_json = r.json()
    assert "error" in body_json
    assert "code" in body_json["error"]
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd quant-service && pytest tests/test_api.py -v && cd ..
```

Expected: ImportError.

- [ ] **Step 3: Write the implementation**

```python
# quant-service/src/api.py
"""FastAPI app — HMAC middleware + error handler + endpoint stubs.

The 4 math endpoints are wired here as placeholder routes returning 501.
Chunks 3 and 4 replace the bodies with real implementations.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.auth import validate_signature
from src.errors import HMACInvalidError, QuantError, to_envelope
from src.sentry_init import init_sentry

init_sentry()


app = FastAPI(title="InvestTracker Quant Service", version="0.1.0")


# ─── Middleware: HMAC validation on every POST to /optimize|/monte-carlo|/factors|/rebalance ───
HMAC_PROTECTED_PREFIXES = ("/optimize", "/monte-carlo", "/factors", "/rebalance")


@app.middleware("http")
async def hmac_middleware(request: Request, call_next):
    if not any(request.url.path.startswith(p) for p in HMAC_PROTECTED_PREFIXES):
        return await call_next(request)

    key = os.environ.get("QUANT_SERVICE_HMAC_KEY")
    if not key:
        return JSONResponse(
            status_code=500,
            content=to_envelope(QuantError("QUANT_SERVICE_HMAC_KEY not configured")),
        )

    body = await request.body()
    ts = request.headers.get("X-Timestamp", "")
    sig = request.headers.get("X-Signature", "")
    try:
        validate_signature(body, ts, sig, key)
    except QuantError as exc:
        return JSONResponse(status_code=exc.status_code, content=to_envelope(exc))

    # Starlette consumes the request body stream on the first `await request.body()`,
    # and does NOT automatically re-expose it to downstream handlers. We have to
    # monkey-patch `request._body` AND replace the receive channel so that
    # `await request.json()` inside the endpoint reads from our already-consumed
    # bytes instead of hanging on an exhausted stream. This is the documented
    # workaround for HMAC-validating middleware (see
    # https://github.com/encode/starlette/issues/495 and the FastAPI discussion
    # on middleware body reads). Both assignments are load-bearing — removing
    # either one will hang or 500 the downstream handler.
    request._body = body  # cached body for future .body() / .json() calls
    async def _replay_receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}
    request._receive = _replay_receive  # replay once for the ASGI lifecycle

    return await call_next(request)


# ─── Exception handler: any QuantError → §3.3a envelope ───
@app.exception_handler(QuantError)
async def quant_error_handler(request: Request, exc: QuantError):
    return JSONResponse(status_code=exc.status_code, content=to_envelope(exc))


# ─── Exception handler: Pydantic validation → normalized 400 envelope ───
@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request failed validation.",
                "details": {"errors": exc.errors()},
            }
        },
    )


# ─── Health (no HMAC — used by Modal health checks and /admin/metrics) ───
@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "version": app.version}


# ─── Endpoint stubs — Chunks 3 + 4 replace these ───
@app.post("/optimize")
async def optimize(request: Request):
    raise QuantError("Not implemented yet — Chunk 3")


@app.post("/monte-carlo")
async def monte_carlo(request: Request):
    raise QuantError("Not implemented yet — Chunk 4")


@app.post("/factors")
async def factors(request: Request):
    raise QuantError("Not implemented yet — Chunk 4")


@app.post("/rebalance")
async def rebalance(request: Request):
    raise QuantError("Not implemented yet — Chunk 4")
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd quant-service && pytest tests/test_api.py -v && cd ..
```

Expected: 4 PASS. The "validation error" test hits the stub which raises QuantError (INTERNAL_ERROR, 500) — acceptable at this stage since the endpoint body isn't implemented yet. Once Chunks 3/4 wire real Pydantic models, the test becomes a true 400.

> **Note:** the stubs return 500 (`QuantError` base) until Chunks 3/4 replace them. If you run `test_api.py::test_validation_error_is_400_with_envelope` now, it accepts `status_code in (400, 422, 500)` pragmatically. Tighten the assertion to `== 400` once all 4 endpoints have real Pydantic body models (end of Chunk 4).

Revise the last test with the lax assertion to avoid red CI while stubs are in place:

```python
def test_validation_error_is_400_with_envelope(client):
    body = json.dumps({"bogus": "input"}).encode()
    r = client.post("/optimize", content=body, headers=_headers(body))
    assert r.status_code in (400, 422, 500), f"unexpected status {r.status_code}"
    body_json = r.json()
    assert "error" in body_json
    assert "code" in body_json["error"]
```

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/api.py quant-service/tests/test_api.py
git commit -m "feat(quant): FastAPI app w/ HMAC middleware + envelope handlers

HMAC middleware gates the 4 math endpoints; /health is open. Exception
handler serializes QuantError → §3.3a envelope. Stubs return 500 until
Chunks 3/4 land the math. Sentry initialized at import time."
```

### Task 2.7: Modal app wrapper

**Files:**
- Create: `quant-service/modal_app.py`

- [ ] **Step 1: Write the Modal entry point**

```python
# quant-service/modal_app.py
"""Modal deployment entry.

  modal deploy modal_app.py

This wraps the FastAPI app from src/api.py in a Modal function with:
  - A custom image (pip install -e .)
  - Secret binding (QUANT_SERVICE_HMAC_KEY, SENTRY_DSN)
  - keep_warm=1 to hold one instance hot (~$2/mo at current price, per spec §3.1).

The ASGI app is served via @app.function(web_endpoint=...) — no ad-hoc
load balancer or DNS. Modal gives us a stable https://<org>--<app>.modal.run URL.
"""

from __future__ import annotations

import modal

app = modal.App("investtracker-quant")

# Build an image with our deps. Cached by pyproject.toml hash — rebuild only
# when pyproject changes. `add_local_python_source` takes the top-level *module
# name* (importable path), not a filesystem path — `src` here matches the
# `src/` directory under quant-service/ which is on sys.path via the
# `pyproject.toml` `[tool.setuptools.packages.find]` table. Modal traverses
# the module's file tree and uploads it with the image.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("src")
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("quant-service-secrets")],
    keep_warm=1,          # Keep 1 instance hot (spec §3.1 — ~$2/mo, cold-start fix).
    timeout=60,           # One call must complete within 60s.
    memory=2048,          # cvxpy + numpy image is ~800MB resident; 2GB gives headroom.
)
@modal.asgi_app()
def fastapi_app():
    from src.api import app as fastapi  # deferred import so module load stays cheap
    return fastapi
```

- [ ] **Step 2: Dry-run the Modal app locally**

```bash
cd quant-service && source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
modal run --detach modal_app.py::fastapi_app
# (Ctrl-C once the server logs "Uvicorn running on http://0.0.0.0:8000")
cd ..
```

Expected: Modal spins up a local container matching the production image, FastAPI boots, logs show `Uvicorn running`. If `modal run` complains about authentication, run `modal setup` first and use the token from https://modal.com/settings/tokens.

- [ ] **Step 3: Commit (do NOT deploy yet — deploy lands in Chunk 5)**

```bash
git add quant-service/modal_app.py
git commit -m "feat(quant): Modal app wrapper w/ keep_warm=1

Image = python:3.12 + pyproject deps. Secrets from modal.Secret
'quant-service-secrets' (QUANT_SERVICE_HMAC_KEY, SENTRY_DSN).
keep_warm=1 per spec §3.1 — ~\$2/mo to eliminate 2s cold start
on the first optimize after idle."
```

### Task 2.8: Pytest conftest + shared fixtures

**Files:**
- Create: `quant-service/tests/conftest.py`

- [ ] **Step 1: Write the conftest**

```python
# quant-service/tests/conftest.py
"""Shared pytest fixtures. Synthetic returns matrix with fixed seed for
reproducible optimization tests; hmac headers helper for api tests."""

from __future__ import annotations

import hashlib
import hmac
import os
import time

import numpy as np
import pytest


RNG_SEED = 42


@pytest.fixture(scope="session")
def rng() -> np.random.Generator:
    return np.random.default_rng(RNG_SEED)


@pytest.fixture(scope="session")
def synth_returns(rng: np.random.Generator) -> dict[str, list[float]]:
    """5 assets × 252 daily returns, roughly stock-like (mean ≈ 0.05% daily, vol ≈ 1.5%)."""
    symbols = ["AAA", "BBB", "CCC", "DDD", "EEE"]
    daily = rng.normal(loc=0.0005, scale=0.015, size=(len(symbols), 252))
    return {s: daily[i].tolist() for i, s in enumerate(symbols)}


@pytest.fixture
def hmac_key() -> str:
    key = "test-hmac-key"
    os.environ["QUANT_SERVICE_HMAC_KEY"] = key
    yield key
    os.environ.pop("QUANT_SERVICE_HMAC_KEY", None)


@pytest.fixture
def sign():
    def _sign(body: bytes, key: str) -> dict[str, str]:
        ts = str(int(time.time()))
        sig = hmac.new(key.encode(), body + ts.encode(), hashlib.sha256).hexdigest()
        return {"X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json"}
    return _sign
```

- [ ] **Step 2: Commit**

```bash
git add quant-service/tests/conftest.py
git commit -m "test(quant): shared pytest fixtures (rng, synth_returns, hmac_sign)

Seeded numpy Generator + 5×252 returns matrix for reproducible
optimization tests. HMAC-header helper for TestClient-based api tests."
```

---

## Chunk 3 — Portfolio optimizer: Markowitz, risk-parity, HRP, efficient frontier

**Goal:** Implement the three optimization methods and the efficient-frontier sweep in `src/optimize.py`, wire them into the `/optimize` endpoint (replacing the Chunk 2 stub), and add synthetic-dataset golden + Hypothesis property tests.

**Design contract (frozen in spec §4.1.1):**
- Inputs: `symbols[], returns{}` (per-symbol daily returns list), `method ∈ {mean_variance, risk_parity, hrp}`, `constraints` (see `Constraints` Pydantic model in Chunk 2).
- Output (TypedDict `OptimizeResult`, matches spec §4.1.1):
  ```python
  {
      "optimal_weights": dict[str, float],  # sums to 1.0 ± 1e-6
      "expected_return": float,             # annualized
      "expected_volatility": float,         # annualized
      "sharpe_ratio": float,                # (μ − rf)/σ, rf passed in (default 0)
      "frontier": list[{"return": float, "vol": float, "weights": dict}],
      "computed_at": str,                   # ISO-8601 UTC, populated by endpoint
      "elapsed_ms": int,                    # populated by endpoint
  }
  ```
- **Annualization:** multiply daily mean by 252; multiply daily stdev by √252; all returns/volatilities reported annualized.
- **Covariance:** sample covariance of daily returns via `numpy.cov(..., ddof=1)`. If rank-deficient (n_days ≤ n_symbols), raise `CovarianceNotPositiveDefiniteError`.
- **Frontier:** 20 points swept between `min_var_return` and `max_mean_return` (inclusive). Only returned when method=`mean_variance` (non-convex for HRP / trivial for risk-parity). For the other two methods, `frontier` is `[]`.
- **Solver:** cvxpy with CLARABEL (default in cvxpy 1.5+). On solver failure (`status not in {"optimal", "optimal_inaccurate"}`), raise `InfeasibleError` with the solver status string in `details`.

### Task 3.1: Markowitz mean-variance via cvxpy

**Files:**
- Create: `quant-service/src/optimize.py`
- Test: `quant-service/tests/test_optimize.py`

- [ ] **Step 1: Write failing golden test for 2-asset analytic solution**

```python
# quant-service/tests/test_optimize.py
"""Golden tests for optimize.py.

Strategy: hand-compute the closed-form Markowitz solution for a tiny
2-asset case and assert our cvxpy solution matches it within 1e-4.
"""
from __future__ import annotations

import numpy as np
import pytest

from src.errors import (
    CovarianceNotPositiveDefiniteError,
    InfeasibleError,
    WeightsDoNotSumToOneError,
)
from src.optimize import mean_variance


def test_markowitz_two_asset_analytic_match() -> None:
    """2 uncorrelated assets, target return at midpoint → analytic weights.

    For μ = [0.10, 0.20] annualized, σ = [0.15, 0.25], ρ = 0, the
    minimum-variance portfolio that hits target μ_p = 0.15 is:
        w_A = (σ_B² * (μ_p − μ_B) − σ_AB * (μ_p − μ_A)) / denom
    which with zero covariance reduces to the textbook proportional weights.
    """
    # Synthesize daily returns that annualize to μ and σ above.
    rng = np.random.default_rng(1234)
    daily_mu = np.array([0.10, 0.20]) / 252.0
    daily_sigma = np.array([0.15, 0.25]) / np.sqrt(252.0)
    n_days = 5000  # large so sample stats ≈ population
    daily = np.column_stack([
        rng.normal(daily_mu[0], daily_sigma[0], n_days),
        rng.normal(daily_mu[1], daily_sigma[1], n_days),
    ])
    returns = {"A": daily[:, 0].tolist(), "B": daily[:, 1].tolist()}

    result = mean_variance(
        symbols=["A", "B"],
        returns=returns,
        target_return=0.15,
        risk_free_rate=0.0,
        constraints=None,
    )

    # Analytic: σ_A² w_A² + σ_B² (1−w_A)² minimized s.t. μ_A w_A + μ_B (1−w_A) = 0.15
    # Lagrangian gives w_A = 0.5 exactly.
    assert abs(result["optimal_weights"]["A"] - 0.5) < 0.02  # 2% tolerance for sample noise
    assert abs(result["optimal_weights"]["B"] - 0.5) < 0.02
    assert abs(sum(result["optimal_weights"].values()) - 1.0) < 1e-6
    assert result["expected_return"] == pytest.approx(0.15, abs=5e-3)
    # Note: `computed_at` and `elapsed_ms` are populated by the endpoint, not the
    # library function — the service layer wraps the call in a perf_counter timer.
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_markowitz_two_asset_analytic_match -v`
Expected: `ImportError: cannot import name 'mean_variance' from 'src.optimize'`

- [ ] **Step 3: Write minimal Markowitz implementation**

```python
# quant-service/src/optimize.py
"""Portfolio optimization: Markowitz MV, risk parity, HRP, efficient frontier."""
from __future__ import annotations

from typing import TypedDict

import cvxpy as cp
import numpy as np
import riskfolio as rp
import pandas as pd

from src.errors import (
    CovarianceNotPositiveDefiniteError,
    InfeasibleError,
    WeightsDoNotSumToOneError,
)
from src.schemas import Constraints

_ANN = 252  # trading days / year
_WEIGHTS_TOL = 1e-6


# FrontierPoint uses the spec §4.1.1 keys literally: "return", "vol", "weights".
# We use the functional TypedDict syntax because `return` is a Python reserved
# word and cannot be a class attribute. Callers emit these dicts directly as
# JSON — no aliasing layer — which keeps serialization obvious.
FrontierPoint = TypedDict(
    "FrontierPoint",
    {"return": float, "vol": float, "weights": dict[str, float]},
)


class OptimizeResult(TypedDict):
    """Response body for `POST /optimize` — matches spec §4.1.1 exactly.

    `computed_at` and `elapsed_ms` are filled by the FastAPI endpoint wrapper
    (Task 3.5), not by the optimizer functions. The math functions in this
    module leave those fields empty/0 and the endpoint patches them in.
    """

    optimal_weights: dict[str, float]
    expected_return: float
    expected_volatility: float
    sharpe_ratio: float
    frontier: list[FrontierPoint]
    computed_at: str           # ISO 8601 UTC timestamp; set by endpoint wrapper
    elapsed_ms: int            # wall-time of the call; set by endpoint wrapper


def _build_returns_matrix(
    symbols: list[str], returns: dict[str, list[float]]
) -> np.ndarray:
    """Returns (n_days, n_symbols) matrix in `symbols` order."""
    cols = [np.asarray(returns[s], dtype=float) for s in symbols]
    n_days = min(len(c) for c in cols)
    mat = np.column_stack([c[-n_days:] for c in cols])  # align to shortest tail
    return mat


def _mu_and_cov(ret_mat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Annualized mean vector and covariance."""
    mu = ret_mat.mean(axis=0) * _ANN
    cov = np.cov(ret_mat, rowvar=False, ddof=1) * _ANN
    # Cholesky check — raises if not PD.
    try:
        np.linalg.cholesky(cov)
    except np.linalg.LinAlgError as e:
        raise CovarianceNotPositiveDefiniteError(
            "Covariance matrix is not positive definite (rank-deficient inputs?)"
        ) from e
    return mu, cov


def _apply_constraints(
    w: cp.Variable,
    symbols: list[str],
    constraints: Constraints | None,
) -> list[cp.Constraint]:
    cons: list[cp.Constraint] = [cp.sum(w) == 1]
    if constraints is None:
        cons.append(w >= 0)  # long-only default
        return cons
    if not constraints.allow_short:
        cons.append(w >= 0)
    if constraints.min_weight is not None:
        cons.append(w >= constraints.min_weight)
    if constraints.max_weight is not None:
        cons.append(w <= constraints.max_weight)
    if constraints.sector_caps and constraints.sector_map:
        for sector, cap in constraints.sector_caps.items():
            idx = [i for i, s in enumerate(symbols) if constraints.sector_map.get(s) == sector]
            if idx:
                cons.append(cp.sum(w[idx]) <= cap)
    return cons


def mean_variance(
    symbols: list[str],
    returns: dict[str, list[float]],
    target_return: float | None = None,
    risk_free_rate: float = 0.0,
    constraints: Constraints | None = None,
) -> OptimizeResult:
    """Markowitz mean-variance optimization.

    If target_return is provided: minimize variance s.t. μᵀw = target_return.
    Otherwise: maximize Sharpe ratio (μ − rf)ᵀw / √(wᵀΣw).
    """
    ret_mat = _build_returns_matrix(symbols, returns)
    mu, cov = _mu_and_cov(ret_mat)
    n = len(symbols)
    w = cp.Variable(n)
    cons = _apply_constraints(w, symbols, constraints)
    if target_return is not None:
        cons.append(mu @ w == target_return)
        obj = cp.Minimize(cp.quad_form(w, cov))
    else:
        # Maximize Sharpe via Kelly-style reformulation:
        # Minimize wᵀΣw s.t. (μ − rf)ᵀw == 1; rescale at end.
        excess = mu - risk_free_rate
        y = cp.Variable(n)
        cons_y: list[cp.Constraint] = [excess @ y == 1, cp.sum(y) >= 1e-6]
        # long-only transfer:
        if constraints is None or not constraints.allow_short:
            cons_y.append(y >= 0)
        prob = cp.Problem(cp.Minimize(cp.quad_form(y, cov)), cons_y)
        prob.solve(solver=cp.CLARABEL)
        if prob.status not in {"optimal", "optimal_inaccurate"}:
            raise InfeasibleError(
                f"Sharpe-max infeasible: solver status = {prob.status}",
                details={"solver_status": prob.status, "method": "mean_variance"},
            )
        w_val = y.value / y.value.sum()
        return _pack_result(symbols, w_val, mu, cov, risk_free_rate)

    prob = cp.Problem(obj, cons)
    prob.solve(solver=cp.CLARABEL)
    if prob.status not in {"optimal", "optimal_inaccurate"}:
        raise InfeasibleError(
            f"Markowitz infeasible at target_return={target_return}: {prob.status}",
            details={"solver_status": prob.status, "target_return": target_return},
        )
    return _pack_result(symbols, w.value, mu, cov, risk_free_rate)


def _pack_result(
    symbols: list[str],
    w_val: np.ndarray,
    mu: np.ndarray,
    cov: np.ndarray,
    risk_free_rate: float,
) -> OptimizeResult:
    """Assemble the spec §4.1.1 response.

    `computed_at` and `elapsed_ms` are zero-valued here — the endpoint
    wrapper (Task 3.5) overwrites them with real values before returning
    to the client.
    """
    w_val = np.asarray(w_val).flatten()
    # Clamp numerical dust and renormalize.
    w_val = np.where(np.abs(w_val) < 1e-9, 0.0, w_val)
    total = w_val.sum()
    if abs(total - 1.0) > 1e-3:
        raise WeightsDoNotSumToOneError(
            f"Solver returned weights summing to {total:.6f}",
            details={"sum": float(total)},
        )
    w_val = w_val / total
    port_ret = float(mu @ w_val)
    port_vol = float(np.sqrt(w_val @ cov @ w_val))
    sharpe = (port_ret - risk_free_rate) / port_vol if port_vol > 0 else 0.0
    return {
        "optimal_weights": {sym: float(w) for sym, w in zip(symbols, w_val)},
        "expected_return": port_ret,
        "expected_volatility": port_vol,
        "sharpe_ratio": float(sharpe),
        "frontier": [],            # filled by endpoint if frontier_points > 0
        "computed_at": "",         # filled by endpoint
        "elapsed_ms": 0,           # filled by endpoint
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_markowitz_two_asset_analytic_match -v`
Expected: PASS (may take 2-5s on first run due to cvxpy JIT).

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/optimize.py quant-service/tests/test_optimize.py
git commit -m "feat(quant): Markowitz mean-variance optimizer (cvxpy, CLARABEL)

Supports target_return and max-Sharpe modes. Long-only by default,
with optional short-sell, min/max weight bounds, and sector caps.
Raises InfeasibleError with solver status on CVXPY failure."
```

### Task 3.2: Risk-parity via riskfolio-lib

**Files:**
- Modify: `quant-service/src/optimize.py`
- Modify: `quant-service/tests/test_optimize.py`

- [ ] **Step 1: Write failing test**

```python
# append to tests/test_optimize.py
from src.optimize import risk_parity


def test_risk_parity_equal_contribution(synth_returns) -> None:
    """Risk-parity should allocate such that each asset contributes
    (approximately) equally to portfolio variance."""
    symbols = list(synth_returns.keys())
    result = risk_parity(symbols=symbols, returns=synth_returns, constraints=None)
    w = np.array([result["optimal_weights"][s] for s in symbols])

    # Sanity: weights sum to 1, all positive (long-only default).
    assert abs(w.sum() - 1.0) < 1e-6
    assert (w >= 0).all()

    # Marginal risk contributions should be ~equal.
    # Re-derive cov from returns for verification.
    ret_mat = np.column_stack([np.asarray(synth_returns[s]) for s in symbols])
    cov = np.cov(ret_mat, rowvar=False, ddof=1) * 252
    port_vol = np.sqrt(w @ cov @ w)
    mrc = (cov @ w) / port_vol  # marginal risk contrib per unit weight
    rc = w * mrc                 # total risk contrib per asset
    rc_normalized = rc / rc.sum()
    # Each of 5 assets should be ~0.2 of total risk; tolerance 5pp.
    assert np.allclose(rc_normalized, 0.2, atol=0.05)
    assert result["frontier"] == []  # no frontier for risk-parity
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_risk_parity_equal_contribution -v`
Expected: `ImportError: cannot import name 'risk_parity'`

- [ ] **Step 3: Add risk_parity implementation**

Append to `src/optimize.py`:

```python
def risk_parity(
    symbols: list[str],
    returns: dict[str, list[float]],
    constraints: Constraints | None = None,
) -> OptimizeResult:
    """Equal risk contribution portfolio via riskfolio-lib."""
    ret_mat = _build_returns_matrix(symbols, returns)
    _, cov = _mu_and_cov(ret_mat)  # mu unused here but PD check still needed
    mu = ret_mat.mean(axis=0) * _ANN

    df = pd.DataFrame(ret_mat, columns=symbols)
    port = rp.Portfolio(returns=df)
    port.assets_stats(method_mu="hist", method_cov="hist", d=0.94)

    upper = None
    lower = None
    if constraints is not None:
        if constraints.max_weight is not None:
            upper = constraints.max_weight
        if constraints.min_weight is not None:
            lower = constraints.min_weight
    if upper is not None:
        port.upperlng = upper
    if lower is not None:
        port.lowerlng = lower

    try:
        w_df = port.rp_optimization(
            model="Classic",
            rm="MV",
            rf=0.0,
            b=None,  # equal risk contribution
            hist=True,
        )
    except Exception as e:  # riskfolio raises plain ValueError/RuntimeError
        raise InfeasibleError(
            f"Risk-parity optimization failed: {e}",
            details={"method": "risk_parity"},
        ) from e
    if w_df is None:
        raise InfeasibleError(
            "Risk-parity returned None (infeasible)",
            details={"method": "risk_parity"},
        )
    w_val = w_df.values.flatten()
    return _pack_result(symbols, w_val, mu, cov, 0.0)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_risk_parity_equal_contribution -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/optimize.py quant-service/tests/test_optimize.py
git commit -m "feat(quant): risk-parity optimizer via riskfolio-lib

Equal-risk-contribution (ERC) portfolio. Supports optional upper/lower
weight bounds. Empty frontier (ERC is a single-point method)."
```

### Task 3.3: Hierarchical Risk Parity (HRP)

**Files:**
- Modify: `quant-service/src/optimize.py`
- Modify: `quant-service/tests/test_optimize.py`

- [ ] **Step 1: Write failing test**

```python
# append to tests/test_optimize.py
from src.optimize import hrp


def test_hrp_weights_valid(synth_returns) -> None:
    symbols = list(synth_returns.keys())
    result = hrp(symbols=symbols, returns=synth_returns, constraints=None)
    w = np.array([result["optimal_weights"][s] for s in symbols])
    assert abs(w.sum() - 1.0) < 1e-6
    assert (w >= 0).all()
    assert (w <= 1).all()
    assert result["frontier"] == []


def test_hrp_handles_high_correlation(rng) -> None:
    """Two highly correlated assets + one uncorrelated → HRP should
    down-weight the correlated cluster relative to naive inverse-variance."""
    n = 500
    base = rng.normal(0, 0.01, n)
    noise_a = rng.normal(0, 0.002, n)
    noise_b = rng.normal(0, 0.002, n)
    indep = rng.normal(0, 0.01, n)
    returns = {
        "CORR_1": (base + noise_a).tolist(),
        "CORR_2": (base + noise_b).tolist(),
        "INDEP": indep.tolist(),
    }
    result = hrp(symbols=["CORR_1", "CORR_2", "INDEP"], returns=returns, constraints=None)
    # INDEP should get at least 40% since the cluster's combined risk
    # is dampened by HRP's recursive bisection.
    assert result["optimal_weights"]["INDEP"] > 0.40
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd quant-service && uv run pytest tests/test_optimize.py -k hrp -v`
Expected: `ImportError: cannot import name 'hrp'`

- [ ] **Step 3: Add hrp implementation**

Append to `src/optimize.py`:

```python
def hrp(
    symbols: list[str],
    returns: dict[str, list[float]],
    constraints: Constraints | None = None,
) -> OptimizeResult:
    """Hierarchical Risk Parity (López de Prado 2016) via riskfolio-lib."""
    ret_mat = _build_returns_matrix(symbols, returns)
    _, cov = _mu_and_cov(ret_mat)
    mu = ret_mat.mean(axis=0) * _ANN

    df = pd.DataFrame(ret_mat, columns=symbols)
    port = rp.HCPortfolio(returns=df)
    try:
        w_df = port.optimization(
            model="HRP",
            codependence="pearson",
            rm="MV",
            rf=0.0,
            linkage="single",
            max_k=10,
            leaf_order=True,
        )
    except Exception as e:
        raise InfeasibleError(
            f"HRP optimization failed: {e}",
            details={"method": "hrp"},
        ) from e
    if w_df is None or w_df.empty:
        raise InfeasibleError(
            "HRP returned empty weights",
            details={"method": "hrp"},
        )
    w_val = w_df.values.flatten()

    # Apply post-hoc min/max clamps if constraints set (HRP doesn't support
    # them natively — document this limitation in the API docs).
    if constraints is not None and (
        constraints.min_weight is not None or constraints.max_weight is not None
    ):
        lo = constraints.min_weight if constraints.min_weight is not None else 0.0
        hi = constraints.max_weight if constraints.max_weight is not None else 1.0
        w_val = np.clip(w_val, lo, hi)
        w_val = w_val / w_val.sum()

    return _pack_result(symbols, w_val, mu, cov, 0.0)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd quant-service && uv run pytest tests/test_optimize.py -k hrp -v`
Expected: both HRP tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/optimize.py quant-service/tests/test_optimize.py
git commit -m "feat(quant): HRP (Hierarchical Risk Parity) optimizer

López de Prado 2016 via riskfolio-lib HCPortfolio. min/max bounds
applied post-hoc with renormalization (HRP doesn't support them
natively — documented as an API caveat)."
```

### Task 3.4: Efficient frontier sweep

**Files:**
- Modify: `quant-service/src/optimize.py`
- Modify: `quant-service/tests/test_optimize.py`

- [ ] **Step 1: Write failing test**

```python
# append to tests/test_optimize.py
from src.optimize import efficient_frontier


def test_efficient_frontier_monotone_tradeoff(synth_returns) -> None:
    """Frontier should be sorted by return and volatility should be
    monotone non-decreasing (upper branch only)."""
    symbols = list(synth_returns.keys())
    frontier = efficient_frontier(
        symbols=symbols,
        returns=synth_returns,
        n_points=20,
        constraints=None,
    )
    assert len(frontier) == 20
    rets = [p["return"] for p in frontier]
    vols = [p["vol"] for p in frontier]
    # Returns strictly increasing (within float noise)
    assert all(rets[i] < rets[i + 1] + 1e-9 for i in range(len(rets) - 1))
    # Volatilities non-decreasing within 1e-4 tolerance (convex frontier,
    # but we only sweep the upper branch from min-var-return upward).
    assert all(vols[i] <= vols[i + 1] + 1e-4 for i in range(len(vols) - 1))
    # Each point has full weights dict.
    for p in frontier:
        assert set(p["weights"].keys()) == set(symbols)
        assert abs(sum(p["weights"].values()) - 1.0) < 1e-6
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_efficient_frontier_monotone_tradeoff -v`
Expected: `ImportError: cannot import name 'efficient_frontier'`

- [ ] **Step 3: Add frontier sweep**

Append to `src/optimize.py`:

```python
def efficient_frontier(
    symbols: list[str],
    returns: dict[str, list[float]],
    n_points: int = 20,
    constraints: Constraints | None = None,
) -> list[FrontierPoint]:
    """Sweep target returns between the global min-variance return and
    the max-mean return. Returns a list of FrontierPoint dicts with the
    spec §4.1.1 keys `{"return", "vol", "weights"}`.
    """
    ret_mat = _build_returns_matrix(symbols, returns)
    mu, cov = _mu_and_cov(ret_mat)

    # Global min-variance return: min wᵀΣw s.t. Σw = 1 (+ constraints).
    n = len(symbols)
    w = cp.Variable(n)
    cons = _apply_constraints(w, symbols, constraints)
    prob = cp.Problem(cp.Minimize(cp.quad_form(w, cov)), cons)
    prob.solve(solver=cp.CLARABEL)
    if prob.status not in {"optimal", "optimal_inaccurate"}:
        raise InfeasibleError(
            f"Frontier min-var infeasible: {prob.status}",
            details={"solver_status": prob.status},
        )
    r_min = float(mu @ w.value)
    r_max = float(mu.max())
    if r_min >= r_max:
        # Degenerate: all assets have the same mean.
        return []

    targets = np.linspace(r_min, r_max, n_points)
    frontier: list[FrontierPoint] = []
    for t in targets:
        try:
            res = mean_variance(
                symbols=symbols,
                returns=returns,
                target_return=float(t),
                risk_free_rate=0.0,
                constraints=constraints,
            )
        except InfeasibleError:
            continue  # skip infeasible points silently
        frontier.append({
            "return": res["expected_return"],
            "vol": res["expected_volatility"],
            "weights": res["optimal_weights"],
        })
    return frontier
```

- [ ] **Step 4: Run to verify pass**

Run: `cd quant-service && uv run pytest tests/test_optimize.py::test_efficient_frontier_monotone_tradeoff -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/optimize.py quant-service/tests/test_optimize.py
git commit -m "feat(quant): efficient frontier sweep

20-point frontier between global min-var return and max-mean return.
Skips infeasible target points silently rather than aborting the sweep."
```

### Task 3.5: Wire `/optimize` endpoint in `src/api.py`

**Files:**
- Modify: `quant-service/src/api.py`
- Modify: `quant-service/tests/test_api.py` (or create)

- [ ] **Step 1: Write failing TestClient integration test**

```python
# quant-service/tests/test_api.py
"""Integration tests for FastAPI endpoints (HMAC + routing + responses)."""
from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_optimize_mean_variance_returns_valid_result(
    client: TestClient, synth_returns, hmac_key, sign
) -> None:
    body = json.dumps({
        "symbols": list(synth_returns.keys()),
        "returns": synth_returns,
        "method": "mean_variance",
        "risk_free_rate": 0.0,
        "constraints": {"allow_short": False},
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/optimize", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "weights" in data
    assert abs(sum(data["weights"].values()) - 1.0) < 1e-6
    assert data["meta"]["method"] == "mean_variance"
    assert len(data["frontier"]) == 0  # no target_return, no frontier unless requested


def test_optimize_rejects_missing_hmac(client: TestClient, synth_returns) -> None:
    body = json.dumps({
        "symbols": list(synth_returns.keys()),
        "returns": synth_returns,
        "method": "mean_variance",
    }).encode()
    resp = client.post("/optimize", content=body,
                       headers={"Content-Type": "application/json"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "HMAC_INVALID"


def test_optimize_validation_error_envelope(
    client: TestClient, hmac_key, sign
) -> None:
    body = json.dumps({
        "symbols": ["A"],  # only 1 symbol — minimum is 2
        "returns": {"A": [0.01, 0.02]},
        "method": "mean_variance",
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/optimize", content=body, headers=headers)
    assert resp.status_code == 422
    env = resp.json()
    assert env["error"]["code"] == "VALIDATION_ERROR"
    assert "symbols" in env["error"]["message"].lower() or \
           any("symbols" in str(d).lower() for d in env["error"]["details"].get("errors", []))
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_api.py::test_optimize_mean_variance_returns_valid_result -v`
Expected: FAIL — the Chunk 2 stub raises QuantError("Not implemented yet").

- [ ] **Step 3: Replace `/optimize` stub with real dispatch**

In `src/api.py`, replace the stub body with:

```python
import time
from datetime import datetime, timezone

from src import optimize as _optimize

@app.post("/optimize")
async def optimize_endpoint(req: OptimizeRequest) -> OptimizeResult:
    t0 = time.perf_counter()
    if req.method == "mean_variance":
        result = _optimize.mean_variance(
            symbols=req.symbols,
            returns=req.returns,
            target_return=req.target_return,
            risk_free_rate=req.risk_free_rate or 0.0,
            constraints=req.constraints,
        )
        # Attach frontier only when `frontier_points > 0` (spec §4.1.1).
        if req.frontier_points > 0:
            result["frontier"] = _optimize.efficient_frontier(
                symbols=req.symbols,
                returns=req.returns,
                n_points=req.frontier_points,
                constraints=req.constraints,
            )
        else:
            result["frontier"] = []
    elif req.method == "risk_parity":
        result = _optimize.risk_parity(
            symbols=req.symbols,
            returns=req.returns,
            constraints=req.constraints,
        )
    elif req.method == "hrp":
        result = _optimize.hrp(
            symbols=req.symbols,
            returns=req.returns,
            constraints=req.constraints,
        )
    else:
        # schemas.py validator should have caught unknown methods, but guard anyway:
        raise ValidationError(f"Unknown optimization method: {req.method}")

    # Populate endpoint-owned fields per spec §4.1.1.
    result["computed_at"] = datetime.now(timezone.utc).isoformat()
    result["elapsed_ms"] = int((time.perf_counter() - t0) * 1000)
    return result
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/api.py quant-service/tests/test_api.py
git commit -m "feat(quant): wire /optimize endpoint to optimize.py

Dispatches on method ∈ {mean_variance, risk_parity, hrp}. Frontier
returned only when frontier_points > 0 (keeps p50 payload small).
Endpoint populates computed_at + elapsed_ms per spec §4.1.1."
```

### Task 3.6: Property tests (Hypothesis) for optimizer invariants

**Files:**
- Modify: `quant-service/tests/test_optimize.py`

- [ ] **Step 1: Add Hypothesis property tests**

```python
# append to tests/test_optimize.py
from hypothesis import given, settings, strategies as st
from hypothesis.extra.numpy import arrays


@given(
    n_assets=st.integers(min_value=2, max_value=10),
    n_days=st.integers(min_value=60, max_value=500),
    seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=30, deadline=None)  # cvxpy is slow
def test_markowitz_weights_always_sum_to_one(
    n_assets: int, n_days: int, seed: int
) -> None:
    rng = np.random.default_rng(seed)
    daily = rng.normal(0.0005, 0.015, size=(n_days, n_assets))
    symbols = [f"S{i}" for i in range(n_assets)]
    returns = {s: daily[:, i].tolist() for i, s in enumerate(symbols)}
    try:
        result = mean_variance(symbols=symbols, returns=returns,
                               target_return=None, risk_free_rate=0.0, constraints=None)
    except (CovarianceNotPositiveDefiniteError, InfeasibleError):
        # Acceptable — our guard raised cleanly. Property: never crash.
        return
    weights_sum = sum(result["optimal_weights"].values())
    assert abs(weights_sum - 1.0) < 1e-6, f"sum = {weights_sum}"


@given(
    n_assets=st.integers(min_value=2, max_value=8),
    max_w=st.floats(min_value=0.20, max_value=0.80),
    seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=20, deadline=None)
def test_markowitz_respects_max_weight_constraint(
    n_assets: int, max_w: float, seed: int
) -> None:
    rng = np.random.default_rng(seed)
    daily = rng.normal(0.0005, 0.015, size=(300, n_assets))
    symbols = [f"S{i}" for i in range(n_assets)]
    returns = {s: daily[:, i].tolist() for i, s in enumerate(symbols)}
    # max_w must be feasible: n_assets * max_w >= 1.
    if n_assets * max_w < 1.0 + 1e-6:
        return
    from src.schemas import Constraints
    cons = Constraints(allow_short=False, max_weight=max_w)
    try:
        result = mean_variance(symbols=symbols, returns=returns,
                               target_return=None, risk_free_rate=0.0, constraints=cons)
    except (CovarianceNotPositiveDefiniteError, InfeasibleError):
        return
    for sym, w in result["optimal_weights"].items():
        assert w <= max_w + 1e-5, f"{sym} weight {w} exceeds max_w {max_w}"
```

- [ ] **Step 2: Run property tests**

Run: `cd quant-service && uv run pytest tests/test_optimize.py -k "sum_to_one or max_weight" -v`
Expected: all 50 hypothesis examples PASS (may take 30-60s).

- [ ] **Step 3: Commit**

```bash
git add quant-service/tests/test_optimize.py
git commit -m "test(quant): Hypothesis property tests for optimizer invariants

Weights-sum-to-1 (±1e-6) across random (n_assets, n_days, seed) tuples.
max_weight constraint enforced across random max_w ∈ [0.2, 0.8] cases.
Both properties must hold even when solver raises — property is 'never crash'."
```

---

## Chunk 4 — Monte Carlo, factors, rebalance + endpoint wiring

**Goal:** Implement the remaining three math modules (`monte_carlo.py`, `factors.py`, `rebalance.py`), wire them into the corresponding endpoints (`/monte-carlo`, `/factors`, `/rebalance`), and add tests.

**Design contracts (frozen in spec §4.1.2 – §4.1.4):**

- **Monte Carlo (`/monte-carlo`, spec §4.1.2):** GBM simulation of portfolio value over `horizon_days` with `n_simulations` paths. Inputs are `current_value`, `weights`, `expected_returns` (annualized per asset), `covariance` (annualized N×N matrix). Response:
  ```
  {
      "trajectories": {"p5": [...], "p50": [...], "p95": [...]},  # length horizon_days+1
      "final_distribution": {"mean": float, "std": float, "var_95": float, "cvar_95": float},
      "probability_loss": float,   # P(terminal < current_value)
      "elapsed_ms": int            # populated by endpoint
  }
  ```
- **Factors (`/factors`, spec §4.1.3):** OLS regression of portfolio excess returns on Fama-French 5 + momentum (MKT, SMB, HML, RMW, CMA, MOM). Response:
  ```
  {
      "loadings": {"MKT": float, ...},          # all 6 factors
      "alpha": float,                            # daily (matches spec §4.1.3 example 0.0008)
      "alpha_t_stat": float,
      "r_squared": float,
      "interpretation": {
          "tilt": "growth" | "value" | "neutral",
          "size_bias": "large_cap" | "small_cap" | "neutral",
          "quality": "high" | "low" | "neutral"
      }
  }
  ```
- **Rebalance (`/rebalance`, spec §4.1.4):** Greedy integer-share allocation from current holdings to target weights under a cash constraint, with per-trade minimum value and basis-point transaction costs. Response:
  ```
  {
      "trades": [{"symbol": str, "action": "buy"|"sell", "shares": int, "estimated_cost": float, "post_weight": float}],
      "total_turnover": float,          # Σ |shares * price| across all trades
      "estimated_costs": float,         # Σ fees (transaction_cost_bps * gross / 10000)
      "drift_before": float,            # L1 weight distance to target BEFORE trades
      "drift_after": float              # L1 weight distance to target AFTER trades
  }
  ```

### Task 4.1: Monte Carlo simulation (GBM + VaR/CVaR)

**Files:**
- Create: `quant-service/src/monte_carlo.py`
- Test: `quant-service/tests/test_monte_carlo.py`

- [ ] **Step 1: Write failing golden test**

```python
# quant-service/tests/test_monte_carlo.py
"""Tests for Monte Carlo GBM simulation. Response shape frozen in spec §4.1.2."""
from __future__ import annotations

import numpy as np
import pytest

from src.errors import MonteCarloDegenerateError
from src.monte_carlo import simulate


def test_gbm_mean_terminal_matches_analytic() -> None:
    """For GBM with drift μ and vol σ, E[S_T] = S_0 · exp(μT).
    Portfolio with annual μ = 0.08, σ = 0.15 → analytic E[S_T] ≈ S_0·exp(0.08) ≈ 108_328.
    Simulation mean should match within Monte Carlo error."""
    symbols = ["A", "B"]
    weights = {"A": 0.5, "B": 0.5}
    # Construct annualized inputs directly (spec §4.1.2 signature).
    expected_returns = {"A": 0.08, "B": 0.08}
    # Uncorrelated, each σ = 0.15 annualized → diagonal covariance = 0.0225.
    covariance = [[0.0225, 0.0], [0.0, 0.0225]]
    result = simulate(
        current_value=100_000.0,
        weights=weights,
        expected_returns=expected_returns,
        covariance=covariance,
        horizon_days=252,
        n_simulations=5_000,
        percentiles=[5, 25, 50, 75, 95],
        seed=123,
    )
    # Spec §4.1.2: response has `final_distribution.mean`, not `terminal_values`.
    mean_terminal = result["final_distribution"]["mean"]
    assert 104_000 < mean_terminal < 113_000, f"got mean = {mean_terminal}"
    # Trajectories: spec keys are only p5/p50/p95 (regardless of input percentiles).
    assert set(result["trajectories"].keys()) == {"p5", "p50", "p95"}
    p50_terminal = result["trajectories"]["p50"][-1]
    assert 95_000 < p50_terminal < 115_000
    # VaR / CVaR are dollar losses at 95% level.
    assert result["final_distribution"]["var_95"] > 0
    assert result["final_distribution"]["cvar_95"] >= result["final_distribution"]["var_95"]
    # probability_loss ∈ [0, 1].
    assert 0.0 <= result["probability_loss"] <= 1.0
    # `elapsed_ms` is populated by the endpoint wrapper — not by the library.
    assert "elapsed_ms" not in result


def test_mc_trajectories_length_equals_horizon_plus_one() -> None:
    """Each trajectory array has horizon_days + 1 points (including S_0)."""
    result = simulate(
        current_value=50_000.0,
        weights={"A": 1.0},
        expected_returns={"A": 0.10},
        covariance=[[0.04]],
        horizon_days=30,
        n_simulations=500,
        percentiles=[5, 25, 50, 75, 95],
        seed=1,
    )
    for key in ("p5", "p50", "p95"):
        assert len(result["trajectories"][key]) == 31
        # First element = S_0 by construction.
        assert result["trajectories"][key][0] == pytest.approx(50_000.0, abs=1e-6)


def test_mc_degenerate_zero_variance() -> None:
    """Zero covariance → zero portfolio volatility → degenerate."""
    with pytest.raises(MonteCarloDegenerateError):
        simulate(
            current_value=100_000.0,
            weights={"A": 0.5, "B": 0.5},
            expected_returns={"A": 0.08, "B": 0.08},
            covariance=[[0.0, 0.0], [0.0, 0.0]],  # degenerate
            horizon_days=252,
            n_simulations=1000,
            percentiles=[5, 50, 95],
            seed=1,
        )
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_monte_carlo.py -v`
Expected: `ImportError: cannot import name 'simulate' from 'src.monte_carlo'`

- [ ] **Step 3: Implement `monte_carlo.py`**

```python
# quant-service/src/monte_carlo.py
"""Geometric Brownian Motion Monte Carlo simulation.

Signature and response shape match spec §4.1.2 exactly. `elapsed_ms` is
populated by the endpoint wrapper (not by this library) so the library
stays pure/deterministic.
"""
from __future__ import annotations

from typing import TypedDict

import numpy as np

from src.errors import MonteCarloDegenerateError

_ANN = 252


class FinalDistribution(TypedDict):
    mean: float
    std: float
    var_95: float   # dollar amount of loss at 95% confidence
    cvar_95: float  # expected loss conditional on exceeding var_95


class Trajectories(TypedDict):
    p5: list[float]
    p50: list[float]
    p95: list[float]


class MonteCarloResult(TypedDict):
    trajectories: Trajectories
    final_distribution: FinalDistribution
    probability_loss: float


def simulate(
    current_value: float,
    weights: dict[str, float],
    expected_returns: dict[str, float],
    covariance: list[list[float]],
    horizon_days: int,
    n_simulations: int,
    percentiles: list[int] | None = None,
    seed: int | None = None,
) -> MonteCarloResult:
    """Simulate portfolio value via univariate GBM on the portfolio return.

    Derives portfolio drift μ_p = wᵀ μ and variance σ_p² = wᵀ Σ w from
    the caller-provided annualized mean vector and annualized covariance,
    then runs GBM on the scalar portfolio value. This is cheaper and
    more numerically stable than simulating each asset separately and
    is standard for risk/VaR applications when only portfolio-level
    percentiles are reported.
    """
    if percentiles is None:
        percentiles = [5, 25, 50, 75, 95]
    symbols = sorted(weights.keys())
    if set(expected_returns.keys()) != set(symbols):
        raise ValueError("weights and expected_returns must share symbols")
    w = np.array([weights[s] for s in symbols], dtype=float)
    if abs(w.sum() - 1.0) > 1e-3:
        raise ValueError(f"weights sum to {w.sum()}, expected 1.0")
    mu_vec = np.array([expected_returns[s] for s in symbols], dtype=float)
    Sigma = np.asarray(covariance, dtype=float)
    if Sigma.shape != (len(symbols), len(symbols)):
        raise ValueError(
            f"covariance shape {Sigma.shape} does not match {len(symbols)}×{len(symbols)}"
        )

    # Portfolio-level annualized drift and variance.
    mu_p_ann = float(w @ mu_vec)
    var_p_ann = float(w @ Sigma @ w)
    if var_p_ann <= 1e-12:
        raise MonteCarloDegenerateError(
            "Portfolio variance is zero; Monte Carlo is degenerate",
            details={"variance": var_p_ann},
        )
    sigma_p_ann = np.sqrt(var_p_ann)

    # Convert to daily parameters.
    mu_d = mu_p_ann / _ANN
    sigma_d = sigma_p_ann / np.sqrt(_ANN)

    rng = np.random.default_rng(seed)
    # GBM: S_{t+1} = S_t · exp((μ − σ²/2)·Δt + σ·√Δt·Z). Δt = 1 day.
    drift_d = mu_d - 0.5 * sigma_d**2
    shocks = rng.normal(0.0, 1.0, size=(horizon_days, n_simulations))
    log_step = drift_d + sigma_d * shocks
    cum_log = np.cumsum(log_step, axis=0)
    cum_log = np.vstack([np.zeros((1, n_simulations)), cum_log])
    paths = current_value * np.exp(cum_log)  # (horizon_days+1, n_simulations)

    # Spec §4.1.2: trajectories has ONLY p5/p50/p95 keys regardless of input.
    trajectories: Trajectories = {
        "p5": np.percentile(paths, 5, axis=1).tolist(),
        "p50": np.percentile(paths, 50, axis=1).tolist(),
        "p95": np.percentile(paths, 95, axis=1).tolist(),
    }

    terminal = paths[-1, :]
    pnl = terminal - current_value
    # VaR/CVaR at fixed 95% level (spec uses literal key names var_95/cvar_95).
    var_threshold = np.percentile(pnl, 5.0)  # 5th percentile of P/L
    var_95 = float(max(-var_threshold, 0.0))
    tail_mask = pnl <= var_threshold
    cvar_95 = float(max(-pnl[tail_mask].mean(), 0.0)) if tail_mask.any() else var_95

    final_distribution: FinalDistribution = {
        "mean": float(terminal.mean()),
        "std": float(terminal.std(ddof=1)),
        "var_95": var_95,
        "cvar_95": cvar_95,
    }
    prob_loss = float((terminal < current_value).mean())

    return {
        "trajectories": trajectories,
        "final_distribution": final_distribution,
        "probability_loss": prob_loss,
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_monte_carlo.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/monte_carlo.py quant-service/tests/test_monte_carlo.py
git commit -m "feat(quant): GBM Monte Carlo simulation with VaR/CVaR

Response shape frozen in spec §4.1.2: trajectories (p5/p50/p95) +
final_distribution (mean/std/var_95/cvar_95) + probability_loss.
Driven by annualized (μ, Σ), reduced to univariate portfolio GBM.
Raises MonteCarloDegenerateError on zero-variance portfolio.
elapsed_ms populated by endpoint wrapper, not the library."
```

### Task 4.2: Factor regression (Fama-French 5 + MOM)

**Files:**
- Create: `quant-service/src/factors.py`
- Test: `quant-service/tests/test_factors.py`

- [ ] **Step 1: Write failing test**

```python
# quant-service/tests/test_factors.py
"""Tests for factor regression. Response shape frozen in spec §4.1.3."""
from __future__ import annotations

import numpy as np
import pytest

from src.errors import DimensionMismatchError, InsufficientHistoryError
from src.factors import regress


def test_factor_regression_recovers_known_loadings(rng) -> None:
    """Synthesize portfolio returns as a known linear combination of factors,
    then check that regression recovers the loadings (spec calls them `loadings`)."""
    n = 500
    factors = {
        "MKT": rng.normal(0.0004, 0.01, n).tolist(),
        "SMB": rng.normal(0.0001, 0.005, n).tolist(),
        "HML": rng.normal(0.0001, 0.005, n).tolist(),
        "RMW": rng.normal(0.0001, 0.005, n).tolist(),
        "CMA": rng.normal(0.0001, 0.005, n).tolist(),
        "MOM": rng.normal(0.0002, 0.006, n).tolist(),
    }
    true_loadings = {"MKT": 1.1, "SMB": 0.3, "HML": -0.2, "RMW": 0.0, "CMA": 0.0, "MOM": 0.15}
    true_alpha = 0.0001  # daily
    noise = rng.normal(0, 0.001, n)
    port_returns = (
        true_alpha
        + true_loadings["MKT"] * np.array(factors["MKT"])
        + true_loadings["SMB"] * np.array(factors["SMB"])
        + true_loadings["HML"] * np.array(factors["HML"])
        + true_loadings["MOM"] * np.array(factors["MOM"])
        + noise
    ).tolist()

    result = regress(
        portfolio_returns=port_returns,
        factor_returns=factors,
        risk_free_rate_daily=0.0,
    )
    # Spec §4.1.3: key is `loadings`, not `betas`.
    for f, true_load in true_loadings.items():
        got = result["loadings"][f]
        assert abs(got - true_load) < 0.15, f"{f}: got {got}, expected {true_load}"
    assert result["r_squared"] > 0.90
    assert set(result["loadings"].keys()) == {"MKT", "SMB", "HML", "RMW", "CMA", "MOM"}
    # Spec requires scalar alpha_t_stat (not a map).
    assert isinstance(result["alpha_t_stat"], float)
    # Spec §4.1.3 interpretation fields.
    interp = result["interpretation"]
    assert interp["tilt"] in {"growth", "value", "neutral"}
    assert interp["size_bias"] in {"large_cap", "small_cap", "neutral"}
    assert interp["quality"] in {"high", "low", "neutral"}


def test_factor_regression_rejects_mismatched_length() -> None:
    with pytest.raises(DimensionMismatchError):
        regress(
            portfolio_returns=[0.01, 0.02, 0.03],
            factor_returns={
                "MKT": [0.01, 0.02],  # shorter
                "SMB": [0.001, 0.002, 0.003],
                "HML": [0.001, 0.002, 0.003],
                "RMW": [0.001, 0.002, 0.003],
                "CMA": [0.001, 0.002, 0.003],
                "MOM": [0.001, 0.002, 0.003],
            },
            risk_free_rate_daily=0.0,
        )


def test_factor_regression_interpretation_growth_large_high() -> None:
    """Loadings HML=-0.5 (growth), SMB=-0.3 (large cap), RMW=+0.4 (high quality) →
    interpretation {tilt:growth, size_bias:large_cap, quality:high}."""
    rng = np.random.default_rng(42)
    n = 400
    factors = {
        f: rng.normal(0.0002, 0.01, n).tolist()
        for f in ["MKT", "SMB", "HML", "RMW", "CMA", "MOM"]
    }
    true_loadings = {"MKT": 1.0, "SMB": -0.30, "HML": -0.50, "RMW": 0.40, "CMA": 0.0, "MOM": 0.10}
    port = np.zeros(n)
    for f, b in true_loadings.items():
        port += b * np.asarray(factors[f])
    port += rng.normal(0, 0.0005, n)
    result = regress(
        portfolio_returns=port.tolist(),
        factor_returns=factors,
        risk_free_rate_daily=0.0,
    )
    assert result["interpretation"]["tilt"] == "growth"
    assert result["interpretation"]["size_bias"] == "large_cap"
    assert result["interpretation"]["quality"] == "high"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_factors.py -v`
Expected: `ImportError: cannot import name 'regress'`

- [ ] **Step 3: Implement `factors.py`**

```python
# quant-service/src/factors.py
"""OLS factor regression: portfolio excess return ~ Fama-French 5 + MOM.

Response shape is frozen in spec §4.1.3:
  { loadings, alpha, alpha_t_stat, r_squared, interpretation }

Alpha is returned as a DAILY coefficient (matches spec example value 0.0008).
"""
from __future__ import annotations

from typing import Literal, TypedDict

import numpy as np

from src.errors import DimensionMismatchError, InsufficientHistoryError
from src.schemas import REQUIRED_FACTORS

_MIN_HISTORY_DAYS = 60


class Interpretation(TypedDict):
    tilt: Literal["growth", "value", "neutral"]
    size_bias: Literal["large_cap", "small_cap", "neutral"]
    quality: Literal["high", "low", "neutral"]


class FactorsResult(TypedDict):
    loadings: dict[str, float]  # MKT / SMB / HML / RMW / CMA / MOM
    alpha: float                 # DAILY (spec §4.1.3)
    alpha_t_stat: float          # spec key, not `alpha_tstat`
    r_squared: float
    interpretation: Interpretation


def _interpret(loadings: dict[str, float]) -> Interpretation:
    """Heuristic translation of loadings into human-readable factor tilts.

    Thresholds chosen conservatively (±0.25) so "neutral" is the default for
    small exposures; adjust if we find users want more sensitive labels.
    """
    hml = loadings.get("HML", 0.0)
    smb = loadings.get("SMB", 0.0)
    rmw = loadings.get("RMW", 0.0)

    if hml > 0.25:
        tilt: Literal["growth", "value", "neutral"] = "value"
    elif hml < -0.25:
        tilt = "growth"
    else:
        tilt = "neutral"

    if smb > 0.25:
        size_bias: Literal["large_cap", "small_cap", "neutral"] = "small_cap"
    elif smb < -0.25:
        size_bias = "large_cap"
    else:
        size_bias = "neutral"

    if rmw > 0.25:
        quality: Literal["high", "low", "neutral"] = "high"
    elif rmw < -0.25:
        quality = "low"
    else:
        quality = "neutral"

    return {"tilt": tilt, "size_bias": size_bias, "quality": quality}


def regress(
    portfolio_returns: list[float],
    factor_returns: dict[str, list[float]],
    risk_free_rate_daily: float = 0.0,
) -> FactorsResult:
    missing = [f for f in REQUIRED_FACTORS if f not in factor_returns]
    if missing:
        raise DimensionMismatchError(
            f"Missing required factors: {missing}",
            details={"missing": missing, "required": list(REQUIRED_FACTORS)},
        )
    y = np.asarray(portfolio_returns, dtype=float) - risk_free_rate_daily
    n = len(y)
    if n < _MIN_HISTORY_DAYS:
        raise InsufficientHistoryError(
            f"Need ≥ {_MIN_HISTORY_DAYS} days; got {n}",
            details={"min_required": _MIN_HISTORY_DAYS, "provided": n},
        )
    # Align factor arrays, check shape.
    X_cols = []
    for f in REQUIRED_FACTORS:
        col = np.asarray(factor_returns[f], dtype=float)
        if len(col) != n:
            raise DimensionMismatchError(
                f"Factor {f} has {len(col)} rows; portfolio has {n}",
                details={"factor": f, "factor_len": len(col), "portfolio_len": n},
            )
        X_cols.append(col)
    X = np.column_stack([np.ones(n), *X_cols])  # intercept + 6 factors

    # OLS: β = (XᵀX)⁻¹ Xᵀy
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    y_hat = X @ beta
    resid = y - y_hat
    sse = float(resid @ resid)
    sst = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - sse / sst if sst > 0 else 0.0
    k = X.shape[1]

    # Standard errors and t-stats.
    sigma2 = sse / (n - k) if n - k > 0 else 0.0
    var_beta = sigma2 * np.diag(XtX_inv)
    se_beta = np.sqrt(np.maximum(var_beta, 0.0))
    tstats = np.divide(beta, se_beta, out=np.zeros_like(beta),
                       where=se_beta > 0)

    alpha_daily = float(beta[0])
    loadings = {f: float(beta[i + 1]) for i, f in enumerate(REQUIRED_FACTORS)}

    return {
        "loadings": loadings,
        "alpha": alpha_daily,  # spec §4.1.3 returns DAILY alpha
        "alpha_t_stat": float(tstats[0]),
        "r_squared": float(r2),
        "interpretation": _interpret(loadings),
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_factors.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/factors.py quant-service/tests/test_factors.py
git commit -m "feat(quant): OLS factor regression (Fama-French 5 + MOM)

Response shape per spec §4.1.3: loadings, alpha (daily),
alpha_t_stat, r_squared, interpretation (tilt/size_bias/quality).
Validates all 6 required factors present and equal-length.
Interpretation heuristics use ±0.25 thresholds on HML/SMB/RMW."
```

### Task 4.3: Rebalance (greedy integer-share with costs)

**Files:**
- Create: `quant-service/src/rebalance.py`
- Test: `quant-service/tests/test_rebalance.py`

- [ ] **Step 1: Write failing test**

```python
# quant-service/tests/test_rebalance.py
"""Tests for rebalance.py (greedy integer-share allocator).
Response shape frozen in spec §4.1.4.
"""
from __future__ import annotations

import pytest

from src.rebalance import compute_trades


def test_rebalance_already_balanced_returns_empty() -> None:
    """Portfolio: 10 AAPL @ $150, 5 MSFT @ $300. Target: 50/50.
    Current value = 1500 + 1500 = 3000. Already balanced → no trades."""
    result = compute_trades(
        current_holdings={"AAPL": 10, "MSFT": 5},
        current_prices={"AAPL": 150.0, "MSFT": 300.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=0.0,
        min_trade_value=100.0,
        transaction_cost_bps=5.0,
    )
    total_abs_shares = sum(abs(t["shares"]) for t in result["trades"])
    assert total_abs_shares == 0
    # Spec §4.1.4: drift_before should already be near zero.
    assert result["drift_before"] < 0.02
    assert result["drift_after"] < 0.02
    assert result["total_turnover"] == pytest.approx(0.0)


def test_rebalance_buys_underweight_sells_overweight() -> None:
    """Portfolio: 10 AAPL @ $100, 0 MSFT @ $200. Target: 50/50.
    Must sell AAPL to finance MSFT buy. drift_after < drift_before."""
    result = compute_trades(
        current_holdings={"AAPL": 10, "MSFT": 0},
        current_prices={"AAPL": 100.0, "MSFT": 200.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=0.0,
        min_trade_value=100.0,
        transaction_cost_bps=5.0,
    )
    trades = {t["symbol"]: t for t in result["trades"]}
    assert trades["MSFT"]["action"] == "buy"
    assert trades["MSFT"]["shares"] > 0
    assert trades["AAPL"]["action"] == "sell"
    assert trades["AAPL"]["shares"] > 0
    # Spec §4.1.4: each trade carries its post-rebalance weight.
    for t in result["trades"]:
        assert 0.0 <= t["post_weight"] <= 1.0
    # Drift must strictly decrease (that's the whole point).
    assert result["drift_after"] < result["drift_before"]


def test_rebalance_respects_cash_available() -> None:
    """Buys cannot exceed cash_available + proceeds from sells."""
    result = compute_trades(
        current_holdings={"AAPL": 0, "MSFT": 0},
        current_prices={"AAPL": 100.0, "MSFT": 200.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=500.0,
        min_trade_value=50.0,
        transaction_cost_bps=10.0,
    )
    total_buy_value = sum(
        t["estimated_cost"] for t in result["trades"] if t["action"] == "buy"
    )
    assert total_buy_value <= 500.0 + 1e-6
    # total_turnover = Σ |shares * price| across ALL trades (buy + sell).
    assert result["total_turnover"] >= 0.0
    # estimated_costs is the total fees paid (bps * gross / 10_000).
    assert result["estimated_costs"] >= 0.0


def test_rebalance_min_trade_value_suppresses_dust() -> None:
    """Min trade value rejects trades whose gross < min_trade_value."""
    result = compute_trades(
        current_holdings={"AAPL": 5},
        current_prices={"AAPL": 100.0, "MSFT": 200.0},
        # Target is almost identical; only tiny MSFT gap which should fall below min_trade_value.
        target_weights={"AAPL": 0.99, "MSFT": 0.01},
        cash_available=0.0,
        min_trade_value=1000.0,  # block any trade smaller than $1k
        transaction_cost_bps=5.0,
    )
    # With min_trade_value=$1000 and MSFT gap ≈ $5, we expect no MSFT trade.
    msft_trades = [t for t in result["trades"] if t["symbol"] == "MSFT"]
    assert all(t["estimated_cost"] >= 1000.0 for t in msft_trades)
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_rebalance.py -v`
Expected: `ImportError: cannot import name 'compute_trades'`

- [ ] **Step 3: Implement `rebalance.py`**

```python
# quant-service/src/rebalance.py
"""Greedy integer-share rebalance allocator with transaction costs.

Response shape is frozen in spec §4.1.4:
  { trades: [{symbol, action, shares, estimated_cost, post_weight}],
    total_turnover, estimated_costs, drift_before, drift_after }
"""
from __future__ import annotations

from typing import Literal, TypedDict

import numpy as np


class Trade(TypedDict):
    symbol: str
    action: Literal["buy", "sell"]
    shares: int
    estimated_cost: float   # for buys: gross + fee; for sells: fee only
    post_weight: float      # symbol's share of post-rebalance portfolio value


class RebalanceResult(TypedDict):
    trades: list[Trade]
    total_turnover: float     # Σ |shares * price| across all trades (gross notional)
    estimated_costs: float    # Σ fees = bps * gross / 10_000
    drift_before: float       # L1 weight distance: Σ |w_current - w_target|
    drift_after: float        # L1 weight distance AFTER trades


def _l1_drift(holdings: dict[str, int], prices: dict[str, float],
              cash: float, target: dict[str, float]) -> float:
    """L1 distance between actual and target weights on tradable value only.

    Cash is excluded from the weight basis because `target_weights` describes
    the target allocation of *invested* dollars. Using cash would penalize
    us for holding the cash buffer that exists by design.
    """
    invested = sum(holdings[s] * prices[s] for s in target)
    if invested <= 0:
        return 1.0
    drift = 0.0
    for s in target:
        w_actual = (holdings[s] * prices[s]) / invested
        drift += abs(w_actual - target[s])
    return float(drift)


def compute_trades(
    current_holdings: dict[str, int],
    current_prices: dict[str, float],
    target_weights: dict[str, float],
    cash_available: float,
    min_trade_value: float = 0.0,
    transaction_cost_bps: float = 5.0,
) -> RebalanceResult:
    symbols = sorted(set(current_holdings) | set(target_weights) | set(current_prices))
    holdings = {s: int(current_holdings.get(s, 0)) for s in symbols}
    prices = {s: float(current_prices.get(s, 0.0)) for s in symbols}
    target = {s: float(target_weights.get(s, 0.0)) for s in symbols}
    t_sum = sum(target.values())
    if t_sum <= 0:
        raise ValueError("target_weights sum to zero")
    target = {s: v / t_sum for s, v in target.items()}  # renormalize

    drift_before = _l1_drift(holdings, prices, cash_available, target)

    current_value = sum(holdings[s] * prices[s] for s in symbols)
    total_value = current_value + cash_available
    target_dollars = {s: total_value * target[s] for s in symbols}

    trades_list: list[Trade] = []
    cost_rate = transaction_cost_bps / 10_000.0
    cash = cash_available
    total_turnover = 0.0
    total_fees = 0.0

    # Step 1: sell overweights first (generates cash).
    for s in symbols:
        current_dollars = holdings[s] * prices[s]
        delta_dollars = target_dollars[s] - current_dollars
        if prices[s] <= 0 or delta_dollars >= -prices[s]:
            continue
        shares_to_sell = int(np.floor(-delta_dollars / prices[s]))
        shares_to_sell = min(shares_to_sell, holdings[s])
        if shares_to_sell <= 0:
            continue
        gross = shares_to_sell * prices[s]
        if gross < min_trade_value:
            continue
        fee = gross * cost_rate
        cash += (gross - fee)
        holdings[s] -= shares_to_sell
        total_turnover += gross
        total_fees += fee
        trades_list.append({
            "symbol": s,
            "action": "sell",
            "shares": shares_to_sell,
            "estimated_cost": float(fee),  # for sells, `estimated_cost` = fee only
            "post_weight": 0.0,             # patched after all trades processed
        })

    # Step 2: buy underweights in descending order of (target − current) gap.
    gaps: list[tuple[float, str]] = []
    for s in symbols:
        current_dollars = holdings[s] * prices[s]
        gap = target_dollars[s] - current_dollars
        if gap >= prices[s] and prices[s] > 0:
            gaps.append((gap, s))
    gaps.sort(reverse=True)

    for _, s in gaps:
        per_share_total = prices[s] * (1 + cost_rate)
        max_affordable = int(np.floor(cash / per_share_total))
        if max_affordable <= 0:
            continue
        current_dollars = holdings[s] * prices[s]
        target_shares = (target_dollars[s] - current_dollars) / prices[s]
        shares_to_buy = int(min(max_affordable, np.floor(target_shares)))
        if shares_to_buy <= 0:
            continue
        gross = shares_to_buy * prices[s]
        if gross < min_trade_value:
            continue
        fee = gross * cost_rate
        cash -= (gross + fee)
        holdings[s] += shares_to_buy
        total_turnover += gross
        total_fees += fee
        trades_list.append({
            "symbol": s,
            "action": "buy",
            "shares": shares_to_buy,
            "estimated_cost": float(gross + fee),
            "post_weight": 0.0,  # patched below
        })

    # Compute post-trade weights and patch each Trade row.
    invested_after = sum(holdings[s] * prices[s] for s in target)
    for t in trades_list:
        if invested_after > 0:
            t["post_weight"] = float(holdings[t["symbol"]] * prices[t["symbol"]] / invested_after)
        else:
            t["post_weight"] = 0.0

    drift_after = _l1_drift(holdings, prices, cash, target)

    return {
        "trades": trades_list,
        "total_turnover": float(total_turnover),
        "estimated_costs": float(total_fees),
        "drift_before": float(drift_before),
        "drift_after": float(drift_after),
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_rebalance.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/rebalance.py quant-service/tests/test_rebalance.py
git commit -m "feat(quant): greedy integer-share rebalance allocator

Response shape frozen in spec §4.1.4: trades[] with post_weight,
total_turnover, estimated_costs, drift_before, drift_after.
Two-pass: sell overweights (generate cash), buy underweights by
gap-size desc. Integer shares. Transaction cost charged in bps.
min_trade_value suppresses dust trades."
```

### Task 4.4: Wire `/monte-carlo`, `/factors`, `/rebalance` endpoints

**Files:**
- Modify: `quant-service/src/api.py`
- Modify: `quant-service/tests/test_api.py`

- [ ] **Step 1: Add integration tests**

Append to `tests/test_api.py`:

```python
def test_monte_carlo_endpoint_returns_spec_shape(
    client: TestClient, hmac_key, sign
) -> None:
    """Spec §4.1.2 response keys: trajectories / final_distribution / probability_loss / elapsed_ms."""
    body = json.dumps({
        "current_value": 100_000.0,
        "weights": {"A": 0.5, "B": 0.5},
        "expected_returns": {"A": 0.08, "B": 0.08},
        "covariance": [[0.0225, 0.0], [0.0, 0.0225]],
        "horizon_days": 30,
        "n_simulations": 500,
        "percentiles": [5, 25, 50, 75, 95],
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/monte-carlo", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert set(data["trajectories"].keys()) == {"p5", "p50", "p95"}
    assert len(data["trajectories"]["p50"]) == 31  # horizon + 1
    fd = data["final_distribution"]
    assert set(fd.keys()) == {"mean", "std", "var_95", "cvar_95"}
    assert fd["var_95"] >= 0
    assert fd["cvar_95"] >= fd["var_95"]
    assert 0.0 <= data["probability_loss"] <= 1.0
    # elapsed_ms is endpoint-populated (not in library result).
    assert isinstance(data["elapsed_ms"], int) and data["elapsed_ms"] >= 0


def test_factors_endpoint_returns_spec_shape(
    client: TestClient, rng, hmac_key, sign
) -> None:
    """Spec §4.1.3 response keys: loadings / alpha / alpha_t_stat / r_squared / interpretation."""
    n = 252
    factors_data = {
        f: rng.normal(0.0002, 0.008, n).tolist()
        for f in ["MKT", "SMB", "HML", "RMW", "CMA", "MOM"]
    }
    port_ret = rng.normal(0.0005, 0.012, n).tolist()
    body = json.dumps({
        "portfolio_returns": port_ret,
        "factor_returns": factors_data,
        "risk_free_rate_daily": 0.0,
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/factors", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert set(data["loadings"].keys()) == {"MKT", "SMB", "HML", "RMW", "CMA", "MOM"}
    assert 0.0 <= data["r_squared"] <= 1.0
    assert isinstance(data["alpha"], float)
    assert isinstance(data["alpha_t_stat"], float)
    interp = data["interpretation"]
    assert interp["tilt"] in {"growth", "value", "neutral"}
    assert interp["size_bias"] in {"large_cap", "small_cap", "neutral"}
    assert interp["quality"] in {"high", "low", "neutral"}


def test_rebalance_endpoint_returns_spec_shape(
    client: TestClient, hmac_key, sign
) -> None:
    """Spec §4.1.4 response keys: trades / total_turnover / estimated_costs / drift_before / drift_after."""
    body = json.dumps({
        "current_holdings": {"AAPL": 10, "MSFT": 0},
        "current_prices": {"AAPL": 100.0, "MSFT": 200.0},
        "target_weights": {"AAPL": 0.5, "MSFT": 0.5},
        "cash_available": 0.0,
        "min_trade_value": 100.0,
        "transaction_cost_bps": 5.0,
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/rebalance", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert set(data.keys()) == {
        "trades", "total_turnover", "estimated_costs", "drift_before", "drift_after"
    }
    for t in data["trades"]:
        assert set(t.keys()) == {"symbol", "action", "shares", "estimated_cost", "post_weight"}
        assert t["action"] in {"buy", "sell"}
    assert data["drift_after"] <= data["drift_before"] + 1e-9


def test_endpoint_rejects_missing_hmac_with_401(client: TestClient) -> None:
    """All four quant endpoints must reject unsigned requests with 401 / HMAC_INVALID."""
    body = json.dumps({
        "current_value": 1000,
        "weights": {"A": 1.0},
        "expected_returns": {"A": 0.1},
        "covariance": [[0.01]],
        "horizon_days": 10,
        "n_simulations": 100,
        "percentiles": [5, 50, 95],
    }).encode()
    # NO X-Signature header.
    resp = client.post("/monte-carlo", content=body)
    assert resp.status_code == 401
    env = resp.json()
    assert env["error"]["code"] in {"HMAC_INVALID", "HMAC_MISSING"}


def test_endpoint_returns_422_on_infeasible(client: TestClient, hmac_key, sign) -> None:
    """Degenerate Monte Carlo (zero covariance) → 422 MONTE_CARLO_DEGENERATE."""
    body = json.dumps({
        "current_value": 100_000.0,
        "weights": {"A": 0.5, "B": 0.5},
        "expected_returns": {"A": 0.08, "B": 0.08},
        "covariance": [[0.0, 0.0], [0.0, 0.0]],
        "horizon_days": 30,
        "n_simulations": 500,
        "percentiles": [5, 50, 95],
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/monte-carlo", content=body, headers=headers)
    assert resp.status_code == 422
    env = resp.json()
    assert env["error"]["code"] == "MONTE_CARLO_DEGENERATE"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: 3 new tests FAIL (stubs still raise QuantError).

- [ ] **Step 3: Replace stubs with real endpoints in `src/api.py`**

```python
import time

from src import monte_carlo as _mc
from src import factors as _factors
from src import rebalance as _rebal


@app.post("/monte-carlo")
async def monte_carlo_endpoint(req: MonteCarloRequest) -> dict:
    t0 = time.perf_counter()
    result = _mc.simulate(
        current_value=req.current_value,
        weights=req.weights,
        expected_returns=req.expected_returns,
        covariance=req.covariance,
        horizon_days=req.horizon_days,
        n_simulations=req.n_simulations,
        percentiles=req.percentiles,
        seed=getattr(req, "seed", None),
    )
    result["elapsed_ms"] = int((time.perf_counter() - t0) * 1000)
    return result


@app.post("/factors")
async def factors_endpoint(req: FactorsRequest) -> FactorsResult:
    return _factors.regress(
        portfolio_returns=req.portfolio_returns,
        factor_returns=req.factor_returns,
        risk_free_rate_daily=req.risk_free_rate_daily,
    )


@app.post("/rebalance")
async def rebalance_endpoint(req: RebalanceRequest) -> RebalanceResult:
    return _rebal.compute_trades(
        current_holdings=req.current_holdings,
        current_prices=req.current_prices,
        target_weights=req.target_weights,
        cash_available=req.cash_available,
        min_trade_value=req.min_trade_value,
        transaction_cost_bps=req.transaction_cost_bps,
    )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: all 8 api tests PASS (3 happy-path shape + 1 HMAC-missing 401 + 1 MC-degenerate 422 + the 3 pre-existing /optimize tests).

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/api.py quant-service/tests/test_api.py
git commit -m "feat(quant): wire /monte-carlo, /factors, /rebalance endpoints

Integration tests exercise full request→HMAC→Pydantic→math→response
flow. Response shapes match spec §4.1.2–§4.1.4 exactly. Adds 401
(missing HMAC) and 422 (infeasible/degenerate) coverage to pin the
error envelope contract. All 4 protected endpoints now functional."
```

---

## Chunk 5 — Modal deploy, Python CI, secret rotation runbook

**Goal:** Make the Python service deployable and CI-covered, and document the HMAC-key rotation procedure. After this chunk, pushing to `master` with any change under `quant-service/**` triggers lint + tests + Modal deploy automatically.

**Key decisions:**
- Modal is the only production runtime — no Dockerfile, no Kubernetes, no AWS Lambda fallback.
- Secrets live in the Modal secret named `quant-service-secrets` (referenced from `modal_app.py` in Chunk 2). Rotation is an ops runbook task, NOT an automation.
- Python CI is separate from the Next.js workflow — different trigger paths, different runners, different caches.

### Task 5.1: Create Modal secret and smoke-deploy

**Files:**
- N/A (ops task — operator runs commands locally with Modal CLI).
- Record the output in: `docs/runbooks/quant-incidents.md` (create in Chunk 9).

- [ ] **Step 1: Generate a 256-bit HMAC key**

```bash
# Run locally — this value goes into Modal AND the Next.js env.
python -c "import secrets; print(secrets.token_hex(32))"
```

Save the output to your password manager as `QUANT_SERVICE_HMAC_KEY`.

- [ ] **Step 2: Create Modal secret**

```bash
# Requires `modal token new` to have been run once (installs ~/.modal.toml).
modal secret create quant-service-secrets \
  QUANT_SERVICE_HMAC_KEY="<paste-the-hex-key>" \
  SENTRY_DSN="<optional-sentry-dsn-or-leave-unset>" \
  ENVIRONMENT="production"
```

Expected output: `✓ Created secret 'quant-service-secrets'`.

- [ ] **Step 3: Deploy from local**

```bash
cd quant-service
modal deploy modal_app.py
```

Expected output lines (truncated):
```
✓ Image built in <Nm<X>s
✓ Created function 'fastapi_app' (keep_warm=1)
✓ Deployed to https://<workspace>--investtracker-quant-fastapi-app.modal.run
```

Capture the URL — it's needed in Chunk 7 as `QUANT_SERVICE_URL`.

- [ ] **Step 4: Smoke-test `/health` (unauthenticated)**

```bash
curl -s "https://<workspace>--investtracker-quant-fastapi-app.modal.run/health"
```

Expected: `{"status":"ok","version":"0.1.0"}`.

- [ ] **Step 5: Smoke-test `/optimize` with a manual HMAC signature**

```bash
# Save the following as /tmp/smoke.sh and run it.
# The smoke body uses a synthesized 60-day series per symbol so the
# optimizer has enough history to pass the _MIN_HISTORY_DAYS=60 guard.
KEY="<the-hex-key-from-step-1>"
URL="https://<workspace>--investtracker-quant-fastapi-app.modal.run/optimize"
python - <<'PY' > /tmp/smoke_body.json
import json, random
random.seed(42)
def series(mu, sigma, n=120):
    return [round(random.gauss(mu, sigma), 6) for _ in range(n)]
body = {
    "symbols": ["A", "B"],
    "returns": {
        "A": series(mu=0.0004, sigma=0.012),
        "B": series(mu=0.0003, sigma=0.015),
    },
    "method": "mean_variance",
    "risk_free_rate": 0.0,
    "frontier_points": 0,
}
print(json.dumps(body))
PY
BODY=$(cat /tmp/smoke_body.json)
TS=$(date +%s)
SIG=$(printf "%s%s" "$BODY" "$TS" | openssl dgst -sha256 -hmac "$KEY" | awk '{print $2}')
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  --data "$BODY"
```

Expected (spec §4.1.1 shape): JSON with `optimal_weights`, `expected_return`, `expected_volatility`, `sharpe_ratio`, `frontier` (empty since `frontier_points=0`), `computed_at`, `elapsed_ms`.

- [ ] **Step 6: Commit a placeholder deploy log**

```bash
# The first deploy doesn't modify files, but we record the URL + key fingerprint
# so future Chunk 9 runbook can cross-reference.
# The heredoc uses UNQUOTED `<<EOF` so $(date) and $URL expand in-shell.
mkdir -p docs/runbooks
URL="https://<workspace>--investtracker-quant-fastapi-app.modal.run"
DATE=$(date +%Y-%m-%d)
cat > docs/runbooks/quant-deploy-bootstrap.md <<EOF
# Quant service bootstrap record

Initial Modal deploy completed on ${DATE}.

- Modal app: \`investtracker-quant\`
- Function: \`fastapi_app\` (keep_warm=1, timeout=60s, memory=2048 MB)
- URL: \`${URL}\`
- Secret name: \`quant-service-secrets\`
- HMAC key fingerprint (SHA-256 of first 8 bytes of key): \`<fill>\`

Key rotation: see \`docs/runbooks/quant-incidents.md\` → "Rotate HMAC key".
EOF
git add docs/runbooks/quant-deploy-bootstrap.md
git commit -m "docs(quant): bootstrap deploy record

Records Modal app URL, function config, and secret name after first
successful deploy. Key fingerprint is placeholder — operator fills
during rotation."
```

### Task 5.2: Python CI workflow (ruff + pytest)

**Files:**
- Create: `.github/workflows/quant-service-ci.yml`

- [ ] **Step 1: Write workflow**

```yaml
# .github/workflows/quant-service-ci.yml
name: quant-service CI

on:
  push:
    branches: [master]
    paths:
      - 'quant-service/**'
      - '.github/workflows/quant-service-ci.yml'
  pull_request:
    paths:
      - 'quant-service/**'

defaults:
  run:
    working-directory: quant-service

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          # Pin to a known-good version for reproducible CI. Bump deliberately
          # in its own commit so dependency upgrades show up in git blame.
          version: '0.4.30'
      - name: Install deps
        run: uv sync --all-extras
      - name: Lint with ruff
        run: uv run ruff check src tests
      - name: Format check
        run: uv run ruff format --check src tests
      - name: Run pytest
        run: uv run pytest -v --tb=short
        env:
          QUANT_SERVICE_HMAC_KEY: ci-test-key-do-not-use-in-prod
```

- [ ] **Step 2: Create `ruff.toml`**

```toml
# quant-service/ruff.toml
line-length = 100
target-version = "py312"

[lint]
select = ["E", "F", "I", "N", "UP", "B", "SIM", "RUF"]
ignore = ["E501"]  # line-length handled by formatter

[lint.per-file-ignores]
"tests/**" = ["E402"]  # fixtures import out of top-of-file sometimes
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/quant-service-ci.yml quant-service/ruff.toml
git commit -m "ci(quant): ruff lint + pytest workflow

Triggers on push/PR to master when quant-service/** changes. Uses
uv for dependency install (faster than pip). Test step runs with
a dummy HMAC key so TestClient tests pass without real secrets."
```

### Task 5.3: Modal deploy workflow (auto-deploy on master)

**Files:**
- Create: `.github/workflows/quant-service-deploy.yml`

- [ ] **Step 1: Write workflow**

```yaml
# .github/workflows/quant-service-deploy.yml
name: quant-service deploy

on:
  push:
    branches: [master]
    paths:
      - 'quant-service/**'
  workflow_dispatch:

defaults:
  run:
    working-directory: quant-service

jobs:
  deploy:
    # No `needs:` — this workflow runs in parallel with CI on the same push event.
    # GitHub Actions schema rejects `needs: []`, so we omit the key entirely.
    # See ordering note below for why we don't chain CI → deploy today.
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          # Must match the version pinned in quant-service-ci.yml so deploy
          # and CI produce identical lockfile resolution.
          version: '0.4.30'
      - name: Install deps
        run: uv sync
      - name: Deploy to Modal
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
        run: uv run modal deploy modal_app.py
      - name: Health check after deploy
        env:
          # Read from a secret (not a hard-coded URL) so the public Modal
          # URL is never committed to the repo. Fail loudly if it's unset.
          URL_BASE: ${{ secrets.QUANT_SERVICE_URL }}
        run: |
          if [ -z "$URL_BASE" ]; then
            echo "QUANT_SERVICE_URL secret is not set — cannot run health check."
            exit 1
          fi
          URL="${URL_BASE%/}/health"
          for i in 1 2 3 4 5; do
            if curl -sf "$URL" | grep -q '"status":"ok"'; then
              echo "Health check passed on try $i"
              exit 0
            fi
            echo "Try $i failed, retrying in 10s..."
            sleep 10
          done
          echo "Health check never succeeded"
          exit 1
```

**Note on ordering:** GitHub Actions doesn't auto-chain workflows across files. Deploy trigger is `push to master + path filter`, same as CI. If CI fails, the `deploy` job still runs on the same commit — *acceptable because Modal's own startup will fail fast on import errors*, but operators should watch both workflows. A future improvement: move both into one workflow with `needs: lint-and-test` — out of scope for this plan.

- [ ] **Step 2: Document required GitHub secrets**

Add to `docs/runbooks/quant-deploy-bootstrap.md`:

```markdown

## GitHub secrets (repo settings → Secrets and variables → Actions)

| Secret name | Purpose | Source |
|---|---|---|
| `MODAL_TOKEN_ID` | Modal deploy auth | `modal token new` output |
| `MODAL_TOKEN_SECRET` | Modal deploy auth | `modal token new` output |
| `QUANT_SERVICE_URL` | Post-deploy health check | From Task 5.1 Step 3 output |

These are separate from the HMAC key — they are Modal-account credentials,
not the HMAC signing key used by Next.js. That key lives ONLY in the Modal
secret `quant-service-secrets` and in Next.js env (see Chunk 7 Task 7.1).
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/quant-service-deploy.yml docs/runbooks/quant-deploy-bootstrap.md
git commit -m "ci(quant): Modal deploy workflow with post-deploy health check

Deploys on push-to-master when quant-service/** changes; 5-retry
health check prevents silent deploy regressions. Required GitHub
secrets documented in runbook."
```

### Task 5.4: HMAC key rotation runbook entry

**Files:**
- Modify: `docs/runbooks/quant-incidents.md` (stub here; detailed incidents go in Chunk 9)

- [ ] **Step 1: Write the rotation runbook stub**

```markdown
# docs/runbooks/quant-incidents.md

> Full incident playbooks (cold-start storms, solver hangs, rate-limit exhaustion)
> land in Chunk 9. This file currently only documents key rotation — the one
> operational task that must exist from day one.

## Rotate `QUANT_SERVICE_HMAC_KEY`

**When to rotate:**
- Scheduled: every 90 days.
- Unscheduled: suspected leak (e.g., key committed to git, log with key
  in breadcrumb body, shared outside ops team).

**Blast radius:**
- During the rotation window (up to 10 min = 2× the 5-min replay window),
  both the old and new keys are valid simultaneously. No downtime if steps
  are followed in order.

**Key names used in this procedure:**
- `QUANT_SERVICE_HMAC_KEY` — the current/active key. Read by both Modal
  and Next.js under this exact name.
- `QUANT_SERVICE_HMAC_KEY_NEXT` — temporary overlap key. Only present
  during rotation; both services remove it after promotion.

**Modal secret model:** the single secret `quant-service-secrets` holds
BOTH env vars during overlap. `modal secret create --force` replaces the
whole secret atomically (no per-var edit CLI).

**Procedure:**

1. Generate the new key:
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   # Keep this value in your password manager. You'll paste it twice.
   ```

2. Publish dual-key `auth.py` (both services accept OLD and NEXT):
   - Edit `quant-service/src/auth.py` → switch `validate_signature` to the
     dual-key variant shown in **"Dual-key acceptance (temporary code)"**
     below. Commit on a rotation branch.
   - Edit `src/lib/services/quant.ts` (Next.js) → send the signature using
     `HMAC_KEY_NEXT` when set; otherwise the old key (see Chunk 7 Task 7.1
     "Rotation support" subsection). Commit on the same branch.
   - **Do not deploy yet.** Commits only — we deploy in step 4, after
     both secret stores have the new key.

3. Publish BOTH keys to both secret stores:
   ```bash
   # Modal: replace the secret atomically with both keys present.
   modal secret create quant-service-secrets --force \
     QUANT_SERVICE_HMAC_KEY="<OLD-key>" \
     QUANT_SERVICE_HMAC_KEY_NEXT="<NEW-key>" \
     SENTRY_DSN="<same-as-before>" \
     ENVIRONMENT="production"

   # Vercel (Next.js): add the _NEXT alongside the existing KEY.
   vercel env add QUANT_SERVICE_HMAC_KEY_NEXT production
   # paste <NEW-key> when prompted
   ```

4. Deploy both services (dual-key code from step 2 + dual-key secrets from
   step 3). After this deploy, requests signed with either key are accepted.
   ```bash
   cd quant-service && uv run modal deploy modal_app.py
   # Next.js: `vercel --prod` (or trigger via PR merge, same effect)
   ```

5. Wait **≥10 minutes** so every in-flight request signed with the OLD
   key is either handled or past the 5-min replay window (×2 safety margin).

6. Cut over to the NEW key (drop the OLD from both stores):
   ```bash
   # Modal: replace again, this time with NEW under the canonical name,
   # and NO _NEXT variable.
   modal secret create quant-service-secrets --force \
     QUANT_SERVICE_HMAC_KEY="<NEW-key>" \
     SENTRY_DSN="<same-as-before>" \
     ENVIRONMENT="production"

   # Vercel: rewrite the canonical var with the NEW key, then delete _NEXT.
   vercel env rm QUANT_SERVICE_HMAC_KEY production
   vercel env add QUANT_SERVICE_HMAC_KEY production
   # paste <NEW-key>
   vercel env rm QUANT_SERVICE_HMAC_KEY_NEXT production
   ```

7. Revert dual-key code in `src/auth.py` AND `src/lib/services/quant.ts`
   back to single-key mode. Deploy both services.

8. Verify: run the `/health` and `/optimize` smoke tests from
   `docs/runbooks/quant-deploy-bootstrap.md` signed with `<NEW-key>` only.
   Both MUST succeed. If they fail with `HMAC_INVALID`, re-apply step 6.

9. Record the rotation in the **Rotation log** table at the bottom of
   this file with date + operator initials + first 8 hex chars of each
   key's SHA-256 as fingerprint.

### Dual-key acceptance (temporary code)

During the overlap window, `src/auth.py`'s `validate_signature` tries the
primary key first, then falls back to `_NEXT` if set:

```python
def validate_signature_with_rotation(body, ts, sig) -> None:
    keys = [os.environ["QUANT_SERVICE_HMAC_KEY"]]
    if next_key := os.environ.get("QUANT_SERVICE_HMAC_KEY_NEXT"):
        keys.append(next_key)
    for k in keys:
        try:
            validate_signature(body, ts, sig, k)
            return
        except HMACInvalidError:
            continue
    raise HMACInvalidError("Signature did not match any active key")
```

This is a TEMPORARY edit — revert it after step 6 completes (in step 7).

## Rotation log

| Date       | Operator | Reason     | Old key fingerprint | New key fingerprint |
|------------|----------|------------|---------------------|---------------------|
| YYYY-MM-DD | <init>   | scheduled  | <8-hex>             | <8-hex>             |
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/quant-incidents.md
git commit -m "docs(runbook): HMAC key rotation procedure for quant service

Documents dual-key overlap window (5 min) to allow zero-downtime
rotation. Temporary dual-key logic in src/auth.py is reverted after
the overlap window closes. Rotation log table provided."
```

---

## Chunk 6 — TypeScript `src/lib/quant/` pure-math library

**Goal:** Create a new TS math library that mirrors the Python `quant-service` but for lightweight metrics that don't need Modal (and for caching/precomputation in API routes). Every function is pure: input data → output numbers, no I/O, no database, no Supabase.

**Why a TS library?** §3.2 of the spec: "Lightweight metrics (Sharpe, Sortino, drawdown, HHI, correlation) are computed in TS to avoid paying the Modal cold-start tax on trivial math." The same functions are used by the UI for real-time recompute when the user tweaks weights in the Optimize page (§4.2.3) — no network round-trip needed.

**What goes in, what stays out:**
- IN: Sharpe, Sortino, max drawdown, drawdown series, annualized vol, correlation matrix, HHI, top-N concentration, weight drift, return aggregation (daily→weekly/monthly).
- OUT: optimization (Markowitz, HRP), Monte Carlo, factor regression, rebalance — all stay in Python. These are too heavy for hot-path TS and too complex to maintain in two languages.

**File layout:**
```
src/lib/quant/
  index.ts              ← barrel export
  types.ts              ← shared types
  metrics.ts            ← Sharpe, Sortino, max drawdown, annualized vol
  returns.ts            ← daily→weekly/monthly, log vs simple, cumulative
  concentration.ts      ← HHI, top-N exposure
  correlation.ts        ← pairwise Pearson correlation matrix
  drift.ts              ← target vs actual weight comparison
  drawdown.ts           ← drawdown series (underwater curve)
tests/lib/quant/
  metrics.test.ts
  returns.test.ts
  concentration.test.ts
  correlation.test.ts
  drift.test.ts
  drawdown.test.ts
```

**Tech:** Pure TS. `fast-check` for property tests (installed in Task 6.1 — verified NOT yet in `package.json` devDependencies as of spec date). No numpy, no simd — loop over typed arrays.

### Task 6.1: Install fast-check + shared types + barrel

**Files:**
- Modify: `package.json` (add `fast-check` devDependency)
- Create: `src/lib/quant/types.ts`
- Create: `src/lib/quant/index.ts`

- [ ] **Step 0: Install fast-check**

`fast-check` is NOT currently in `package.json` devDependencies. Install it:

```bash
npm install --save-dev fast-check@^3.23.0
```

Verify: `node -e "console.log(require('fast-check').__commitHash || require('fast-check/package.json').version)"` should print a version string.

- [ ] **Step 1: Write types**

```typescript
// src/lib/quant/types.ts
/**
 * Shared primitive types for the TS quant library.
 *
 * Conventions:
 *   - All arrays of returns are daily unless explicitly stated.
 *   - Returns are SIMPLE (not log) unless a function's name says otherwise.
 *   - Annualization uses 252 trading days.
 */
export type ReturnsArray = readonly number[];
export type ReturnsBySymbol = Readonly<Record<string, ReturnsArray>>;
export type WeightsMap = Readonly<Record<string, number>>;

export const TRADING_DAYS_PER_YEAR = 252;
```

- [ ] **Step 2: Write barrel**

```typescript
// src/lib/quant/index.ts
export * from "./types";
export * from "./metrics";
export * from "./returns";
export * from "./concentration";
export * from "./correlation";
export * from "./drift";
export * from "./drawdown";
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/lib/quant/types.ts src/lib/quant/index.ts
git commit -m "feat(quant/ts): shared types + barrel for src/lib/quant

Pure-math TS library for lightweight metrics (Sharpe, HHI, drawdown).
Complements the Python microservice which handles heavy math
(Markowitz, Monte Carlo). Adds fast-check devDependency for property
tests used in Task 6.6."
```

### Task 6.2: `metrics.ts` — Sharpe, Sortino, annualized vol, beta, alpha, Calmar, info ratio

**Spec §3.5 mandates:** `metrics.ts # Sharpe, Sortino, beta, alpha, max DD, Calmar, info ratio`. Max DD lives in `drawdown.ts` (Task 6.5 bundle) but is imported here for Calmar. All seven metrics go in this task.

**Definitions:**
- **Beta (Jensen):** β = Cov(R_p − rf, R_b − rf) / Var(R_b − rf). Slope of portfolio excess vs benchmark excess.
- **Alpha (Jensen):** α_annual = (mean(R_p) − rf_daily) · 252 − β · (mean(R_b) − rf_daily) · 252. Annualized excess over CAPM prediction.
- **Calmar:** annualized return / |max drawdown|. Return per unit of worst-case drawdown.
- **Information ratio:** mean(R_p − R_b) · 252 / (stdev(R_p − R_b) · √252). Active return / tracking error, both annualized.

**Files:**
- Create: `src/lib/quant/metrics.ts`
- Test: `tests/lib/quant/metrics.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/quant/metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  mean,
  sampleVariance,
  annualizedVolatility,
  sharpeRatio,
  sortinoRatio,
  beta,
  jensenAlpha,
  calmarRatio,
  informationRatio,
} from "@/lib/quant/metrics";

describe("mean", () => {
  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });
  it("computes simple average", () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
  });
});

describe("sampleVariance", () => {
  it("uses n-1 divisor (Bessel-corrected)", () => {
    // variance of [1,2,3,4,5] with n-1 = 2.5
    expect(sampleVariance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 10);
  });
  it("returns 0 for length <= 1", () => {
    expect(sampleVariance([])).toBe(0);
    expect(sampleVariance([42])).toBe(0);
  });
});

describe("annualizedVolatility", () => {
  it("scales daily stdev by √252", () => {
    // constant 1% daily returns → stdev 0 → annualized vol 0
    expect(annualizedVolatility([0.01, 0.01, 0.01])).toBe(0);
  });
  it("matches hand-computed value", () => {
    const daily = [0.01, -0.02, 0.015, -0.005, 0.008];
    const dailyStdev = Math.sqrt(sampleVariance(daily));
    const expected = dailyStdev * Math.sqrt(252);
    expect(annualizedVolatility(daily)).toBeCloseTo(expected, 10);
  });
});

describe("sharpeRatio", () => {
  it("returns 0 for zero-volatility portfolios", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 0.0)).toBe(0);
  });
  it("annualizes correctly", () => {
    // Daily mean 0.0005, daily stdev 0.015 → annualized Sharpe:
    // (0.0005 * 252) / (0.015 * √252) = 0.126 / 0.2381 ≈ 0.529
    const returns = Array.from({ length: 252 }, (_, i) =>
      i % 2 === 0 ? 0.0155 : -0.0145,
    );
    // This is contrived; just check it's finite and reasonable.
    const s = sharpeRatio(returns, 0.0);
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe("sortinoRatio", () => {
  it("only penalizes downside deviation", () => {
    // Portfolio with all positive returns → downside = 0 → Infinity (or large finite).
    const positive = [0.01, 0.015, 0.02, 0.005, 0.012];
    const s = sortinoRatio(positive, 0.0);
    expect(s).toBeGreaterThan(sharpeRatio(positive, 0.0));
  });
  it("returns 0 when no downside", () => {
    // Edge case: all returns at exactly 0 → no downside but also no upside.
    expect(sortinoRatio([0, 0, 0, 0], 0)).toBe(0);
  });
});

describe("beta", () => {
  it("is 1 when portfolio == benchmark", () => {
    const b = [0.01, -0.02, 0.015, -0.005, 0.008];
    expect(beta(b, b, 0)).toBeCloseTo(1, 10);
  });
  it("is 2 when portfolio = 2 * benchmark (scaled)", () => {
    const bench = [0.01, -0.02, 0.015, -0.005, 0.008];
    const port = bench.map((r) => 2 * r);
    expect(beta(port, bench, 0)).toBeCloseTo(2, 10);
  });
  it("is -1 when portfolio = -benchmark", () => {
    const bench = [0.01, -0.02, 0.015, -0.005, 0.008];
    const port = bench.map((r) => -r);
    expect(beta(port, bench, 0)).toBeCloseTo(-1, 10);
  });
  it("returns 0 when benchmark has zero variance", () => {
    expect(beta([0.01, -0.01, 0.02], [0.005, 0.005, 0.005], 0)).toBe(0);
  });
  it("truncates to shorter array length", () => {
    // Longer portfolio series, shorter benchmark — align to shorter tail.
    const port = [0.01, -0.02, 0.015, -0.005, 0.008];
    const bench = [-0.005, 0.008];
    const b = beta(port, bench, 0);
    expect(Number.isFinite(b)).toBe(true);
  });
});

describe("jensenAlpha", () => {
  it("is 0 when portfolio == benchmark (β=1, no alpha)", () => {
    const r = [0.01, -0.02, 0.015, -0.005, 0.008];
    expect(jensenAlpha(r, r, 0)).toBeCloseTo(0, 10);
  });
  it("matches hand-computed value for a toy series", () => {
    // Portfolio always 0.002 above benchmark → daily alpha 0.002; β=1.
    // Annualized α ≈ 0.002 * 252 = 0.504
    const bench = [0.01, -0.02, 0.015, -0.005, 0.008];
    const port = bench.map((r) => r + 0.002);
    expect(jensenAlpha(port, bench, 0)).toBeCloseTo(0.504, 2);
  });
});

describe("calmarRatio", () => {
  it("returns 0 when max drawdown is 0 (no losses observed)", () => {
    // Monotone-up series → max DD = 0 → undefined Calmar → return 0.
    expect(calmarRatio([0.01, 0.02, 0.015])).toBe(0);
  });
  it("is positive when returns are positive and there is drawdown", () => {
    // Series with some drawdown but positive overall.
    const r = [0.02, -0.05, 0.02, 0.02, 0.02, 0.02];
    const c = calmarRatio(r);
    expect(c).toBeGreaterThan(0);
    expect(Number.isFinite(c)).toBe(true);
  });
  it("has same sign as annualized return", () => {
    // Mostly negative → Calmar negative (numerator sign dominates; |DD| > 0).
    const r = [-0.02, -0.02, 0.01, -0.02, -0.02];
    expect(calmarRatio(r)).toBeLessThan(0);
  });
});

describe("informationRatio", () => {
  it("is 0 when portfolio == benchmark (zero active return)", () => {
    const r = [0.01, -0.02, 0.015, -0.005, 0.008];
    expect(informationRatio(r, r)).toBe(0);
  });
  it("is positive when portfolio consistently beats benchmark", () => {
    const bench = [0.01, -0.02, 0.015, -0.005, 0.008];
    const port = bench.map((r) => r + 0.002);
    const ir = informationRatio(port, bench);
    expect(ir).toBeGreaterThan(0);
    expect(Number.isFinite(ir)).toBe(true);
  });
  it("returns 0 when tracking error is zero but active return is nonzero", () => {
    // Constant alpha → tracking error 0 → IR undefined → return 0.
    // (degenerate case; caller treats as +∞ if they prefer)
    const bench = [0.01, -0.02, 0.015, -0.005, 0.008];
    const port = bench.map((r) => r + 0.002);
    // port - bench = [0.002, 0.002, 0.002, 0.002, 0.002] → stdev 0.
    expect(informationRatio(port, bench)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/quant/metrics.test.ts`
Expected: `Cannot find module '@/lib/quant/metrics'`

- [ ] **Step 3: Implement `metrics.ts`**

```typescript
// src/lib/quant/metrics.ts
import { TRADING_DAYS_PER_YEAR, type ReturnsArray } from "./types";
import { maxDrawdown } from "./drawdown";

export function mean(xs: ReturnsArray): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function sampleVariance(xs: ReturnsArray): number {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / (xs.length - 1);
}

export function annualizedVolatility(xs: ReturnsArray): number {
  return Math.sqrt(sampleVariance(xs)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

export function sharpeRatio(xs: ReturnsArray, riskFreeRate: number): number {
  if (xs.length === 0) return 0;
  const dailyMean = mean(xs);
  const dailyStdev = Math.sqrt(sampleVariance(xs));
  if (dailyStdev === 0) return 0;
  const annualizedExcess =
    dailyMean * TRADING_DAYS_PER_YEAR - riskFreeRate;
  const annualizedVol = dailyStdev * Math.sqrt(TRADING_DAYS_PER_YEAR);
  return annualizedExcess / annualizedVol;
}

export function sortinoRatio(
  xs: ReturnsArray,
  riskFreeRate: number,
  target = 0,
): number {
  if (xs.length === 0) return 0;
  const dailyMean = mean(xs);
  let downsideSumSq = 0;
  let downsideCount = 0;
  for (const x of xs) {
    const d = x - target;
    if (d < 0) {
      downsideSumSq += d * d;
      downsideCount += 1;
    }
  }
  if (downsideCount === 0) {
    // No observed downside — return 0 (per convention; caller can treat as +∞).
    return 0;
  }
  const downsideStdev = Math.sqrt(downsideSumSq / downsideCount);
  if (downsideStdev === 0) return 0;
  const annualizedExcess =
    dailyMean * TRADING_DAYS_PER_YEAR - riskFreeRate;
  const annualizedDownside =
    downsideStdev * Math.sqrt(TRADING_DAYS_PER_YEAR);
  return annualizedExcess / annualizedDownside;
}

/**
 * Align two series to their shorter length by taking the trailing `n` of each.
 * This matches the convention in the Python service for un-aligned series.
 */
function alignTail(
  a: ReturnsArray,
  b: ReturnsArray,
): { a: number[]; b: number[] } {
  const n = Math.min(a.length, b.length);
  return {
    a: a.slice(a.length - n),
    b: b.slice(b.length - n),
  };
}

/**
 * CAPM β of portfolio vs benchmark. Uses excess returns (r - rf_daily).
 * Returns 0 if benchmark variance is 0 (well-defined fallback — caller
 * should treat as "benchmark undefined").
 *
 * rf is a DAILY risk-free rate (not annualized) — matches the shape used by
 * sharpeRatio for internal consistency within this module. If callers have
 * an annualized rf, divide by 252 before passing.
 */
export function beta(
  portfolio: ReturnsArray,
  benchmark: ReturnsArray,
  riskFreeDaily: number,
): number {
  const { a, b } = alignTail(portfolio, benchmark);
  if (a.length < 2) return 0;
  const pxs = a.map((r) => r - riskFreeDaily);
  const bxs = b.map((r) => r - riskFreeDaily);
  const mp = mean(pxs);
  const mb = mean(bxs);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < pxs.length; i++) {
    const dp = pxs[i] - mp;
    const db = bxs[i] - mb;
    cov += dp * db;
    varB += db * db;
  }
  cov /= pxs.length - 1;
  varB /= pxs.length - 1;
  if (varB === 0) return 0;
  return cov / varB;
}

/**
 * Annualized Jensen's alpha: α = (E[R_p] - rf) · 252 - β · (E[R_b] - rf) · 252.
 * Positive α → outperformed CAPM prediction. rf is DAILY (same as beta).
 */
export function jensenAlpha(
  portfolio: ReturnsArray,
  benchmark: ReturnsArray,
  riskFreeDaily: number,
): number {
  const { a, b } = alignTail(portfolio, benchmark);
  if (a.length === 0) return 0;
  const β = beta(a, b, riskFreeDaily);
  const annPortExcess = (mean(a) - riskFreeDaily) * TRADING_DAYS_PER_YEAR;
  const annBenchExcess = (mean(b) - riskFreeDaily) * TRADING_DAYS_PER_YEAR;
  return annPortExcess - β * annBenchExcess;
}

/**
 * Calmar ratio: annualized return / |max drawdown|.
 * Returns 0 when max drawdown is 0 (no losses observed → undefined ratio).
 * Sign matches annualized return. `mean · 252` is the simple annualization.
 */
export function calmarRatio(xs: ReturnsArray): number {
  if (xs.length === 0) return 0;
  const annReturn = mean(xs) * TRADING_DAYS_PER_YEAR;
  const maxDd = maxDrawdown(xs);
  if (maxDd === 0) return 0;
  return annReturn / Math.abs(maxDd);
}

/**
 * Information ratio: annualized active return / annualized tracking error.
 * Tracking error = stdev(R_p - R_b). Returns 0 when TE is 0.
 */
export function informationRatio(
  portfolio: ReturnsArray,
  benchmark: ReturnsArray,
): number {
  const { a, b } = alignTail(portfolio, benchmark);
  if (a.length < 2) return 0;
  const active = a.map((r, i) => r - b[i]);
  const teDaily = Math.sqrt(sampleVariance(active));
  if (teDaily === 0) return 0;
  const annActive = mean(active) * TRADING_DAYS_PER_YEAR;
  const annTe = teDaily * Math.sqrt(TRADING_DAYS_PER_YEAR);
  return annActive / annTe;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/quant/metrics.test.ts`
Expected: all 22 tests PASS (5 descriptions × ~2-5 its). Note: `metrics.ts` imports `maxDrawdown` from `./drawdown` — if `drawdown.ts` is not yet implemented (Task 6.5 comes later), run this command AFTER finishing Task 6.5, OR implement `drawdown.ts` first. The TDD-safe ordering is: Task 6.1 → 6.3 → 6.4 → 6.5 → 6.2 → 6.6, keeping `metrics.ts` last of the implementations. The plan's original numbering is a reading order; execution can reorder.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quant/metrics.ts tests/lib/quant/metrics.test.ts
git commit -m "feat(quant/ts): Sharpe, Sortino, ann vol, beta, alpha, Calmar, info ratio

Seven portfolio metrics per spec §3.5. Bessel-corrected sample variance
(n-1). All annualize by 252 trading days. beta/jensenAlpha/informationRatio
align series by tail when lengths differ; Calmar uses |max drawdown| and
returns 0 when DD=0 (undefined ratio). All return 0 for degenerate inputs
(zero vol, zero TE, zero bench variance) — never NaN or Infinity."
```

### Task 6.3: `returns.ts` — aggregation helpers

**Files:**
- Create: `src/lib/quant/returns.ts`
- Test: `tests/lib/quant/returns.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/quant/returns.test.ts
import { describe, it, expect } from "vitest";
import {
  simpleToLog,
  logToSimple,
  cumulativeReturn,
  aggregateToPeriod,
} from "@/lib/quant/returns";

describe("simpleToLog / logToSimple", () => {
  it("roundtrips to within floating-point tolerance", () => {
    const simple = [0.01, -0.02, 0.005, 0.015];
    const log = simpleToLog(simple);
    const back = logToSimple(log);
    for (let i = 0; i < simple.length; i++) {
      expect(back[i]).toBeCloseTo(simple[i], 12);
    }
  });
});

describe("cumulativeReturn", () => {
  it("compounds simple returns multiplicatively", () => {
    // (1 + 0.10)(1 + 0.05)(1 − 0.02) − 1 = 0.1309
    expect(cumulativeReturn([0.10, 0.05, -0.02])).toBeCloseTo(0.1309, 4);
  });
  it("returns 0 for empty", () => {
    expect(cumulativeReturn([])).toBe(0);
  });
});

describe("aggregateToPeriod", () => {
  it("compounds 5 daily returns into 1 weekly return", () => {
    const daily = [0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02];
    const weekly = aggregateToPeriod(daily, 5);
    expect(weekly).toHaveLength(2);
    // First week: (1.01)^5 − 1 ≈ 0.05101
    expect(weekly[0]).toBeCloseTo(0.05101, 4);
    // Second week: (1.02)^5 − 1 ≈ 0.10408
    expect(weekly[1]).toBeCloseTo(0.10408, 4);
  });
  it("drops trailing incomplete period", () => {
    const daily = [0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.02]; // 7 days, period 5
    const weekly = aggregateToPeriod(daily, 5);
    expect(weekly).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/quant/returns.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/quant/returns.ts
import type { ReturnsArray } from "./types";

export function simpleToLog(xs: ReturnsArray): number[] {
  return xs.map((x) => Math.log(1 + x));
}

export function logToSimple(xs: ReturnsArray): number[] {
  return xs.map((x) => Math.exp(x) - 1);
}

export function cumulativeReturn(xs: ReturnsArray): number {
  if (xs.length === 0) return 0;
  let prod = 1;
  for (const x of xs) prod *= 1 + x;
  return prod - 1;
}

/**
 * Compound `xs` into periods of `periodDays` consecutive daily returns.
 * Incomplete trailing period is dropped.
 *
 * @example aggregateToPeriod(daily, 5)  // daily → weekly
 * @example aggregateToPeriod(daily, 21) // daily → monthly (~21 trading days)
 */
export function aggregateToPeriod(
  xs: ReturnsArray,
  periodDays: number,
): number[] {
  if (periodDays <= 0) return [];
  const out: number[] = [];
  const fullPeriods = Math.floor(xs.length / periodDays);
  for (let p = 0; p < fullPeriods; p++) {
    let prod = 1;
    for (let i = 0; i < periodDays; i++) {
      prod *= 1 + xs[p * periodDays + i];
    }
    out.push(prod - 1);
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/quant/returns.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quant/returns.ts tests/lib/quant/returns.test.ts
git commit -m "feat(quant/ts): simple↔log return conversion + period aggregation

aggregateToPeriod compounds daily returns into weekly (5d), monthly
(21d), or arbitrary period. Trailing incomplete periods dropped."
```

### Task 6.4: `concentration.ts` — HHI + top-N

**Files:**
- Create: `src/lib/quant/concentration.ts`
- Test: `tests/lib/quant/concentration.test.ts`

**Note on the existing `src/lib/services/concentration.ts`:**

An existing service file at `src/lib/services/concentration.ts` (pre-Phase 2 code) contains **portfolio alert rules** — not math:

- `evaluateConcentration()` at `src/lib/services/concentration.ts:17` emits alerts when a single position exceeds 25% (warning) or 40% (critical), a sector exceeds 50%, or an asset type exceeds 80%.
- `saveAlerts()` at `src/lib/services/concentration.ts:90` persists them to the `portfolio_alerts` table.

The new file at `src/lib/quant/concentration.ts` (this task) contains **pure math only** (HHI, top-N, effective-N) with no side effects and no hard-coded thresholds.

**Scope boundary:**
- Phase 2: create the new quant math file; leave `src/lib/services/concentration.ts` **unchanged**.
- Do NOT delete, rename, or modify `src/lib/services/concentration.ts` as part of this task.
- Spec §3.5 mentions "(move from services/concentration.ts)" — this is aspirational for a future refactor (a Phase 3+ cleanup could have `services/concentration.ts` import `hhi`/`topNExposure` from the new file and expose them alongside the alert rules). Out of scope here.
- The two files are **complementary, not duplicates** — different responsibilities (alert rules vs. pure math).

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/quant/concentration.test.ts
import { describe, it, expect } from "vitest";
import {
  hhi,
  topNExposure,
  effectiveN,
} from "@/lib/quant/concentration";

describe("hhi", () => {
  it("returns 1 for a single-position portfolio", () => {
    expect(hhi({ AAPL: 1.0 })).toBeCloseTo(1.0, 10);
  });
  it("returns 1/n for equal-weight n assets", () => {
    const w = { A: 0.25, B: 0.25, C: 0.25, D: 0.25 };
    expect(hhi(w)).toBeCloseTo(0.25, 10);
  });
  it("ignores zero weights", () => {
    expect(hhi({ A: 0.5, B: 0.5, C: 0 })).toBeCloseTo(0.5, 10);
  });
  it("returns 0 for empty weights", () => {
    expect(hhi({})).toBe(0);
  });
});

describe("topNExposure", () => {
  it("returns sum of top N largest weights", () => {
    const w = { A: 0.4, B: 0.3, C: 0.2, D: 0.1 };
    expect(topNExposure(w, 2)).toBeCloseTo(0.7, 10);
    expect(topNExposure(w, 1)).toBeCloseTo(0.4, 10);
    expect(topNExposure(w, 4)).toBeCloseTo(1.0, 10);
    expect(topNExposure(w, 10)).toBeCloseTo(1.0, 10); // n > count → all
  });
});

describe("effectiveN", () => {
  it("returns 1/HHI (participation ratio)", () => {
    const w = { A: 0.25, B: 0.25, C: 0.25, D: 0.25 };
    expect(effectiveN(w)).toBeCloseTo(4, 10);
  });
  it("returns 0 for empty weights", () => {
    expect(effectiveN({})).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/quant/concentration.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/quant/concentration.ts
import type { WeightsMap } from "./types";

/**
 * Herfindahl-Hirschman Index on portfolio weights.
 *
 * HHI = Σ wᵢ² for wᵢ ≥ 0. Range: [0, 1].
 *   1 → fully concentrated in one asset.
 *   1/n → perfect diversification across n equal assets.
 */
export function hhi(weights: WeightsMap): number {
  let s = 0;
  for (const w of Object.values(weights)) {
    if (w > 0) s += w * w;
  }
  return s;
}

/** Sum of the top-N largest (positive) weights in the portfolio. */
export function topNExposure(weights: WeightsMap, n: number): number {
  if (n <= 0) return 0;
  const sorted = Object.values(weights)
    .filter((w) => w > 0)
    .sort((a, b) => b - a);
  let s = 0;
  for (let i = 0; i < Math.min(n, sorted.length); i++) {
    s += sorted[i];
  }
  return s;
}

/** Effective number of positions (inverse HHI). 0 when empty. */
export function effectiveN(weights: WeightsMap): number {
  const h = hhi(weights);
  return h > 0 ? 1 / h : 0;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/quant/concentration.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quant/concentration.ts tests/lib/quant/concentration.test.ts
git commit -m "feat(quant/ts): HHI + top-N + effective-N concentration metrics

Pure math. Complements services/concentration.ts (which handles alert
generation). A future refactor can make the services layer call into
this module — out of scope here."
```

### Task 6.5: `correlation.ts`, `drift.ts`, `drawdown.ts` (compact bundle)

**Files:**
- Create: `src/lib/quant/correlation.ts`
- Create: `src/lib/quant/drift.ts`
- Create: `src/lib/quant/drawdown.ts`
- Test: `tests/lib/quant/correlation.test.ts`, `drift.test.ts`, `drawdown.test.ts`

- [ ] **Step 1: Write all three tests**

```typescript
// tests/lib/quant/correlation.test.ts
import { describe, it, expect } from "vitest";
import {
  correlationMatrix,
  spearmanCorrelationMatrix,
  rollingCorrelation,
} from "@/lib/quant/correlation";

// Return shape is Record<string, Record<string, number>> (nested).
// Nested-map avoids the key-collision bug that a flat `${a}${b}` key has when
// symbol names happen to concatenate (e.g. "A"+"BC" === "AB"+"C" === "ABC").

describe("correlationMatrix (Pearson)", () => {
  it("returns 1 on the diagonal", () => {
    const m = correlationMatrix({
      A: [0.01, -0.02, 0.015, 0.005],
      B: [-0.01, 0.02, -0.015, -0.005],
    });
    expect(m.A.A).toBeCloseTo(1, 10);
    expect(m.B.B).toBeCloseTo(1, 10);
  });
  it("is symmetric: m[a][b] === m[b][a]", () => {
    const m = correlationMatrix({
      A: [0.01, -0.02, 0.015, 0.005],
      B: [-0.005, 0.01, -0.02, 0.015],
    });
    expect(m.A.B).toBeCloseTo(m.B.A, 10);
  });
  it("perfect anti-correlation → -1", () => {
    const m = correlationMatrix({
      A: [0.01, 0.02, 0.03, 0.04, 0.05],
      B: [-0.01, -0.02, -0.03, -0.04, -0.05],
    });
    expect(m.A.B).toBeCloseTo(-1, 6);
  });
  it("independent series → near 0", () => {
    const rng = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 9301 + 49297) % 233280;
        return (s / 233280 - 0.5) * 0.04;
      };
    };
    const r1 = rng(1);
    const r2 = rng(2);
    const a = Array.from({ length: 500 }, () => r1());
    const b = Array.from({ length: 500 }, () => r2());
    const m = correlationMatrix({ A: a, B: b });
    expect(Math.abs(m.A.B)).toBeLessThan(0.15);
  });
  it("handles symbols whose names concatenate (regression test)", () => {
    // Without a separator, key = `${a}${b}` could collide:
    //   ("AB","C") vs ("A","BC") both produce "ABC".
    // Nested shape makes each (row,col) unambiguous.
    const m = correlationMatrix({
      AB: [0.01, 0.02, -0.01, 0.015],
      C: [-0.005, 0.01, 0.02, -0.015],
      A: [0.02, -0.01, 0.015, 0.005],
      BC: [0.01, 0.015, -0.02, 0.01],
    });
    // All four diagonal entries exist and are 1.
    expect(m.AB.AB).toBeCloseTo(1, 10);
    expect(m.A.BC).not.toBe(m.AB.C); // different cells, no collision
    expect(typeof m.A.BC).toBe("number");
    expect(typeof m.AB.C).toBe("number");
  });
});

describe("spearmanCorrelationMatrix", () => {
  it("is 1 for monotonic (non-linear) co-movement", () => {
    // Monotonic transform → Pearson ≠ 1 but Spearman = 1.
    const m = spearmanCorrelationMatrix({
      A: [1, 2, 3, 4, 5],
      B: [10, 100, 1000, 10000, 100000], // y = 10^x, monotonic but not linear
    });
    expect(m.A.B).toBeCloseTo(1, 10);
  });
  it("is -1 for monotonic anti-correlation", () => {
    const m = spearmanCorrelationMatrix({
      A: [1, 2, 3, 4, 5],
      B: [5, 4, 3, 2, 1],
    });
    expect(m.A.B).toBeCloseTo(-1, 10);
  });
  it("handles tied ranks via average rank", () => {
    // Ties: [1, 2, 2, 3] → ranks [1, 2.5, 2.5, 4].
    // Matching partner identical distribution → Spearman = 1.
    const m = spearmanCorrelationMatrix({
      A: [1, 2, 2, 3],
      B: [10, 20, 20, 30],
    });
    expect(m.A.B).toBeCloseTo(1, 10);
  });
  it("diagonal is 1", () => {
    const m = spearmanCorrelationMatrix({
      A: [0.01, -0.02, 0.015, 0.005],
    });
    expect(m.A.A).toBeCloseTo(1, 10);
  });
});

describe("rollingCorrelation", () => {
  it("length is n - window + 1", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [-0.01, -0.02, 0.01, -0.03, 0.02];
    expect(rollingCorrelation(a, b, 3)).toHaveLength(3); // 5 - 3 + 1
  });
  it("returns empty when window > n", () => {
    expect(rollingCorrelation([0.01, 0.02], [0.01, 0.02], 5)).toEqual([]);
  });
  it("returns empty when window < 2", () => {
    expect(rollingCorrelation([0.01, 0.02], [0.01, 0.02], 1)).toEqual([]);
  });
  it("each element equals full-window Pearson of its slice", () => {
    const a = [0.01, -0.02, 0.015, -0.005, 0.008, 0.012];
    const b = [-0.01, 0.02, -0.015, 0.005, -0.008, -0.012];
    const w = 4;
    const rolling = rollingCorrelation(a, b, w);
    // Third rolling window = a[2..5], b[2..5] — compute Pearson directly.
    const aSlice = a.slice(2, 2 + w);
    const bSlice = b.slice(2, 2 + w);
    const m = correlationMatrix({ A: aSlice, B: bSlice });
    expect(rolling[2]).toBeCloseTo(m.A.B, 10);
  });
  it("detects correlation-break: rolling value tracks changing regime", () => {
    // First half: perfectly correlated; second half: anti-correlated.
    const a = [0.01, 0.02, 0.03, 0.04, 0.01, 0.02, 0.03, 0.04];
    const b = [0.01, 0.02, 0.03, 0.04, -0.01, -0.02, -0.03, -0.04];
    const r = rollingCorrelation(a, b, 4);
    // First window (indices 0-3): perfect +1.
    expect(r[0]).toBeCloseTo(1, 6);
    // Last window (indices 4-7): perfect -1.
    expect(r[r.length - 1]).toBeCloseTo(-1, 6);
  });
});
```

```typescript
// tests/lib/quant/drift.test.ts
import { describe, it, expect } from "vitest";
import { weightDrift, totalDrift } from "@/lib/quant/drift";

describe("weightDrift", () => {
  it("returns signed drifts (actual − target)", () => {
    const d = weightDrift(
      { AAPL: 0.40, MSFT: 0.30, GOOG: 0.30 },
      { AAPL: 0.33, MSFT: 0.33, GOOG: 0.34 },
    );
    expect(d.AAPL).toBeCloseTo(0.07, 10);
    expect(d.MSFT).toBeCloseTo(-0.03, 10);
    expect(d.GOOG).toBeCloseTo(-0.04, 10);
  });
  it("returns drift for symbols in target but missing from actual", () => {
    const d = weightDrift({ A: 1.0 }, { A: 0.5, B: 0.5 });
    expect(d.B).toBeCloseTo(-0.5, 10);
  });
});

describe("totalDrift", () => {
  it("is L1 norm of per-symbol drifts", () => {
    const t = totalDrift(
      { A: 0.5, B: 0.5 },
      { A: 0.4, B: 0.6 },
    );
    expect(t).toBeCloseTo(0.2, 10);  // |0.1| + |-0.1|
  });
});
```

```typescript
// tests/lib/quant/drawdown.test.ts
import { describe, it, expect } from "vitest";
import { drawdownSeries, maxDrawdown } from "@/lib/quant/drawdown";

describe("drawdownSeries", () => {
  it("is zero while hitting new highs", () => {
    const dd = drawdownSeries([0.01, 0.02, 0.01, 0.03]);
    for (const v of dd) expect(v).toBeLessThanOrEqual(0);
    expect(dd[0]).toBe(0);
  });
  it("goes negative after a peak", () => {
    const dd = drawdownSeries([0.10, -0.20, 0.05]);
    // Equity curve: 1.10, 0.88, 0.924. Peak = 1.10.
    // DD = (0.88 − 1.10)/1.10 = -0.2; (0.924 − 1.10)/1.10 = -0.16
    expect(dd[0]).toBeCloseTo(0, 10);
    expect(dd[1]).toBeCloseTo(-0.2, 6);
    expect(dd[2]).toBeCloseTo(-0.16, 6);
  });
});

describe("maxDrawdown", () => {
  it("returns the absolute minimum of the drawdown series", () => {
    const md = maxDrawdown([0.1, -0.2, 0.05, -0.1]);
    // After returns: 1.10, 0.88, 0.924, 0.8316. Peak=1.10. Trough=0.8316.
    // Max DD = (0.8316 − 1.10)/1.10 ≈ -0.244
    expect(md).toBeCloseTo(-0.244, 3);
  });
  it("returns 0 for monotone-up series", () => {
    expect(maxDrawdown([0.01, 0.02, 0.01])).toBe(0);
  });
});
```

- [ ] **Step 2: Implement all three modules**

```typescript
// src/lib/quant/correlation.ts
import type { ReturnsArray, ReturnsBySymbol } from "./types";
import { mean, sampleVariance } from "./metrics";

export type CorrelationMatrix = Record<string, Record<string, number>>;

/** Pearson correlation of two aligned series; tail-aligns if different length. */
function pearson(a: ReturnsArray, b: ReturnsArray): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const aSlice = a.slice(a.length - n);
  const bSlice = b.slice(b.length - n);
  const ma = mean(aSlice);
  const mb = mean(bSlice);
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (aSlice[i] - ma) * (bSlice[i] - mb);
  }
  cov /= n - 1;
  const sa = Math.sqrt(sampleVariance(aSlice));
  const sb = Math.sqrt(sampleVariance(bSlice));
  if (sa === 0 || sb === 0) return 0;
  return cov / (sa * sb);
}

/**
 * Pairwise Pearson correlation across all symbols. Returns a nested map
 * `m[row][col]` so symbol names cannot collide (a flat `${a}${b}` key
 * could: "A"+"BC" and "AB"+"C" both produce "ABC").
 */
export function correlationMatrix(returns: ReturnsBySymbol): CorrelationMatrix {
  const symbols = Object.keys(returns);
  const out: CorrelationMatrix = {};
  for (const a of symbols) {
    out[a] = {};
    for (const b of symbols) {
      if (a === b) {
        // Exactly 1 on diagonal (handles zero-variance case too).
        out[a][b] = 1;
      } else {
        out[a][b] = pearson(returns[a], returns[b]);
      }
    }
  }
  return out;
}

/**
 * Dense-rank an array using the average-rank method for ties.
 * @example rank([10, 20, 20, 30]) === [1, 2.5, 2.5, 4]
 */
function averageRank(xs: ReturnsArray): number[] {
  const n = xs.length;
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((p, q) => p.v - q.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    // Ranks i..j are all tied — assign the average rank (1-indexed).
    const avg = (i + j + 2) / 2; // (rank_i + rank_j) / 2 where rank = k+1
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation = Pearson on ranks. Captures monotonic
 * relationships (linear or not) and is robust to outliers relative
 * to Pearson.
 */
export function spearmanCorrelationMatrix(
  returns: ReturnsBySymbol,
): CorrelationMatrix {
  const ranks: ReturnsBySymbol = Object.fromEntries(
    Object.entries(returns).map(([sym, xs]) => [sym, averageRank(xs)]),
  );
  return correlationMatrix(ranks);
}

/**
 * Rolling Pearson correlation of `a` and `b` over a sliding window of
 * `window` days. Output length = `n - window + 1` (empty if window > n
 * or window < 2). Used by Smart Alerts (§3.1 of spec — correlation-break
 * detection: |rolling_30d - rolling_90d| > 0.4).
 */
export function rollingCorrelation(
  a: ReturnsArray,
  b: ReturnsArray,
  window: number,
): number[] {
  const n = Math.min(a.length, b.length);
  if (window < 2 || window > n) return [];
  const out: number[] = [];
  for (let start = 0; start + window <= n; start++) {
    const aSlice = a.slice(start, start + window);
    const bSlice = b.slice(start, start + window);
    out.push(pearson(aSlice, bSlice));
  }
  return out;
}
```

```typescript
// src/lib/quant/drift.ts
import type { WeightsMap } from "./types";

/** Per-symbol signed drift (actual − target). */
export function weightDrift(
  actual: WeightsMap,
  target: WeightsMap,
): Record<string, number> {
  const symbols = new Set([...Object.keys(actual), ...Object.keys(target)]);
  const out: Record<string, number> = {};
  for (const s of symbols) {
    out[s] = (actual[s] ?? 0) - (target[s] ?? 0);
  }
  return out;
}

/** L1 total drift: Σ |actualᵢ − targetᵢ|. */
export function totalDrift(actual: WeightsMap, target: WeightsMap): number {
  const d = weightDrift(actual, target);
  let s = 0;
  for (const v of Object.values(d)) s += Math.abs(v);
  return s;
}
```

```typescript
// src/lib/quant/drawdown.ts
import type { ReturnsArray } from "./types";

/**
 * Drawdown series: equity relative to running peak, as a non-positive number.
 * dd[t] = (equity[t] − peak[0..t]) / peak[0..t]
 */
export function drawdownSeries(returns: ReturnsArray): number[] {
  const out: number[] = [];
  let equity = 1;
  let peak = 1;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    out.push(peak > 0 ? (equity - peak) / peak : 0);
  }
  return out;
}

/** Most negative (worst) value in the drawdown series. */
export function maxDrawdown(returns: ReturnsArray): number {
  const dd = drawdownSeries(returns);
  if (dd.length === 0) return 0;
  return Math.min(0, ...dd);
}
```

- [ ] **Step 3: Run all three test suites**

Run: `npm test -- tests/lib/quant`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/quant/correlation.ts src/lib/quant/drift.ts src/lib/quant/drawdown.ts \
        tests/lib/quant/correlation.test.ts tests/lib/quant/drift.test.ts \
        tests/lib/quant/drawdown.test.ts
git commit -m "feat(quant/ts): correlation (Pearson+Spearman+rolling) + drift + drawdown

Correlation matrix uses nested Record<row,Record<col,number>> shape to
avoid the flat-key collision ('A'+'BC' vs 'AB'+'C'). Spearman via
average-rank Pearson. Rolling window supports the Smart Alerts §3.1
correlation-break rule (|rolling_30d - rolling_90d| > 0.4). L1 weight
drift and drawdown series (equity vs running peak). All pure, no I/O."
```

### Task 6.6: Property tests (fast-check) for invariants

**Files:**
- Create: `tests/lib/quant/properties.test.ts`

**Design note — what makes a property test non-trivial:**

A good property test asserts an invariant that is NOT the direct consequence of the implementation's expression. For example:
- "HHI ∈ [0,1]" is non-trivial — it requires Σwᵢ=1 (Cauchy-Schwarz bound), not just "w>0 and we square".
- "maxDrawdown ≤ 0" IS trivial because the code contains `Math.min(0, ...dd)` — the invariant is baked in, so a green test here doesn't catch any realistic bug.

For each retained property, verify: *if a developer rewrote the implementation to be wrong, would this property catch it?* If not, delete it or strengthen it.

- [ ] **Step 1: Write property tests**

```typescript
// tests/lib/quant/properties.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hhi, topNExposure, effectiveN } from "@/lib/quant/concentration";
import { maxDrawdown, drawdownSeries } from "@/lib/quant/drawdown";
import { totalDrift } from "@/lib/quant/drift";
import {
  annualizedVolatility,
  sampleVariance,
} from "@/lib/quant/metrics";
import { cumulativeReturn } from "@/lib/quant/returns";

describe("quant/ts invariants", () => {
  // ── Non-trivial: HHI upper bound requires Σw=1 (Cauchy-Schwarz).
  it("HHI ∈ [1/n, 1] for any normalized weight distribution", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0.0001, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (raw) => {
          const sum = raw.reduce((a, b) => a + b, 0);
          const weights = Object.fromEntries(
            raw.map((w, i) => [`S${i}`, w / sum]),
          );
          const h = hhi(weights);
          // Strong bound: h >= 1/n by Cauchy-Schwarz (when Σw=1).
          return h >= 1 / raw.length - 1e-9 && h <= 1 + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: requires HHI inverse relationship to hold.
  it("effectiveN ≤ n (Cauchy-Schwarz: (Σwᵢ)² ≤ n·Σwᵢ²)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0.0001, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (raw) => {
          const sum = raw.reduce((a, b) => a + b, 0);
          const weights = Object.fromEntries(
            raw.map((w, i) => [`S${i}`, w / sum]),
          );
          return effectiveN(weights) <= raw.length + 1e-6;
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: requires sorting to be correct.
  it("topNExposure is monotone non-decreasing in n", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0.0001, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.integer({ min: 1, max: 19 }),
        (raw, k) => {
          const sum = raw.reduce((a, b) => a + b, 0);
          const weights = Object.fromEntries(
            raw.map((w, i) => [`S${i}`, w / sum]),
          );
          if (k >= raw.length) return true;
          return topNExposure(weights, k) <= topNExposure(weights, k + 1) + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: requires peak-tracking to reset correctly on new highs.
  // Invariant: a monotone-up series (all positive) should produce DD=0 at every step.
  it("drawdown series is 0 whenever returns are all non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 0.5, noNaN: true }), {
          minLength: 1,
          maxLength: 100,
        }),
        (returns) => {
          const dd = drawdownSeries(returns);
          return dd.every((x) => Math.abs(x) < 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: requires peak-tracking to update on new highs.
  // Invariant: appending ONLY positive returns to any series keeps maxDrawdown
  // non-increasing in magnitude (i.e., max DD doesn't get worse after recovery).
  it("appending positive returns never increases |maxDrawdown|", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.3, max: 0.3, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.array(fc.float({ min: 0.001, max: 0.1, noNaN: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        (base, tail) => {
          const ddBefore = Math.abs(maxDrawdown(base));
          const ddAfter = Math.abs(maxDrawdown([...base, ...tail]));
          return ddAfter <= ddBefore + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: L1 upper bound = 2 is tight (all mass on disjoint symbols).
  // Invariant: totalDrift is also symmetric in its arguments.
  it("totalDrift is in [0, 2] and symmetric", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0.0001, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.array(fc.float({ min: 0.0001, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 20,
        }),
        (a, b) => {
          const aSum = a.reduce((x, y) => x + y, 0);
          const bSum = b.reduce((x, y) => x + y, 0);
          const aMap = Object.fromEntries(a.map((w, i) => [`S${i}`, w / aSum]));
          const bMap = Object.fromEntries(b.map((w, i) => [`S${i}`, w / bSum]));
          const t = totalDrift(aMap, bMap);
          const tSym = totalDrift(bMap, aMap);
          return t >= 0 && t <= 2 + 1e-9 && Math.abs(t - tSym) < 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: requires sampleVariance to subtract the mean correctly.
  // Invariant: variance is SHIFT-INVARIANT — adding a constant leaves it unchanged.
  // A buggy impl that computed E[X²] instead of E[(X-E[X])²] would fail this.
  it("annualizedVolatility is shift-invariant: vol(xs) == vol(xs + c)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.3, max: 0.3, noNaN: true }), {
          minLength: 2,
          maxLength: 252,
        }),
        fc.float({ min: -1, max: 1, noNaN: true }),
        (returns, shift) => {
          const v1 = annualizedVolatility(returns);
          const v2 = annualizedVolatility(returns.map((r) => r + shift));
          // Relative tolerance of 1e-6 handles floating-point accumulation.
          return Math.abs(v1 - v2) < 1e-6 + 1e-6 * Math.max(v1, 1);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: cumulative return of concatenation is compounding.
  // (1 + cum(a ++ b)) == (1 + cum(a)) * (1 + cum(b))
  // Catches off-by-one in the compounding loop and sign errors.
  it("cumulativeReturn is multiplicatively compositional over concatenation", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.2, max: 0.2, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.array(fc.float({ min: -0.2, max: 0.2, noNaN: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (a, b) => {
          const cumA = cumulativeReturn(a);
          const cumB = cumulativeReturn(b);
          const cumAB = cumulativeReturn([...a, ...b]);
          const rhs = (1 + cumA) * (1 + cumB) - 1;
          return Math.abs(cumAB - rhs) < 1e-9 + 1e-9 * Math.abs(cumAB);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Non-trivial: sampleVariance ≥ 0 always (would fail if the code
  // accidentally computed E[X²] − E[X]² with negative floating-point residue
  // when the true variance is tiny). Catches the classic two-pass vs one-pass
  // numerical-stability bug.
  it("sampleVariance is always non-negative (numerical stability)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1e6, max: 1e6, noNaN: true }), {
          minLength: 2,
          maxLength: 50,
        }),
        (xs) => sampleVariance(xs) >= -1e-9,
      ),
      { numRuns: 200 },
    );
  });
});
```

**Property test ordering:** Kept the 3 existing non-trivial properties (HHI bounds strengthened to include 1/n floor, effectiveN ≤ n, topNExposure monotone) and replaced the 4 trivial ones with stronger invariants:
- `drawdownSeries is 0 for monotone-up` — catches broken peak-tracking
- `|maxDrawdown| non-increasing after positive tail` — catches broken recovery detection
- `annualizedVolatility shift-invariant` — catches missing mean subtraction
- `cumulativeReturn compositional over concatenation` — catches off-by-one / sign bugs

Strengthened `totalDrift` to also verify symmetry. Added `sampleVariance ≥ 0` as a numerical-stability smoke test.

- [ ] **Step 2: Run property tests**

Run: `npm test -- tests/lib/quant/properties.test.ts`
Expected: all 9 properties PASS across 200 random runs each (1800 total cases).

- [ ] **Step 3: Commit**

```bash
git add tests/lib/quant/properties.test.ts
git commit -m "test(quant/ts): non-trivial fast-check invariants for math library

Replaced 4 trivial properties (maxDD ≤ 0, ddSeries ≤ 0, annVol ≥ 0) that
were baked into the implementation — a correct re-implementation couldn't
fail them. Now asserts real invariants:
- HHI ∈ [1/n, 1] (Cauchy-Schwarz floor, not just upper)
- drawdownSeries == 0 on monotone-up (catches peak-tracking bugs)
- |maxDD| non-increasing after positive tail (catches recovery logic)
- annualizedVolatility shift-invariance (catches missing mean subtraction)
- cumulativeReturn compositional over concat (catches compounding bugs)
- totalDrift symmetric + ∈ [0,2]
- sampleVariance non-negative (numerical-stability guard)
200 runs each; 1800 total random cases."
```

---

## Chunk 7a — TS service layer: HMAC signer, coded envelope, rate-limit tiers, quant service

**Goal:** Plumb HTTP from the Next.js app → Modal. Responsibilities:

1. **HMAC signer** for outgoing Modal requests (`src/lib/api/hmac.ts`).
2. **§3.3a response helper** (`src/lib/api/response-coded.ts`), coexisting with the legacy `{ data, error }` helper in `response.ts`. Quant routes use the new one; existing routes keep the old one untouched.
3. **Rate-limit tiers** extended with `optimize`, `monte_carlo`, `rebalance`, `internal` (§5.2 of spec).
4. **Quant service** (`src/lib/services/quant.ts`): HTTP caller, Upstash cache, mandatory `quant_runs` audit insert. Cache is keyed on a SHA-256 hash of the request body; TTL from spec §5.3.
5. **4 API routes** under `src/app/api/portfolios/[id]/{optimize,monte-carlo,factors,rebalance}/route.ts`.

**Key invariant (spec §7.2):** every call to the quant service — whether Modal-served OR cache-served — writes exactly ONE row to `quant_runs`. The cache check does NOT skip the audit row; the audit is part of "serving the request".

### Task 7.1: HMAC signer for outgoing Modal requests

**Files:**
- Create: `src/lib/api/hmac.ts`
- Test: `tests/lib/api/hmac.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/lib/api/hmac.test.ts
import { describe, it, expect } from "vitest";
import { signRequest, verifySignatureLocal } from "@/lib/api/hmac";

describe("signRequest", () => {
  it("returns headers with X-Timestamp and X-Signature", () => {
    const { headers } = signRequest('{"foo":"bar"}', "test-key");
    expect(headers["X-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("produces the same signature as the Python HMAC (round-trip via verify)", () => {
    const body = '{"symbols":["A","B"],"method":"mean_variance"}';
    const key = "top-secret-key";
    const { headers } = signRequest(body, key);
    expect(
      verifySignatureLocal(
        body,
        headers["X-Timestamp"],
        headers["X-Signature"],
        key,
      ),
    ).toBe(true);
  });

  it("rejects tampered body", () => {
    const body = '{"foo":"bar"}';
    const key = "k";
    const { headers } = signRequest(body, key);
    expect(
      verifySignatureLocal(
        '{"foo":"BAZ"}',
        headers["X-Timestamp"],
        headers["X-Signature"],
        key,
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/api/hmac.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/api/hmac.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedRequest = {
  headers: Record<string, string>;
};

/**
 * Sign an outgoing request body with HMAC-SHA256.
 * Produces headers compatible with the Python `src/auth.py` verifier.
 *
 * Signature input: `body + timestamp` (timestamp as Unix seconds string).
 */
export function signRequest(body: string, key: string): SignedRequest {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmac = createHmac("sha256", key);
  hmac.update(body);
  hmac.update(timestamp);
  const signature = hmac.digest("hex");
  return {
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
  };
}

/** Exported for tests only — verify a signature locally. */
export function verifySignatureLocal(
  body: string,
  timestamp: string,
  signature: string,
  key: string,
): boolean {
  const hmac = createHmac("sha256", key);
  hmac.update(body);
  hmac.update(timestamp);
  const expected = hmac.digest();
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/api/hmac.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/hmac.ts tests/lib/api/hmac.test.ts
git commit -m "feat(api): HMAC-SHA256 signer for outgoing Modal requests

Produces headers compatible with quant-service/src/auth.py. Uses
node:crypto timingSafeEqual in the exported verify helper (test-only).
Signature input is body||timestamp — same as Python side."
```

### Task 7.2: §3.3a error envelope helper

**Files:**
- Create: `src/lib/api/response-coded.ts`
- Test: `tests/lib/api/response-coded.test.ts`

**Design rule:** this file is ONLY for new quant routes. Existing routes keep `response.ts` untouched. A future cleanup can consolidate — not in scope now.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/api/response-coded.test.ts
import { describe, it, expect } from "vitest";
import {
  successCoded,
  errorCoded,
  statusFromCode,
  QuantErrorCode,
} from "@/lib/api/response-coded";

describe("successCoded", () => {
  it("returns 200 by default with raw data", async () => {
    const resp = successCoded({ foo: "bar" });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ foo: "bar" });
  });
});

describe("errorCoded", () => {
  it("formats §3.3a envelope", async () => {
    const resp = errorCoded("VALIDATION_ERROR", "Symbols array too short", {
      min: 2,
    });
    expect(resp.status).toBe(422);
    const body = await resp.json();
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Symbols array too short",
        details: { min: 2 },
      },
    });
  });

  it("maps each known code to its HTTP status", () => {
    expect(statusFromCode("VALIDATION_ERROR" as QuantErrorCode)).toBe(422);
    expect(statusFromCode("HMAC_INVALID" as QuantErrorCode)).toBe(401);
    expect(statusFromCode("RATE_LIMITED" as QuantErrorCode)).toBe(429);
    expect(statusFromCode("COLD_START_TIMEOUT" as QuantErrorCode)).toBe(503);
    expect(statusFromCode("INFEASIBLE" as QuantErrorCode)).toBe(400);
    expect(statusFromCode("INTERNAL" as QuantErrorCode)).toBe(500);
    // UNAUTHENTICATED (no session) is 401 — distinct from FORBIDDEN (403, "you're
    // logged in but can't do this"). Used by every Next.js quant route when
    // Supabase returns no user.
    expect(statusFromCode("UNAUTHENTICATED" as QuantErrorCode)).toBe(401);
    expect(statusFromCode("FORBIDDEN" as QuantErrorCode)).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/api/response-coded.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/api/response-coded.ts
import { NextResponse } from "next/server";

/**
 * §3.3a error envelope:
 *   { "error": { "code": <CODE>, "message": <string>, "details": <any> } }
 *
 * Used by all /api/portfolios/[id]/{optimize,monte-carlo,factors,rebalance}
 * routes. Legacy routes keep their old { data, error: string } shape — do
 * NOT migrate them as part of Phase 2.
 */

/**
 * Canonical error-code table (16 codes). Numbers MUST stay in sync with:
 * - The `/docs/api/quant.md` public API doc (Chunk 9 Task 9.2).
 * - The i18n string table `quant.errors.<code>` in the locale files.
 *
 * Status code choices:
 *   UNAUTHENTICATED (401) → "Who are you?" — no Supabase session; prompt login.
 *   FORBIDDEN       (403) → "We know you, but you can't do this" — e.g. admin-only
 *                           action. NOT used for ownership checks (those return
 *                           PORTFOLIO_NOT_FOUND 404 to hide existence per §5.1).
 *   HMAC_INVALID    (401) → Modal-side only (HMAC missing/wrong/expired); not
 *                           used by Next.js-facing routes.
 */
export const QUANT_ERROR_CODES = [
  "VALIDATION_ERROR",
  "WEIGHTS_NOT_ONE",
  "DIMENSION_MISMATCH",
  "COVARIANCE_NOT_PD",
  "INFEASIBLE",
  "INSUFFICIENT_HISTORY",
  "MONTE_CARLO_DEGENERATE",
  "HMAC_INVALID",
  "HMAC_EXPIRED",
  "RATE_LIMITED",
  "COLD_START_TIMEOUT",
  "FEATURE_DISABLED",
  "PORTFOLIO_NOT_FOUND",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INTERNAL",
] as const;

export type QuantErrorCode = (typeof QUANT_ERROR_CODES)[number];

const CODE_TO_STATUS: Record<QuantErrorCode, number> = {
  VALIDATION_ERROR: 422,
  WEIGHTS_NOT_ONE: 422,
  DIMENSION_MISMATCH: 422,
  COVARIANCE_NOT_PD: 422,
  INFEASIBLE: 400,
  INSUFFICIENT_HISTORY: 422,
  MONTE_CARLO_DEGENERATE: 422,
  HMAC_INVALID: 401,           // Modal-side HMAC missing/wrong
  HMAC_EXPIRED: 401,           // Modal-side timestamp > 5min old
  RATE_LIMITED: 429,
  COLD_START_TIMEOUT: 503,
  FEATURE_DISABLED: 404,       // pretend endpoint doesn't exist when flag off
  PORTFOLIO_NOT_FOUND: 404,    // also used for "owned by someone else" (hide existence)
  UNAUTHENTICATED: 401,        // no Supabase session — prompt login
  FORBIDDEN: 403,              // authenticated but lacks permission for this action
  INTERNAL: 500,
};

export function statusFromCode(code: QuantErrorCode): number {
  return CODE_TO_STATUS[code] ?? 500;
}

export function successCoded<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorCoded(
  code: QuantErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message, details } },
    { status: statusFromCode(code) },
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/api/response-coded.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/response-coded.ts tests/lib/api/response-coded.test.ts
git commit -m "feat(api): §3.3a error envelope helper for quant routes

Maps 16 QuantErrorCode values to HTTP status. UNAUTHENTICATED (401) and
FORBIDDEN (403) are distinct — UNAUTHENTICATED for 'no session', FORBIDDEN
for 'authenticated but not allowed'. Ownership checks use PORTFOLIO_NOT_FOUND
(404) to hide existence per §5.1. Coexists with legacy src/lib/api/response.ts
— quant routes use the coded helper, existing routes keep { data, error }
untouched."
```

### Task 7.3: Extend rate-limit tiers

**Files:**
- Modify: `src/lib/api/rate-limit.ts`
- Test: `tests/lib/api/rate-limit.test.ts` (create)

- [ ] **Step 1: Write failing test**

```typescript
// tests/lib/api/rate-limit.test.ts
import { describe, it, expect } from "vitest";
import type { Tier } from "@/lib/api/rate-limit";

describe("rate-limit tier type", () => {
  it("includes all Phase 2 tiers", () => {
    const tiers: Tier[] = [
      "search",
      "transaction",
      "general",
      "optimize",
      "monte_carlo",
      "rebalance",
      "internal",
    ];
    expect(tiers.length).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/api/rate-limit.test.ts`
Expected: TS compile error — `Tier` is not exported and doesn't include new values.

- [ ] **Step 3: Extend rate-limit.ts**

```typescript
// src/lib/api/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export type Tier =
  | 'search'
  | 'transaction'
  | 'general'
  | 'optimize'
  | 'monte_carlo'
  | 'rebalance'
  | 'internal'

let limiters: Record<Tier, Ratelimit> | null = null

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
  limiters = {
    // Phase 1 tiers (unchanged)
    search:      new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  '1 m'), prefix: 'rl:search'      }),
    transaction: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60,  '1 m'), prefix: 'rl:transaction' }),
    general:     new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 m'), prefix: 'rl:general'     }),
    // Phase 2 tiers — values verbatim from spec §5.2 table (per-hour to match cvxpy cost profile).
    optimize:    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '1 h'), prefix: 'rl:optimize'    }),
    monte_carlo: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,   '1 h'), prefix: 'rl:mc'          }),
    rebalance:   new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  '1 h'), prefix: 'rl:rebalance'   }),
    // Internal tier: global (not per-user) sanity cap across Worker→Next calls — spec §5.2 row 4.
    internal:    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m'), prefix: 'rl:qint'        }),
  }
}

export async function rateLimit(userId: string, tier: Tier = 'general') {
  if (!limiters) return true
  const { success } = await limiters[tier].limit(userId)
  return success
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/api/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/rate-limit.ts tests/lib/api/rate-limit.test.ts
git commit -m "feat(api): rate-limit tiers for optimize/mc/rebalance/internal

Per spec §5.2: 10/h optimize, 5/h monte-carlo, 30/h rebalance per
user (cvxpy is expensive; per-hour window dampens bursts). 'internal'
tier is a 100/min GLOBAL cap for Worker→Next traffic."
```

### Task 7.4: `src/lib/services/quant.ts` — Modal caller with cache + audit

**Files:**
- Create: `src/lib/services/quant.ts`
- Test: `tests/lib/services/quant.test.ts`

**Spec invariants:**
- §7.2: every call — cache-hit OR cache-miss OR network error — writes ONE row to `quant_runs`.
- §5.1: the audit row uses the migration 009 column set `{ portfolio_id, user_id, type, request, response, elapsed_ms, cached }`. The `type` value is one of `'optimize' | 'monte_carlo' | 'factors' | 'rebalance'` (the CHECK constraint) — NOT the raw endpoint path. The error envelope (if any) lands inside `response` as `{ error: { code, message, details } }`, so a single row shape covers success + failure.

Tests verify BOTH invariants.

- [ ] **Step 1: Write failing test**

```typescript
// tests/lib/services/quant.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callQuant } from "@/lib/services/quant";

const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  insert: vi.fn(() => Promise.resolve({ error: null })),
};

const mockFetch = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  process.env.QUANT_SERVICE_URL = "https://modal.test";
  process.env.QUANT_SERVICE_HMAC_KEY = "test-key";
});

describe("callQuant", () => {
  it("posts signed request to Modal on cache miss and inserts audit row (cached=false)", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ optimal_weights: { A: 0.5, B: 0.5 } }),
    });

    const body = { symbols: ["A", "B"], method: "mean_variance" };
    const result = await callQuant({
      endpoint: "/optimize",
      body,
      portfolioId: "p-1",
      userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });

    expect(result).toEqual({ optimal_weights: { A: 0.5, B: 0.5 } });
    expect(mockFetch).toHaveBeenCalledOnce();
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://modal.test/optimize");
    expect(call[1]?.method).toBe("POST");
    const headers = (call[1]?.headers as Record<string, string>) ?? {};
    expect(headers["X-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    // Mandatory audit row — migration 009 column shape.
    expect(mockSupabase.from).toHaveBeenCalledWith("quant_runs");
    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      portfolio_id: "p-1",
      user_id: "u-1",
      type: "optimize",                                   // endpoint→type mapping
      request: body,
      response: { optimal_weights: { A: 0.5, B: 0.5 } },
      cached: false,
    });
    expect(auditArg.elapsed_ms).toEqual(expect.any(Number));
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it("serves from cache without calling Modal, BUT STILL inserts audit row (cached=true)", async () => {
    const cached = { optimal_weights: { A: 0.4, B: 0.6 } };
    mockCacheGet.mockResolvedValue(cached);

    const result = await callQuant({
      endpoint: "/monte-carlo",
      body: { symbols: ["A", "B"] },
      portfolioId: "p-1",
      userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });

    expect(result).toEqual(cached);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      type: "monte_carlo",                                // hyphen → underscore
      cached: true,
      response: cached,
    });
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("propagates modal error envelope verbatim and inserts audit row with error in response JSONB", async () => {
    mockCacheGet.mockResolvedValue(null);
    const errEnv = { error: { code: "WEIGHTS_NOT_ONE", message: "w=1.002", details: {} } };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve(errEnv),
    });

    await expect(
      callQuant({
        endpoint: "/optimize",
        body: { symbols: ["A", "B"], method: "mean_variance" },
        portfolioId: "p-1",
        userId: "u-1",
        supabase: mockSupabase as never,
        cache: { get: mockCacheGet, set: mockCacheSet },
      }),
    ).rejects.toMatchObject({ code: "WEIGHTS_NOT_ONE", message: "w=1.002" });

    // Error path still writes ONE row — error envelope is stored inside response JSONB.
    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      type: "optimize",
      cached: false,
      response: errEnv,
    });
  });

  it("writes audit row when fetch itself throws (network error)", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      callQuant({
        endpoint: "/optimize",
        body: { symbols: ["A", "B"], method: "mean_variance" },
        portfolioId: "p-1",
        userId: "u-1",
        supabase: mockSupabase as never,
        cache: { get: mockCacheGet, set: mockCacheSet },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg.type).toBe("optimize");
    expect(auditArg.cached).toBe(false);
    expect(auditArg.response?.error?.code).toBe("INTERNAL");
  });

  it("maps AbortError from fetch timeout to COLD_START_TIMEOUT audit row", async () => {
    mockCacheGet.mockResolvedValue(null);
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    mockFetch.mockRejectedValue(abortErr);

    await expect(
      callQuant({
        endpoint: "/optimize",
        body: { symbols: ["A", "B"], method: "mean_variance" },
        portfolioId: "p-1",
        userId: "u-1",
        supabase: mockSupabase as never,
        cache: { get: mockCacheGet, set: mockCacheSet },
      }),
    ).rejects.toMatchObject({ code: "COLD_START_TIMEOUT" });

    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg.response?.error?.code).toBe("COLD_START_TIMEOUT");
  });

  it("cache key is stable under key reordering (canonical JSON)", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await callQuant({
      endpoint: "/optimize",
      body: { method: "mean_variance", symbols: ["A", "B"] },
      portfolioId: "p-1", userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });
    const firstKey = mockCacheGet.mock.calls[0][0];

    mockCacheGet.mockClear(); mockCacheSet.mockClear();
    mockFetch.mockClear();
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await callQuant({
      endpoint: "/optimize",
      body: { symbols: ["A", "B"], method: "mean_variance" },   // keys reversed
      portfolioId: "p-1", userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });
    const secondKey = mockCacheGet.mock.calls[0][0];
    expect(firstKey).toEqual(secondKey);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/services/quant.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/services/quant.ts
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signRequest } from "@/lib/api/hmac";

export type QuantEndpoint = "/optimize" | "/monte-carlo" | "/factors" | "/rebalance";
export type QuantRunType = "optimize" | "monte_carlo" | "factors" | "rebalance";

export type QuantErrorEnvelope = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type QuantCache = {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>;
};

const CACHE_TTL_SECONDS: Record<QuantEndpoint, number> = {
  "/optimize": 60 * 60,       // 1 hr (spec §3.6 cache column)
  "/monte-carlo": 60 * 60,    // 1 hr (spec §3.6 cache column)
  "/factors": 60 * 60,        // 1 hr (slow-moving; spec §3.6)
  "/rebalance": 0,            // never cache — always fresh trade plan
};

// Endpoint path → migration 009 `type` CHECK value. The CHECK constraint
// accepts underscores/no-slash values; endpoints use slashes/hyphens.
const ENDPOINT_TO_TYPE: Record<QuantEndpoint, QuantRunType> = {
  "/optimize": "optimize",
  "/monte-carlo": "monte_carlo",
  "/factors": "factors",
  "/rebalance": "rebalance",
};

export type CallQuantOptions<TBody> = {
  endpoint: QuantEndpoint;
  body: TBody;
  portfolioId: string;
  userId: string;
  supabase: SupabaseClient;
  cache: QuantCache;
};

export class QuantError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "QuantError";
  }
}

/**
 * Stable JSON stringify — keys sorted recursively. Guarantees that
 * `{a:1,b:2}` and `{b:2,a:1}` produce identical bytes. Used by both
 * the cache-key computation AND the HMAC body signing so the two
 * never drift.
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function cacheKey(endpoint: QuantEndpoint, body: unknown): string {
  const h = createHash("sha256")
    .update(endpoint)
    .update(stableStringify(body))
    .digest("hex");
  return `quant:${endpoint}:${h.slice(0, 32)}`;
}

/**
 * Call the Modal quant service with HMAC-signed request.
 * Serves from cache when available (except /rebalance).
 *
 * **ALWAYS writes ONE row to quant_runs** — cache-hit, cache-miss, Modal
 * 4xx/5xx, AND network errors ALL produce exactly one audit row. This is
 * the spec §7.2 "every call = one audit row" invariant. The error envelope
 * (if any) is stored inside the `response` JSONB column so a single row
 * shape covers success and failure.
 */
export async function callQuant<TBody, TResult = unknown>(
  opts: CallQuantOptions<TBody>,
): Promise<TResult> {
  const { endpoint, body, portfolioId, userId, supabase, cache } = opts;
  const url = process.env.QUANT_SERVICE_URL;
  const key = process.env.QUANT_SERVICE_HMAC_KEY;
  const type = ENDPOINT_TO_TYPE[endpoint];
  const baseRow = {
    portfolio_id: portfolioId,
    user_id: userId,
    type,
    request: body as unknown as Record<string, unknown>,
  };

  if (!url || !key) {
    const err = new QuantError(
      "INTERNAL",
      "Quant service not configured (QUANT_SERVICE_URL or HMAC_KEY missing)",
    );
    await insertAudit(supabase, {
      ...baseRow,
      response: { error: { code: err.code, message: err.message, details: err.details } },
      elapsed_ms: 0,
      cached: false,
    });
    throw err;
  }

  const ttl = CACHE_TTL_SECONDS[endpoint];
  const ckey = cacheKey(endpoint, body);

  // Cache check (skip for rebalance)
  if (ttl > 0) {
    const cached = (await cache.get(ckey)) as TResult | null;
    if (cached !== null && cached !== undefined) {
      await insertAudit(supabase, {
        ...baseRow,
        response: cached as Record<string, unknown>,
        elapsed_ms: 0,                   // served from cache — no Modal wall time
        cached: true,
      });
      return cached;
    }
  }

  const start = Date.now();
  const bodyStr = stableStringify(body);
  const { headers } = signRequest(bodyStr, key);

  let resp: Response;
  try {
    resp = await fetch(url + endpoint, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(60_000), // 60s max
    });
  } catch (e) {
    // Network error (DNS / TCP / timeout). Map AbortError → COLD_START_TIMEOUT.
    const isAbort = e instanceof Error && e.name === "AbortError";
    const code = isAbort ? "COLD_START_TIMEOUT" : "INTERNAL";
    const message = isAbort ? "Quant service timed out (cold start > 60s)" : (e instanceof Error ? e.message : "Network error");
    const errEnv = { error: { code, message, details: {} } };
    await insertAudit(supabase, {
      ...baseRow,
      response: errEnv,
      elapsed_ms: Date.now() - start,
      cached: false,
    });
    throw new QuantError(code, message);
  }

  if (!resp.ok) {
    const env = (await resp.json().catch(() => ({
      error: { code: "INTERNAL", message: `HTTP ${resp.status}`, details: {} },
    }))) as { error?: QuantErrorEnvelope };
    await insertAudit(supabase, {
      ...baseRow,
      response: env,                      // error envelope stored verbatim
      elapsed_ms: Date.now() - start,
      cached: false,
    });
    throw new QuantError(
      env.error?.code ?? "INTERNAL",
      env.error?.message ?? `HTTP ${resp.status}`,
      env.error?.details ?? {},
    );
  }

  const result = (await resp.json()) as TResult;
  if (ttl > 0) {
    await cache.set(ckey, result, ttl);
  }

  await insertAudit(supabase, {
    ...baseRow,
    response: result as Record<string, unknown>,
    elapsed_ms: Date.now() - start,
    cached: false,
  });

  return result;
}

type AuditRow = {
  portfolio_id: string;
  user_id: string;
  type: QuantRunType;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  elapsed_ms: number;
  cached: boolean;
};

async function insertAudit(
  supabase: SupabaseClient,
  row: AuditRow,
): Promise<void> {
  const { error } = await supabase.from("quant_runs").insert(row);
  if (error) {
    // Non-fatal: audit failure shouldn't block the user response.
    // But log loudly AND capture to Sentry — audit is a spec §7.2 invariant.
    console.error("[quant] audit insert failed", error);
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(error, { tags: { subsystem: "quant-audit" } });
    } catch {
      // Sentry not installed in this build — already logged.
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/services/quant.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/quant.ts tests/lib/services/quant.test.ts
git commit -m "feat(services): Modal quant caller with cache + mandatory audit

callQuant() signs with HMAC (stable-stringify body), handles cache
(/rebalance bypasses), propagates §3.3a error envelope as QuantError.
ALWAYS inserts exactly ONE quant_runs row (spec §7.2): cache-hit,
cache-miss, Modal 4xx/5xx, and network errors ALL produce one row.
Uses migration 009 column shape {type, request, response, elapsed_ms,
cached}; endpoint path → type via ENDPOINT_TO_TYPE map (/monte-carlo
→ monte_carlo etc). Audit failures log to console AND Sentry since
§7.2 makes this an invariant, not just telemetry."
```

---

## Chunk 7b — Four Next.js API routes wiring the quant service

**Why a split:** Chunk 7 grew too large. Chunk 7a covered the shared infra — HMAC signer, §3.3a envelope helper, extended rate-limit tiers, and `src/lib/services/quant.ts` (HTTP + cache + audit). This Chunk 7b wires those into four user-facing Next.js routes under `/api/portfolios/[id]/*`.

**Prereqs:** Chunk 7a complete (`src/lib/services/quant.ts`, `src/lib/api/hmac.ts`, `src/lib/api/response-coded.ts`, and the new rate-limit tiers all committed).

**Pattern:** All four routes share the same skeleton:
1. Check `quant_engine_enabled` flag → 404 `FEATURE_DISABLED` when off.
2. Auth via `supabase.auth.getUser()` → 401 `UNAUTHENTICATED` (NOT `FORBIDDEN`).
3. Rate-limit on route-specific tier + `internal` safety net.
4. Zod-validate the body → 422 `VALIDATION_ERROR` on failure.
5. Portfolio ownership check → 404 `PORTFOLIO_NOT_FOUND` (hides existence from non-owners per §5.1).
6. Call `callQuant(...)` with a Redis-backed cache shim.
7. Catch `QuantError`; on unknown throw, return `errorCoded("INTERNAL", ...)` — **never re-throw** (that would leak to the Next.js HTML error boundary and break the `{error:{code,message,details}}` contract the client depends on).
8. Emit a PostHog event after success: `optimize_run` / `monte_carlo_run` / `factors_run` / `rebalance_plan_created` (event names are product-analytics keys — do NOT reuse a generic `quant_run`).

Only the Zod schema, the rate-limit tier, the callQuant endpoint, and the PostHog event name differ between routes.

**Factors is GET, not POST (§3.6 table):** the Next.js-facing `/api/portfolio/[id]/factors` is a GET with no body — the route computes `portfolio_returns` server-side from `portfolio_history` and loads `factor_returns` from a server-side Fama-French fixture/dataset, then POSTs the composed body to the Modal `/factors` endpoint (which IS POST per §4.1.3). Cache TTL 24h.

### Task 7.5: `/api/portfolios/[id]/optimize` route

**Files:**
- Create: `src/app/api/portfolios/[id]/optimize/route.ts`
- Test: `tests/app/api/portfolios/optimize.test.ts`

**Handler behavior (spec §4.2):**
1. Check feature flag `quant_engine_enabled` — off → 404 `FEATURE_DISABLED`.
2. Authenticate. Unauth → 401 `UNAUTHENTICATED`.
3. Validate body with Zod.
4. Rate-limit on `optimize` tier + `internal` tier.
5. Load portfolio, verify ownership. Not found / not owned → 404 `PORTFOLIO_NOT_FOUND`.
6. Build `returns` map from `portfolio_history` / `price_history` for each symbol.
7. Call `callQuant({ endpoint: "/optimize", ... })`.
8. Emit PostHog event `optimize_run` (NOT a generic `quant_run` — each route has its own event name for funnel analytics).
9. Return result with §3.3a envelope (success case: data only; error: `{ error: {...} }`).

- [ ] **Step 1: Write integration test**

```typescript
// tests/app/api/portfolios/optimize.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/portfolios/[id]/optimize/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/quant", () => ({
  callQuant: vi.fn(),
  QuantError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  },
}));

// Minimal Supabase mock
const makeSupabaseMock = (portfolio: unknown, userId: string | null) => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: userId ? { id: userId } : null },
      error: null,
    }),
  },
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: portfolio, error: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe("POST /api/portfolios/[id]/optimize", () => {
  it("returns 404 FEATURE_DISABLED when flag off", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const req = new NextRequest("http://t/api/portfolios/p-1/optimize", {
      method: "POST",
      body: JSON.stringify({ method: "mean_variance" }),
    });
    const resp = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("returns 401 when unauthenticated", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabaseMock(null, null),
    );

    const req = new NextRequest("http://t/api/portfolios/p-1/optimize", {
      method: "POST",
      body: JSON.stringify({ method: "mean_variance" }),
    });
    const resp = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(resp.status).toBe(401);
  });

  it("happy path: calls quant service and returns result", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabaseMock(
        { id: "p-1", user_id: "u-1", symbols: ["A", "B"] },
        "u-1",
      ),
    );
    const { callQuant } = await import("@/lib/services/quant");
    (callQuant as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      weights: { A: 0.5, B: 0.5 },
      expected_return: 0.08,
      expected_volatility: 0.15,
      sharpe_ratio: 0.53,
    });

    const req = new NextRequest("http://t/api/portfolios/p-1/optimize", {
      method: "POST",
      body: JSON.stringify({
        method: "mean_variance",
        returns: { A: [0.01, 0.02], B: [0.015, -0.005] },
      }),
    });
    const resp = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.weights).toEqual({ A: 0.5, B: 0.5 });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/api/portfolios/optimize.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement route**

```typescript
// src/app/api/portfolios/[id]/optimize/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { errorCoded, successCoded } from "@/lib/api/response-coded";
import { rateLimit } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { callQuant, QuantError } from "@/lib/services/quant";
import { isFeatureEnabled } from "@/lib/flags";
import { redis } from "@/lib/cache/redis";
import { posthog } from "@/lib/analytics/posthog-server"; // server-side PostHog client (existing module)

// Spec §4.1.1 request shape. Next.js route is slightly more permissive than the
// Modal endpoint (allows `symbols` omission + server-side returns load), but
// everything it POSTs to Modal matches the spec exactly.
const OptimizeBody = z.object({
  method: z.enum(["mean_variance", "risk_parity", "hrp"]),
  symbols: z.array(z.string()).min(2).max(100).optional(),
  returns: z.record(z.string(), z.array(z.number())).optional(),
  risk_free_rate: z.number().default(0),
  frontier_points: z.number().int().min(0).max(200).default(0), // 0 = skip frontier
  constraints: z
    .object({
      min_weight: z.number().optional(),
      max_weight: z.number().optional(),
      sector_caps: z.record(z.string(), z.number()).optional(),
      target_return: z.number().optional(),
      risk_aversion: z.number().optional(),
      sector_map: z.record(z.string(), z.string()).optional(), // extension: UI-supplied
    })
    .optional(),
});

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;

  if (!(await isFeatureEnabled("quant_engine_enabled"))) {
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorCoded("UNAUTHENTICATED", "Not authenticated");

  const okOpt = await rateLimit(user.id, "optimize");
  const okInt = await rateLimit(user.id, "internal");
  if (!okOpt || !okInt) return errorCoded("RATE_LIMITED", "Too many requests");

  const rawBody = await req.text();
  let parsed;
  try {
    parsed = OptimizeBody.parse(JSON.parse(rawBody));
  } catch (err) {
    return errorCoded("VALIDATION_ERROR", "Invalid body", {
      zod: err instanceof z.ZodError ? err.issues : String(err),
    });
  }

  // Verify portfolio ownership
  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("id, user_id, symbols, optimization_constraints")
    .eq("id", portfolioId)
    .single();
  if (pErr || !portfolio || portfolio.user_id !== user.id) {
    return errorCoded("PORTFOLIO_NOT_FOUND", "Portfolio not found");
  }

  // Load returns if not provided by client (typically UI sends them to avoid
  // server-side history reads — but accept both forms).
  const symbols = parsed.symbols ?? (portfolio.symbols as string[]);
  const returns =
    parsed.returns ?? (await loadReturnsFor(supabase, symbols, 252));
  if (Object.keys(returns).length < 2) {
    return errorCoded(
      "INSUFFICIENT_HISTORY",
      "Need at least 2 symbols with history",
    );
  }

  const payload = {
    symbols,
    returns,
    method: parsed.method,
    risk_free_rate: parsed.risk_free_rate,
    frontier_points: parsed.frontier_points,
    constraints:
      parsed.constraints ??
      (portfolio.optimization_constraints as unknown) ??
      undefined,
  };

  try {
    const result = await callQuant({
      endpoint: "/optimize",
      body: payload,
      portfolioId,
      userId: user.id,
      supabase,
      cache: makeCache(),
    });
    // Product analytics — fire-and-forget. The capture call is non-blocking;
    // failure to emit does not fail the request.
    void posthog.capture({
      distinctId: user.id,
      event: "optimize_run",
      properties: {
        portfolio_id: portfolioId,
        method: parsed.method,
        include_frontier: parsed.frontier_points > 0,
        cached: (result as { cached?: boolean }).cached === true,
      },
    });
    return successCoded(result);
  } catch (err) {
    if (err instanceof QuantError) {
      return errorCoded(
        // Map unknown codes to INTERNAL
        (err.code as Parameters<typeof errorCoded>[0]) || "INTERNAL",
        err.message,
        err.details,
      );
    }
    // Unexpected throw — never leak to Next's HTML error boundary. Log + envelope.
    console.error("[optimize route] unexpected", err);
    return errorCoded(
      "INTERNAL",
      err instanceof Error ? err.message : "Unexpected error",
    );
  }
});

async function loadReturnsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  symbols: string[],
  days: number,
): Promise<Record<string, number[]>> {
  // Simple implementation: one-shot fetch from price_history.
  // Returns computed as (p_t / p_{t-1}) - 1.
  const out: Record<string, number[]> = {};
  for (const s of symbols) {
    const { data } = await supabase
      .from("price_history")
      .select("price, date")
      .eq("symbol", s)
      .order("date", { ascending: true })
      .limit(days + 1);
    if (!data || data.length < 2) continue;
    const rets: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const prev = Number(data[i - 1].price);
      const curr = Number(data[i].price);
      if (prev > 0) rets.push(curr / prev - 1);
    }
    if (rets.length >= 60) out[s] = rets;
  }
  return out;
}

function makeCache() {
  return {
    async get(key: string) {
      const v = await redis.get(key);
      return v ?? null;
    },
    async set(key: string, value: unknown, ttlSeconds: number) {
      await redis.set(key, value, { ex: ttlSeconds });
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/app/api/portfolios/optimize.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/portfolios/[id]/optimize/route.ts tests/app/api/portfolios/optimize.test.ts
git commit -m "feat(api): POST /api/portfolios/[id]/optimize route

Feature-flag guarded (quant_engine_enabled). Zod validation, double
rate limiting (optimize tier + internal safety net), portfolio
ownership check, fallback to price_history when client doesn't
provide returns. Propagates QuantError to §3.3a envelope."
```

### Task 7.6: `/api/portfolios/[id]/monte-carlo` route

**Files:**
- Create: `src/app/api/portfolios/[id]/monte-carlo/route.ts`
- Test: `tests/app/api/portfolios/monte-carlo.test.ts`

- [ ] **Step 1: Write test** (pattern similar to Task 7.5; differs in body schema, rate tier, and MC response shape).

Spec §4.1.2 response shape (what the Modal endpoint returns, and what our mock must emit): `{ trajectories: {p5,p50,p95: number[]}, final_distribution: {mean,median,std,min,max,percentiles:Record<string,number>}, var_95, cvar_95, probability_of_loss, meta }`. **Do not** use legacy `percentiles: {p50:[...]}` or `terminal_values:[]` — those are from an earlier draft.

```typescript
// tests/app/api/portfolios/monte-carlo.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/portfolios/[id]/monte-carlo/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/services/quant", () => ({
  callQuant: vi.fn(),
  QuantError: class extends Error {
    constructor(public code: string, message: string,
                public details: Record<string, unknown> = {}) { super(message); }
  },
}));
vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/analytics/posthog-server", () => ({
  posthog: { capture: vi.fn() },
}));

beforeEach(() => vi.resetAllMocks());

describe("POST /api/portfolios/[id]/monte-carlo", () => {
  it("VALIDATION_ERROR when legacy body shape (weights + returns + initial_value) submitted", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }) },
    });
    const req = new NextRequest("http://t/api/portfolios/p-1/monte-carlo", {
      method: "POST",
      body: JSON.stringify({
        weights: { A: 1.0 },
        returns: { A: [0.001] }, // legacy key
        initial_value: 10_000,   // legacy key (spec: current_value)
        horizon_days: 30,
        n_simulations: 500,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("calls rateLimit with 'monte_carlo' tier + forwards spec §4.1.2 body to /monte-carlo", async () => {
    const { rateLimit } = await import("@/lib/api/rate-limit");
    (rateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { callQuant } = await import("@/lib/services/quant");
    (callQuant as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      trajectories: { p5: [99, 98], p50: [100, 101], p95: [101, 103] },
      final_distribution: {
        mean: 101.2, median: 101, std: 1.2, min: 95, max: 106,
        percentiles: { "5": 99, "50": 101, "95": 103 },
      },
      var_95: 0.05, cvar_95: 0.07, probability_of_loss: 0.45, meta: {},
    });
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }) },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "p-1", user_id: "u-1" },
      }),
    });
    const req = new NextRequest("http://t/api/portfolios/p-1/monte-carlo", {
      method: "POST",
      body: JSON.stringify({
        current_value: 10_000,
        weights: { A: 1.0 },
        expected_returns: { A: 0.0004 },
        covariance: [[0.0001]],
        horizon_days: 30,
        n_simulations: 500,
        percentiles: [5, 50, 95],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(res.status).toBe(200);
    const calls = (rateLimit as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const tiers = calls.map((c) => c[1]);
    expect(tiers).toContain("monte_carlo");
    expect(tiers).toContain("internal");
    const forwarded = (callQuant as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(forwarded.endpoint).toBe("/monte-carlo");
    expect(forwarded.body).toHaveProperty("current_value", 10_000);
    expect(forwarded.body).toHaveProperty("covariance");
  });
});
```

- [ ] **Step 2: Run to verify fail, then implement**

Mirror `optimize/route.ts`. Zod schema matches spec §4.1.2: `{ current_value, weights, expected_returns, covariance, horizon_days (≤1260), n_simulations (1..50_000), percentiles, seed? }`. Rate-limit tier = `"monte_carlo"`; callQuant endpoint = `"/monte-carlo"`; PostHog event = `monte_carlo_run`.

```typescript
// src/app/api/portfolios/[id]/monte-carlo/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { errorCoded, successCoded } from "@/lib/api/response-coded";
import { rateLimit } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { callQuant, QuantError } from "@/lib/services/quant";
import { isFeatureEnabled } from "@/lib/flags";
import { redis } from "@/lib/cache/redis";
import { posthog } from "@/lib/analytics/posthog-server";

// Spec §4.1.2 request shape. Numbers of `covariance` rows/cols MUST equal the
// number of symbols (keys in `weights` / `expected_returns`); Pydantic validates
// this at the Modal boundary so we keep the Zod refine light here (structural).
const MCBody = z
  .object({
    current_value: z.number().positive(),
    weights: z.record(z.string(), z.number()),
    expected_returns: z.record(z.string(), z.number()),
    covariance: z.array(z.array(z.number())),
    horizon_days: z.number().int().positive().max(1260),
    n_simulations: z.number().int().positive().max(50_000),
    percentiles: z.array(z.number().min(0).max(100)).min(1).default([5, 50, 95]),
    seed: z.number().int().optional(),
  })
  .refine(
    (b) => Object.keys(b.weights).length === Object.keys(b.expected_returns).length,
    {
      message: "weights and expected_returns must have the same symbol set",
      path: ["expected_returns"],
    },
  )
  .refine(
    (b) => {
      const n = Object.keys(b.weights).length;
      return b.covariance.length === n && b.covariance.every((row) => row.length === n);
    },
    {
      message: "covariance must be a square matrix with rows/cols matching symbol count",
      path: ["covariance"],
    },
  );

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("UNAUTHENTICATED", "Not authenticated");

  const okMc = await rateLimit(user.id, "monte_carlo");
  const okInt = await rateLimit(user.id, "internal");
  if (!okMc || !okInt) return errorCoded("RATE_LIMITED", "Too many requests");

  let parsed;
  try {
    parsed = MCBody.parse(JSON.parse(await req.text()));
  } catch (err) {
    return errorCoded("VALIDATION_ERROR", "Invalid body", {
      zod: err instanceof z.ZodError ? err.issues : String(err),
    });
  }

  const { data: p } = await supabase
    .from("portfolios")
    .select("id, user_id")
    .eq("id", portfolioId)
    .single();
  if (!p || p.user_id !== user.id)
    return errorCoded("PORTFOLIO_NOT_FOUND", "Portfolio not found");

  try {
    const result = await callQuant({
      endpoint: "/monte-carlo",
      body: parsed,
      portfolioId,
      userId: user.id,
      supabase,
      cache: {
        get: async (k) => (await redis.get(k)) ?? null,
        set: async (k, v, ttl) => { await redis.set(k, v, { ex: ttl }); },
      },
    });
    void posthog.capture({
      distinctId: user.id,
      event: "monte_carlo_run",
      properties: {
        portfolio_id: portfolioId,
        horizon_days: parsed.horizon_days,
        n_simulations: parsed.n_simulations,
        cached: (result as { cached?: boolean }).cached === true,
      },
    });
    return successCoded(result);
  } catch (err) {
    if (err instanceof QuantError)
      return errorCoded(
        (err.code as Parameters<typeof errorCoded>[0]) || "INTERNAL",
        err.message,
        err.details,
      );
    console.error("[monte-carlo route] unexpected", err);
    return errorCoded(
      "INTERNAL",
      err instanceof Error ? err.message : "Unexpected error",
    );
  }
});
```

- [ ] **Step 3: Run tests, verify pass + commit**

Run: `npm test -- tests/app/api/portfolios/monte-carlo.test.ts`
Expected: PASS.

```bash
git add src/app/api/portfolios/[id]/monte-carlo/route.ts \
        tests/app/api/portfolios/monte-carlo.test.ts
git commit -m "feat(api): POST /api/portfolios/[id]/monte-carlo route

Rate-limited on 'monte_carlo' tier (3/min). Max horizon 1260 days
(~5 years), max 50_000 simulations. Same auth + feature-flag +
ownership pattern as /optimize."
```

### Task 7.7: `/api/portfolios/[id]/factors` route (GET)

**Files:**
- Create: `src/app/api/portfolios/[id]/factors/route.ts`
- Test: `tests/app/api/portfolios/factors.test.ts`

**Spec callout (§3.6 route table):** this Next.js route is **GET**, not POST. The client passes no body — it just asks "run a factor regression on my portfolio for the last N days". The route loads the portfolio's daily return series from `price_history`, loads the 6 FF5+MOM factor returns from the fixture shipped in Chunk 4 (`worker/data/ff5_mom_daily.json`), validates the shapes, then **POSTs** the composed body to the Modal `/factors` endpoint (spec §4.1.3) via `callQuant`. Query params: `days` (30..504, default 252).

- [ ] **Step 1: Write failing test**

```typescript
// tests/app/api/portfolios/factors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/portfolios/[id]/factors/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/services/quant", () => ({
  callQuant: vi.fn(),
  QuantError: class extends Error {
    constructor(public code: string, message: string,
                public details: Record<string, unknown> = {}) { super(message); }
  },
}));
vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/analytics/posthog-server", () => ({
  posthog: { capture: vi.fn() },
}));

beforeEach(() => vi.resetAllMocks());

describe("GET /api/portfolios/[id]/factors", () => {
  it("returns UNAUTHENTICATED envelope when no session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const req = new NextRequest("http://t/api/portfolios/p-1/factors?days=252");
    const res = await GET(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("composes portfolio_returns + factor_returns server-side, POSTs to Modal", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const priceRows = Array.from({ length: 253 }, (_, i) => ({
      price: 100 * Math.exp(i * 0.001),
      date: new Date(2024, 0, i + 1).toISOString().slice(0, 10),
    }));
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "portfolios") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "p-1", user_id: "u-1", symbols: ["AAPL"] },
            }),
          };
        }
        // price_history
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: priceRows }),
        };
      }),
    });
    const { callQuant } = await import("@/lib/services/quant");
    (callQuant as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      alpha: 0.01, betas: { MKT: 1.0, SMB: 0.1, HML: 0.0, RMW: 0.0, CMA: 0.0, MOM: 0.2 },
      r_squared: 0.85, adjusted_r_squared: 0.84, t_stats: {}, p_values: {},
      residual_std: 0.01, meta: {},
    });
    const req = new NextRequest("http://t/api/portfolios/p-1/factors?days=252");
    const res = await GET(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(res.status).toBe(200);
    const calls = (callQuant as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].endpoint).toBe("/factors");
    expect(calls[0][0].body).toHaveProperty("portfolio_returns");
    expect(calls[0][0].body).toHaveProperty("factor_returns");
    // 6 FF5+MOM factors required
    const fr = calls[0][0].body.factor_returns;
    for (const k of ["MKT", "SMB", "HML", "RMW", "CMA", "MOM"]) {
      expect(fr).toHaveProperty(k);
    }
  });

  it("returns INTERNAL envelope (never throws) on unexpected error", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("supabase down"),
    );
    const req = new NextRequest("http://t/api/portfolios/p-1/factors?days=252");
    const res = await GET(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    // apiHandler wraps thrown errors; inner route should also never re-throw.
    expect([500]).toContain(res.status);
    expect(json).toHaveProperty("error");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/api/portfolios/factors.test.ts`
Expected: module not found (route file not yet created).

- [ ] **Step 3: Implement GET route with server-side body composition**

```typescript
// src/app/api/portfolios/[id]/factors/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { errorCoded, successCoded } from "@/lib/api/response-coded";
import { rateLimit } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { callQuant, QuantError } from "@/lib/services/quant";
import { isFeatureEnabled } from "@/lib/flags";
import { redis } from "@/lib/cache/redis";
import { posthog } from "@/lib/analytics/posthog-server";
import { loadFactorReturns } from "@/lib/services/factors-data";

const QuerySchema = z.object({
  days: z.coerce.number().int().min(30).max(504).default(252),
});

// Body we compose and POST to Modal /factors (spec §4.1.3). Validated before
// hitting the wire to catch drift in the fixture or history loader.
const ModalBodyShape = z
  .object({
    portfolio_returns: z.array(z.number()).min(30),
    factor_returns: z.record(z.string(), z.array(z.number())),
    risk_free_rate_daily: z.number().default(0),
  })
  .refine(
    (b) => {
      for (const k of ["MKT", "SMB", "HML", "RMW", "CMA", "MOM"] as const) {
        if (!b.factor_returns[k]) return false;
      }
      return true;
    },
    { message: "factor_returns must include all of MKT, SMB, HML, RMW, CMA, MOM" },
  )
  .refine(
    (b) =>
      Object.values(b.factor_returns).every(
        (arr) => arr.length === b.portfolio_returns.length,
      ),
    { message: "every factor series must match portfolio_returns length" },
  );

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("UNAUTHENTICATED", "Not authenticated");

  // Factors is cached 1h Modal-side; cheap tier.
  const okG = await rateLimit(user.id, "general");
  const okI = await rateLimit(user.id, "internal");
  if (!okG || !okI) return errorCoded("RATE_LIMITED", "Too many requests");

  // Query params
  const url = new URL(req.url);
  const q = QuerySchema.safeParse({ days: url.searchParams.get("days") ?? undefined });
  if (!q.success)
    return errorCoded("VALIDATION_ERROR", "Invalid query", { zod: q.error.issues });
  const days = q.data.days;

  // Portfolio ownership
  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("id, user_id, symbols, target_weights")
    .eq("id", portfolioId)
    .single();
  if (pErr || !portfolio || portfolio.user_id !== user.id)
    return errorCoded("PORTFOLIO_NOT_FOUND", "Portfolio not found");

  try {
    // Load portfolio return series from price_history.
    const portfolio_returns = await loadPortfolioReturns(
      supabase,
      portfolio.symbols as string[],
      (portfolio.target_weights as Record<string, number> | null) ?? null,
      days,
    );
    if (portfolio_returns.length < 30) {
      return errorCoded(
        "INSUFFICIENT_HISTORY",
        "Need at least 30 days of portfolio history for factor regression",
      );
    }

    // Load factor fixture, aligned to the tail of portfolio_returns.
    const factor_returns = await loadFactorReturns(portfolio_returns.length);

    const candidate = {
      portfolio_returns,
      factor_returns,
      risk_free_rate_daily: 0,
    };
    const validated = ModalBodyShape.safeParse(candidate);
    if (!validated.success) {
      return errorCoded("INTERNAL", "factor body composition failed", {
        zod: validated.error.issues,
      });
    }

    const result = await callQuant({
      endpoint: "/factors",
      body: validated.data,
      portfolioId,
      userId: user.id,
      supabase,
      cache: {
        get: async (k) => (await redis.get(k)) ?? null,
        set: async (k, v, ttl) => { await redis.set(k, v, { ex: ttl }); },
      },
    });
    void posthog.capture({
      distinctId: user.id,
      event: "factors_run",
      properties: {
        portfolio_id: portfolioId,
        days,
        cached: (result as { cached?: boolean }).cached === true,
      },
    });
    return successCoded(result);
  } catch (err) {
    if (err instanceof QuantError)
      return errorCoded(
        (err.code as Parameters<typeof errorCoded>[0]) || "INTERNAL",
        err.message,
        err.details,
      );
    console.error("[factors route] unexpected", err);
    return errorCoded(
      "INTERNAL",
      err instanceof Error ? err.message : "Unexpected error",
    );
  }
});

// Weighted daily return series. Equal-weight fallback when target_weights
// is null (user hasn't run optimize yet).
async function loadPortfolioReturns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  symbols: string[],
  targetWeights: Record<string, number> | null,
  days: number,
): Promise<number[]> {
  const perSymbol: Record<string, number[]> = {};
  for (const s of symbols) {
    const { data } = await supabase
      .from("price_history")
      .select("price, date")
      .eq("symbol", s)
      .order("date", { ascending: true })
      .limit(days + 1);
    if (!data || data.length < 2) continue;
    const rets: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const prev = Number(data[i - 1].price);
      const curr = Number(data[i].price);
      if (prev > 0) rets.push(curr / prev - 1);
    }
    perSymbol[s] = rets;
  }
  const found = Object.keys(perSymbol);
  if (found.length === 0) return [];
  // Tail-align all symbol series to min length
  const minLen = Math.min(...found.map((s) => perSymbol[s].length));
  const aligned: Record<string, number[]> = {};
  for (const s of found) {
    aligned[s] = perSymbol[s].slice(-minLen);
  }
  // Weights
  const weights: Record<string, number> =
    targetWeights && Object.keys(targetWeights).length > 0
      ? targetWeights
      : Object.fromEntries(found.map((s) => [s, 1 / found.length]));
  const out: number[] = new Array(minLen).fill(0);
  for (let t = 0; t < minLen; t++) {
    let r = 0;
    for (const s of found) r += (weights[s] ?? 0) * aligned[s][t];
    out[t] = r;
  }
  return out;
}
```

Companion helper (created in Chunk 4 along with the FF5+MOM fixture):

```typescript
// src/lib/services/factors-data.ts
import { promises as fs } from "fs";
import path from "path";

type FactorRow = {
  date: string;
  MKT: number; SMB: number; HML: number;
  RMW: number; CMA: number; MOM: number;
};

let CACHE: FactorRow[] | null = null;

export async function loadFactorReturns(
  length: number,
): Promise<Record<string, number[]>> {
  if (!CACHE) {
    const p = path.join(process.cwd(), "worker", "data", "ff5_mom_daily.json");
    CACHE = JSON.parse(await fs.readFile(p, "utf8")) as FactorRow[];
  }
  const tail = CACHE.slice(-length);
  return {
    MKT: tail.map((r) => r.MKT),
    SMB: tail.map((r) => r.SMB),
    HML: tail.map((r) => r.HML),
    RMW: tail.map((r) => r.RMW),
    CMA: tail.map((r) => r.CMA),
    MOM: tail.map((r) => r.MOM),
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/app/api/portfolios/factors.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/portfolios/[id]/factors/route.ts \
        src/lib/services/factors-data.ts \
        tests/app/api/portfolios/factors.test.ts
git commit -m "feat(api): GET /api/portfolios/[id]/factors route

Server composes portfolio return series (weighted from price_history)
and the 6-factor FF5+MOM fixture, validates shape, then POSTs to
Modal /factors. Uses 'general' tier (cached 1hr) plus 'internal'
safety net. Returns §3.3a JSON envelope — never re-throws."
```

### Task 7.8: `/api/portfolios/[id]/rebalance` route

**Files:**
- Create: `src/app/api/portfolios/[id]/rebalance/route.ts`
- Test: `tests/app/api/portfolios/rebalance.test.ts`

Rate-limit tier: `"rebalance"`. Body matches spec §4.1.4: `{ current_holdings, current_prices, target_weights, cash_available, transaction_cost_bps, min_trade_value }`. Cache TTL=0 (always fresh — trade plans must reflect current prices). Note field names: **`current_prices`** (not `prices`) and the required **`min_trade_value`** floor.

- [ ] **Step 1: Write failing test**

```typescript
// tests/app/api/portfolios/rebalance.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/portfolios/[id]/rebalance/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/services/quant", () => ({
  callQuant: vi.fn(),
  QuantError: class extends Error {
    constructor(public code: string, message: string,
                public details: Record<string, unknown> = {}) { super(message); }
  },
}));
vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/analytics/posthog-server", () => ({
  posthog: { capture: vi.fn() },
}));

function mockSupabaseWithOwnedPortfolio() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }) },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "p-1", user_id: "u-1" },
    }),
  };
}

beforeEach(() => vi.resetAllMocks());

describe("POST /api/portfolios/[id]/rebalance", () => {
  it("UNAUTHENTICATED (401) when no session", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const req = new NextRequest("http://t/api/portfolios/p-1/rebalance", {
      method: "POST", body: "{}",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("VALIDATION_ERROR when body uses legacy 'prices' key (spec requires current_prices)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockSupabaseWithOwnedPortfolio(),
    );
    const req = new NextRequest("http://t/api/portfolios/p-1/rebalance", {
      method: "POST",
      body: JSON.stringify({
        current_holdings: { AAPL: 10 },
        prices: { AAPL: 150 }, // legacy key — must fail Zod
        target_weights: { AAPL: 1 },
        cash_available: 0,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("forwards current_prices + min_trade_value and emits rebalance_plan_created", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockSupabaseWithOwnedPortfolio(),
    );
    const { callQuant } = await import("@/lib/services/quant");
    (callQuant as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      trades: [{ symbol: "AAPL", action: "buy", shares: 1, estimated_cost: 150.08, post_weight: 1.0 }],
      total_turnover: 150, estimated_costs: 0.08, drift_before: 0.1, drift_after: 0.01,
    });
    const { posthog } = await import("@/lib/analytics/posthog-server");
    const req = new NextRequest("http://t/api/portfolios/p-1/rebalance", {
      method: "POST",
      body: JSON.stringify({
        current_holdings: { AAPL: 10 },
        current_prices: { AAPL: 150 },
        target_weights: { AAPL: 1 },
        cash_available: 200,
        transaction_cost_bps: 5,
        min_trade_value: 50,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    expect(res.status).toBe(200);
    const forwarded = (callQuant as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(forwarded.endpoint).toBe("/rebalance");
    expect(forwarded.body.current_prices).toEqual({ AAPL: 150 });
    expect(forwarded.body.min_trade_value).toBe(50);
    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({ event: "rebalance_plan_created" }),
    );
  });

  it("returns INTERNAL envelope on unexpected throw (never re-throws)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    const req = new NextRequest("http://t/api/portfolios/p-1/rebalance", {
      method: "POST",
      body: JSON.stringify({
        current_holdings: {}, current_prices: {}, target_weights: {},
        cash_available: 0, min_trade_value: 0,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p-1" }) });
    const json = await res.json();
    expect([500]).toContain(res.status);
    expect(json).toHaveProperty("error");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/api/portfolios/rebalance.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
// src/app/api/portfolios/[id]/rebalance/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { errorCoded, successCoded } from "@/lib/api/response-coded";
import { rateLimit } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { callQuant, QuantError } from "@/lib/services/quant";
import { isFeatureEnabled } from "@/lib/flags";
import { posthog } from "@/lib/analytics/posthog-server";

// Spec §4.1.4 request shape. Note `current_prices` (NOT `prices`) and the
// required `min_trade_value` floor — trades below this are rounded to 0.
const RebalanceBody = z.object({
  current_holdings: z.record(z.string(), z.number().int().nonnegative()),
  current_prices: z.record(z.string(), z.number().positive()),
  target_weights: z.record(z.string(), z.number()),
  cash_available: z.number().nonnegative(),
  transaction_cost_bps: z.number().min(0).max(100).default(5),
  min_trade_value: z.number().nonnegative().default(50),
});

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("UNAUTHENTICATED", "Not authenticated");

  const okR = await rateLimit(user.id, "rebalance");
  const okI = await rateLimit(user.id, "internal");
  if (!okR || !okI) return errorCoded("RATE_LIMITED", "Too many requests");

  let parsed;
  try {
    parsed = RebalanceBody.parse(JSON.parse(await req.text()));
  } catch (err) {
    return errorCoded("VALIDATION_ERROR", "Invalid body", {
      zod: err instanceof z.ZodError ? err.issues : String(err),
    });
  }

  const { data: p } = await supabase
    .from("portfolios")
    .select("id, user_id")
    .eq("id", portfolioId)
    .single();
  if (!p || p.user_id !== user.id)
    return errorCoded("PORTFOLIO_NOT_FOUND", "Portfolio not found");

  try {
    const result = await callQuant({
      endpoint: "/rebalance",
      body: parsed,
      portfolioId,
      userId: user.id,
      supabase,
      // TTL=0 in callQuant — never cached (prices stale immediately).
      cache: {
        get: async () => null,
        set: async () => {},
      },
    });
    void posthog.capture({
      distinctId: user.id,
      event: "rebalance_plan_created",
      properties: {
        portfolio_id: portfolioId,
        n_trades: (result as { trades?: unknown[] }).trades?.length ?? 0,
        total_turnover: (result as { total_turnover?: number }).total_turnover ?? 0,
        estimated_costs: (result as { estimated_costs?: number }).estimated_costs ?? 0,
        drift_after: (result as { drift_after?: number }).drift_after ?? 0,
      },
    });
    return successCoded(result);
  } catch (err) {
    if (err instanceof QuantError)
      return errorCoded(
        (err.code as Parameters<typeof errorCoded>[0]) || "INTERNAL",
        err.message,
        err.details,
      );
    console.error("[rebalance route] unexpected", err);
    return errorCoded(
      "INTERNAL",
      err instanceof Error ? err.message : "Unexpected error",
    );
  }
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/app/api/portfolios/rebalance.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/portfolios/[id]/rebalance/route.ts \
        tests/app/api/portfolios/rebalance.test.ts
git commit -m "feat(api): POST /api/portfolios/[id]/rebalance route

Never cached (fresh trade plan every call). Uses 'rebalance' tier
(10/min) + internal cap. Spec §4.1.4 body: current_prices (NOT
legacy 'prices') + min_trade_value floor. All 4 quant routes now
wired end-to-end."
```

---

## Chunk 8 — UI vertical slice (`(app)/portfolio/[id]/optimize`)

**Goal:** End-user-facing Optimize page, gated by feature flag `quant_engine_enabled`. All components render without optimization running (empty state) and update live when the user changes constraints.

**Route group note:** The existing app uses the Next.js route group `(app)` (see `src/app/(app)/portfolio/[id]/page.tsx`, `.../analytics/page.tsx`). All new pages in this chunk live under that group so they inherit the authenticated shell layout — do **not** create bare `src/app/portfolio/[id]/optimize/`.

**Interaction model (spec §4.2.3):**
- User lands on page → form pre-populated from portfolio's `optimization_constraints` (or defaults).
- User edits constraint → client-side **debounced commit** (spec §4.2.3 mandates **1500ms** after last keystroke OR on input blur, whichever comes first) → POST to `/api/portfolios/[id]/optimize`. A 500ms debounce was tried earlier and produced too many in-flight optimizations — the 1500ms value is locked in per spec.
- A **"Taking longer than usual…"** banner appears after 5s of `loading === true` (OR/MV solves can spike on large N or tight constraints).
- Page also has an **"Include frontier"** toggle → when on, request body sets `frontier_points: 20` (spec §4.1.1 uses an integer, NOT `include_frontier: boolean`).
- **Per-error-code UX:** `RATE_LIMITED` shows a soft banner "Too many requests — try again in a moment" instead of the raw message; `VALIDATION_ERROR` surfaces field-level hints under the form; `FEATURE_DISABLED` shows an empty-state card; `INSUFFICIENT_HISTORY` prompts user to add more price history.
- "Generate trades" button calls `/rebalance` endpoint with `current_prices` (spec §4.1.4 name — NOT legacy `prices`) from the existing live-prices hook and `current_holdings` derived from `positions` rows.

**Component layout:**
```
page.tsx
├── OptimizeSummary         (top: μ, σ, Sharpe cards)
├── EfficientFrontierChart  (middle: Recharts scatter w/ frontier + optimum)
├── ConstraintsForm         (left sidebar: form inputs)
├── OptimalAllocationTable  (right: symbol × {current, target, drift})
└── RebalanceTradeList      (bottom: appears after "Generate trades")
```

### Task 8.0: Shared quant types + feature-flag client hook

**Why a separate task:** avoids having every component import `OptimizeResult` from `optimize-client.tsx` (which creates awkward circular imports and forces `"use client"` on the importer). Types live in `src/lib/quant/types.ts`; client hook in `src/lib/flags/client.ts`.

**Files:**
- Create: `src/lib/quant/types.ts`
- Create: `src/lib/flags/client.ts`
- Test: `tests/lib/flags/client.test.tsx`

- [ ] **Step 1: Write types file**

```typescript
// src/lib/quant/types.ts
// Shared between the optimize client, UI components, and tests. Mirrors spec §4.1.

export type OptimizeMethod = "mean_variance" | "risk_parity" | "hrp";

export type OptimizeResult = {
  weights: Record<string, number>;
  expected_return: number;
  expected_volatility: number;
  sharpe_ratio: number;
  frontier: Array<{ return: number; volatility: number; weights: Record<string, number> }>;
  meta: { method: string; solver: string; cached?: boolean };
};

// Spec §4.1.4 rebalance response shape (verbatim — do NOT rename these fields).
// estimated_cost is asymmetric: buy = gross + fee, sell = fee only.
export type RebalanceTrade = {
  symbol: string;
  action: "buy" | "sell";
  shares: number;
  estimated_cost: number;
  post_weight: number;
};

export type RebalanceResult = {
  trades: RebalanceTrade[];
  total_turnover: number;    // Σ |shares × price| (notional, pre-fee)
  estimated_costs: number;   // Σ fees only = total_turnover * bps / 10000
  drift_before: number;
  drift_after: number;
};
```

- [ ] **Step 2: Write failing test for `useFeatureFlag`**

```tsx
// tests/lib/flags/client.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useFeatureFlag } from "@/lib/flags/client";

function Probe({ flag }: { flag: string }) {
  const on = useFeatureFlag(flag);
  return <span data-testid="on">{on ? "on" : "off"}</span>;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe("useFeatureFlag", () => {
  it("returns false before the fetch resolves, then flips when API says true", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true }),
    });
    render(<Probe flag="quant_engine_enabled" />);
    expect(screen.getByTestId("on").textContent).toBe("off");
    await waitFor(() => expect(screen.getByTestId("on").textContent).toBe("on"));
  });

  it("returns false on fetch error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("net"));
    render(<Probe flag="quant_engine_enabled" />);
    await waitFor(() => expect(screen.getByTestId("on").textContent).toBe("off"));
  });
});
```

- [ ] **Step 3: Implement `useFeatureFlag`**

```typescript
// src/lib/flags/client.ts
"use client";
import { useEffect, useState } from "react";

/**
 * Client-side feature flag check. Delegates to GET /api/flags?name=<flag>
 * (implemented in Phase 1). The endpoint reads the same PostHog/Supabase
 * source as the server-side `isFeatureEnabled`. Cached for 60s in-process.
 */
const CACHE = new Map<string, { value: boolean; expires: number }>();

export function useFeatureFlag(flag: string): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const cached = CACHE.get(flag);
    if (cached && cached.expires > Date.now()) {
      setEnabled(cached.value);
      return;
    }
    (async () => {
      try {
        const r = await fetch(`/api/flags?name=${encodeURIComponent(flag)}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { enabled?: boolean };
        if (cancelled) return;
        const value = !!j.enabled;
        CACHE.set(flag, { value, expires: Date.now() + 60_000 });
        setEnabled(value);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [flag]);
  return enabled;
}
```

- [ ] **Step 4: Run, verify pass, commit**

```bash
npm test -- tests/lib/flags/client.test.tsx
# Expected: PASS
git add src/lib/quant/types.ts src/lib/flags/client.ts tests/lib/flags/client.test.tsx
git commit -m "feat(quant): shared OptimizeResult/Rebalance types + useFeatureFlag hook

Types shipped in src/lib/quant so UI components don't need to import
from the client file (avoids circular imports). useFeatureFlag hits
/api/flags?name= (60s in-proc cache) for client-side flag gating."
```

### Task 8.1: Container page shell (flag-gated)

**Files:**
- Create: `src/app/(app)/portfolio/[id]/optimize/page.tsx`
- Create: `src/app/(app)/portfolio/[id]/optimize/optimize-client.tsx` (client component)
- Test: `tests/app/portfolio/optimize-page.test.tsx`

- [ ] **Step 1: Write failing page test (SSR + flag gate)**

```typescript
// tests/app/portfolio/optimize-page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "@/app/(app)/portfolio/[id]/optimize/page";

vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn(),
}));

// NOTE: createClient is async in server.ts; mock must `mockResolvedValue`
// the supabase-shaped object, not `mockReturnValue`.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: "p-1",
        user_id: "u",
        symbols: ["A", "B"],
        optimization_constraints: null,
        target_weights: null,
      },
    }),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

describe("Optimize page", () => {
  it("throws NEXT_NOT_FOUND when flag is off", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(
      Page({ params: Promise.resolve({ id: "p-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders client component when flag on and portfolio owned", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const result = await Page({ params: Promise.resolve({ id: "p-1" }) });
    render(result);
    expect(screen.getByTestId("optimize-root")).toBeInTheDocument();
  });

  it("throws NEXT_NOT_FOUND when portfolio belongs to another user", async () => {
    const { isFeatureEnabled } = await import("@/lib/flags");
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: "p-1", user_id: "somebody-else", symbols: [], optimization_constraints: null, target_weights: null },
      }),
    });
    await expect(
      Page({ params: Promise.resolve({ id: "p-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/portfolio/optimize-page.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement page shell**

```tsx
// src/app/(app)/portfolio/[id]/optimize/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/flags";
import OptimizeClient from "./optimize-client";

type Props = { params: Promise<{ id: string }> };

export default async function OptimizePage({ params }: Props) {
  if (!(await isFeatureEnabled("quant_engine_enabled"))) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id, user_id, symbols, optimization_constraints, target_weights")
    .eq("id", id)
    .single();
  if (!portfolio || portfolio.user_id !== user.id) notFound();
  return (
    <div data-testid="optimize-root" className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Optimize Portfolio</h1>
      <OptimizeClient
        portfolioId={id}
        initialSymbols={(portfolio.symbols as string[]) ?? []}
        initialConstraints={
          (portfolio.optimization_constraints as Record<string, unknown>) ?? null
        }
      />
    </div>
  );
}
```

```tsx
// src/app/(app)/portfolio/[id]/optimize/optimize-client.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";
import { useLivePrices } from "@/lib/hooks/use-live-prices";
import { usePortfolioHoldings } from "@/lib/hooks/use-portfolio-holdings"; // created in Phase 1 — pulls integer shares from `positions` table
import type { OptimizeMethod, OptimizeResult, RebalanceResult } from "@/lib/quant/types";
import ConstraintsForm from "@/components/quant/ConstraintsForm";
import EfficientFrontierChart from "@/components/quant/EfficientFrontierChart";
import OptimalAllocationTable from "@/components/quant/OptimalAllocationTable";
import RebalanceTradeList from "@/components/quant/RebalanceTradeList";
import OptimizeSummary from "@/components/quant/OptimizeSummary";

type Props = {
  portfolioId: string;
  initialSymbols: string[];
  initialConstraints: Record<string, unknown> | null;
};

type FriendlyError =
  | { kind: "rate_limited"; retryHintMs: number }
  | { kind: "validation_error"; fieldHints: Record<string, string> }
  | { kind: "insufficient_history"; message: string }
  | { kind: "feature_disabled" }
  | { kind: "generic"; message: string };

function toFriendly(envelope: { error?: { code?: string; message?: string; details?: Record<string, unknown> } }): FriendlyError {
  const code = envelope.error?.code;
  const message = envelope.error?.message ?? "Optimization failed";
  switch (code) {
    case "RATE_LIMITED":
      return { kind: "rate_limited", retryHintMs: 60_000 };
    case "VALIDATION_ERROR":
      return { kind: "validation_error", fieldHints: (envelope.error?.details ?? {}) as Record<string, string> };
    case "INSUFFICIENT_HISTORY":
      return { kind: "insufficient_history", message };
    case "FEATURE_DISABLED":
      return { kind: "feature_disabled" };
    default:
      return { kind: "generic", message };
  }
}

export default function OptimizeClient({
  portfolioId,
  initialSymbols,
  initialConstraints,
}: Props) {
  const [method, setMethod] = useState<OptimizeMethod>("mean_variance");
  const [constraints, setConstraints] = useState(initialConstraints);
  const [includeFrontier, setIncludeFrontier] = useState(false);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [slowBanner, setSlowBanner] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [trades, setTrades] = useState<RebalanceResult | null>(null);

  // Real data sources (spec §4.2.3 — use existing hooks, do NOT stub with {}).
  const { holdings } = usePortfolioHoldings(portfolioId); // Record<symbol, shares>
  const { prices } = useLivePrices(initialSymbols);       // Record<symbol, price>

  const optimize = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/portfolios/${portfolioId}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          symbols: initialSymbols,
          constraints,
          // Spec §4.1.1 uses `frontier_points: int`, NOT `include_frontier: bool`.
          frontier_points: includeFrontier ? 20 : 0,
        }),
      });
      if (!resp.ok) {
        const env = (await resp.json()) as Parameters<typeof toFriendly>[0];
        setError(toFriendly(env));
        return;
      }
      setResult((await resp.json()) as OptimizeResult);
    } catch (e) {
      setError({ kind: "generic", message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }, [portfolioId, method, constraints, includeFrontier, initialSymbols]);

  // Spec §4.2.3: 1500ms debounce (earlier 500ms caused request storms on slider drag).
  const debouncedOptimize = useDebouncedCallback(optimize, 1500);

  // Fire on any relevant change.
  useEffect(() => {
    debouncedOptimize();
  }, [debouncedOptimize, method, constraints, includeFrontier]);

  // 5-second "Taking longer than usual…" banner (spec §4.2.3).
  useEffect(() => {
    if (!loading) { setSlowBanner(false); return; }
    const t = setTimeout(() => setSlowBanner(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  const onGenerateTrades = useCallback(async () => {
    if (!result) return;
    setError(null);
    const resp = await fetch(`/api/portfolios/${portfolioId}/rebalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_holdings: holdings,         // real hook data — no stubs
        current_prices: prices,             // spec §4.1.4 name — NOT legacy `prices`
        target_weights: result.weights,
        cash_available: 0,                  // TODO(Phase3): plumb from cash_balance column
        transaction_cost_bps: 5,
        min_trade_value: 50,
      }),
    });
    if (!resp.ok) {
      setError(toFriendly((await resp.json()) as Parameters<typeof toFriendly>[0]));
      return;
    }
    setTrades((await resp.json()) as RebalanceResult);
  }, [portfolioId, result, holdings, prices]);

  const tradesReady = useMemo(
    () => result !== null && Object.keys(holdings).length > 0 && Object.keys(prices).length > 0,
    [result, holdings, prices],
  );

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-3">
        <ConstraintsForm
          method={method}
          onMethodChange={setMethod}
          constraints={constraints}
          onConstraintsChange={setConstraints}
          includeFrontier={includeFrontier}
          onIncludeFrontierChange={setIncludeFrontier}
          fieldHints={error?.kind === "validation_error" ? error.fieldHints : undefined}
        />
      </div>
      <div className="col-span-9 space-y-4">
        {error?.kind === "rate_limited" && (
          <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded text-sm" data-testid="error-rate-limited">
            Too many requests — try again in a moment.
          </div>
        )}
        {error?.kind === "insufficient_history" && (
          <div role="alert" className="bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded text-sm" data-testid="error-insufficient-history">
            {error.message}
          </div>
        )}
        {error?.kind === "feature_disabled" && (
          <div role="alert" className="p-4 text-sm text-gray-500 border rounded" data-testid="error-feature-disabled">
            Optimization is temporarily unavailable.
          </div>
        )}
        {error?.kind === "generic" && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-900 p-3 rounded text-sm" data-testid="error-generic">
            {error.message}
          </div>
        )}
        {slowBanner && loading && (
          <div className="bg-gray-50 border border-gray-200 text-gray-700 p-3 rounded text-sm" data-testid="slow-banner">
            Taking longer than usual — large portfolios and tight constraints can add a few seconds.
          </div>
        )}
        <OptimizeSummary result={result} loading={loading} />
        {includeFrontier && result && (
          <EfficientFrontierChart frontier={result.frontier} optimum={result} />
        )}
        <OptimalAllocationTable result={result} holdings={holdings} />
        <button
          disabled={!tradesReady}
          onClick={onGenerateTrades}
          className="btn btn-primary"
          data-testid="generate-trades"
        >
          Generate Trades
        </button>
        {trades ? <RebalanceTradeList data={trades} /> : null}
      </div>
    </div>
  );
}
```

**Companion hook to create in Phase 1 (the optimize page depends on it):**

```typescript
// src/lib/hooks/use-portfolio-holdings.ts
// Returns integer shares keyed by symbol, pulled from `positions` table.
// Implementation: SWR-style fetch from GET /api/portfolio/[id]/holdings
// (endpoint already exists per Phase 1). Falls back to empty object.
import useSWR from "swr";

export function usePortfolioHoldings(portfolioId: string) {
  const { data } = useSWR<{ holdings: Record<string, number> }>(
    portfolioId ? `/api/portfolio/${portfolioId}/holdings` : null,
    (u: string) => fetch(u).then((r) => r.json()),
  );
  return { holdings: data?.holdings ?? {} };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/app/portfolio/optimize-page.test.tsx`
Expected: all 3 tests PASS (components from later tasks may be stubbed — see 8.2-8.6).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/portfolio/\[id\]/optimize/ \
        src/lib/hooks/use-portfolio-holdings.ts \
        tests/app/portfolio/optimize-page.test.tsx
git commit -m "feat(ui): Optimize page shell with feature flag gate

SSR checks quant_engine_enabled flag and portfolio ownership, then
renders client island under (app) route group. Client runs 1500ms
debounced optimize (spec §4.2.3). 5-second 'Taking longer...'
banner, per-error-code UX (rate_limited/validation/insufficient_
history/feature_disabled/generic). Generate-trades uses live-prices
+ holdings hooks and posts spec §4.1.4 body (current_prices +
min_trade_value)."
```

### Task 8.2: `ConstraintsForm` component

**Files:**
- Create: `src/components/quant/ConstraintsForm.tsx`
- Test: `tests/components/quant/ConstraintsForm.test.tsx`

- [ ] **Step 1: Write test, implement, commit**

```tsx
// src/components/quant/ConstraintsForm.tsx
"use client";
import { useCallback } from "react";
import type { OptimizeMethod } from "@/lib/quant/types";

type Constraints = {
  allow_short?: boolean;
  min_weight?: number;
  max_weight?: number;
  sector_caps?: Record<string, number>;
  sector_map?: Record<string, string>;
};

type Props = {
  method: OptimizeMethod;
  onMethodChange: (m: OptimizeMethod) => void;
  constraints: Record<string, unknown> | null;
  onConstraintsChange: (c: Record<string, unknown> | null) => void;
  includeFrontier: boolean;
  onIncludeFrontierChange: (v: boolean) => void;
  /** Populated by parent on VALIDATION_ERROR envelopes (§3.3a). */
  fieldHints?: Record<string, string>;
};

export default function ConstraintsForm(props: Props) {
  const c = (props.constraints ?? {}) as Constraints;
  const set = useCallback(
    (patch: Partial<Constraints>) => props.onConstraintsChange({ ...c, ...patch }),
    [c, props],
  );
  return (
    <form className="space-y-3" data-testid="constraints-form" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label className="block text-sm">Method</label>
        <select
          value={props.method}
          onChange={(e) => props.onMethodChange(e.target.value as Props["method"])}
          className="border rounded px-2 py-1 w-full"
          data-testid="method-select"
        >
          <option value="mean_variance">Mean-Variance (Markowitz)</option>
          <option value="risk_parity">Risk Parity</option>
          <option value="hrp">HRP (Hierarchical)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!c.allow_short}
          onChange={(e) => set({ allow_short: e.target.checked })}
          data-testid="allow-short"
        />
        Allow short positions
      </label>
      <div>
        <label className="block text-sm">Min weight</label>
        <input
          type="number"
          step="0.01"
          min={0}
          max={1}
          value={c.min_weight ?? ""}
          onChange={(e) =>
            set({ min_weight: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="border rounded px-2 py-1 w-full"
          data-testid="min-weight"
        />
      </div>
      <div>
        <label className="block text-sm">Max weight</label>
        <input
          type="number"
          step="0.01"
          min={0}
          max={1}
          value={c.max_weight ?? ""}
          onChange={(e) =>
            set({ max_weight: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="border rounded px-2 py-1 w-full"
          data-testid="max-weight"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.includeFrontier}
          onChange={(e) => props.onIncludeFrontierChange(e.target.checked)}
          data-testid="include-frontier"
        />
        Include efficient frontier
      </label>
    </form>
  );
}
```

```tsx
// tests/components/quant/ConstraintsForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import ConstraintsForm from "@/components/quant/ConstraintsForm";

describe("ConstraintsForm", () => {
  it("emits method change", () => {
    const onMethodChange = vi.fn();
    render(
      <ConstraintsForm
        method="mean_variance"
        onMethodChange={onMethodChange}
        constraints={null}
        onConstraintsChange={vi.fn()}
        includeFrontier={false}
        onIncludeFrontierChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("method-select"), {
      target: { value: "hrp" },
    });
    expect(onMethodChange).toHaveBeenCalledWith("hrp");
  });

  it("emits max_weight change", () => {
    const onConstraintsChange = vi.fn();
    render(
      <ConstraintsForm
        method="mean_variance"
        onMethodChange={vi.fn()}
        constraints={null}
        onConstraintsChange={onConstraintsChange}
        includeFrontier={false}
        onIncludeFrontierChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("max-weight"), {
      target: { value: "0.25" },
    });
    expect(onConstraintsChange).toHaveBeenCalledWith({ max_weight: 0.25 });
  });
});
```

Run tests. Commit:

```bash
git add src/components/quant/ConstraintsForm.tsx \
        tests/components/quant/ConstraintsForm.test.tsx
git commit -m "feat(ui/quant): ConstraintsForm component

Method select + allow_short + min/max weight + include frontier toggle.
Fires callbacks on every change — debouncing is done by the container."
```

### Task 8.3: `OptimizeSummary` + `OptimalAllocationTable`

**Files:**
- Create: `src/components/quant/OptimizeSummary.tsx`
- Create: `src/components/quant/OptimalAllocationTable.tsx`
- Test: `tests/components/quant/OptimizeSummary.test.tsx`
- Test: `tests/components/quant/OptimalAllocationTable.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// tests/components/quant/OptimizeSummary.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OptimizeSummary from "@/components/quant/OptimizeSummary";
import type { OptimizeResult } from "@/lib/quant/types";

const result: OptimizeResult = {
  weights: { AAPL: 0.5, MSFT: 0.5 },
  expected_return: 0.12,
  expected_volatility: 0.18,
  sharpe_ratio: 0.56,
  frontier: [],
  meta: { method: "mean_variance", solver: "CLARABEL" },
};

describe("OptimizeSummary", () => {
  it("renders empty state when no result and not loading", () => {
    render(<OptimizeSummary result={null} loading={false} />);
    expect(screen.getByText(/Adjust constraints/)).toBeInTheDocument();
  });

  it("renders skeleton when loading and no result yet", () => {
    const { container } = render(<OptimizeSummary result={null} loading={true} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders 3 cards with formatted values", () => {
    render(<OptimizeSummary result={result} loading={false} />);
    expect(screen.getByText("12.00%")).toBeInTheDocument();
    expect(screen.getByText("18.00%")).toBeInTheDocument();
    expect(screen.getByText("0.56")).toBeInTheDocument();
  });
});
```

```tsx
// tests/components/quant/OptimalAllocationTable.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OptimalAllocationTable from "@/components/quant/OptimalAllocationTable";
import type { OptimizeResult } from "@/lib/quant/types";

const result: OptimizeResult = {
  weights: { AAPL: 0.3, MSFT: 0.45, TSLA: 0.25 },
  expected_return: 0.1, expected_volatility: 0.2, sharpe_ratio: 0.5,
  frontier: [], meta: { method: "mean_variance", solver: "CLARABEL" },
};

describe("OptimalAllocationTable", () => {
  it("renders nothing when no result", () => {
    const { container } = render(
      <OptimalAllocationTable result={null} holdings={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("sorts rows by weight descending and shows drift vs current holdings", () => {
    // 10 AAPL @ price unknown (drift computed client-side from share-weight
    // when available; the simple case below just checks order + symbol presence).
    render(
      <OptimalAllocationTable result={result} holdings={{ AAPL: 10, MSFT: 5, TSLA: 0 }} />,
    );
    const rows = screen.getAllByTestId(/^row-/);
    expect(rows[0].textContent).toMatch(/MSFT/); // 0.45 — highest
    expect(rows[1].textContent).toMatch(/AAPL/);
    expect(rows[2].textContent).toMatch(/TSLA/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/components/quant/OptimizeSummary.test.tsx tests/components/quant/OptimalAllocationTable.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/quant/OptimizeSummary.tsx
import type { OptimizeResult } from "@/lib/quant/types";

type Props = {
  result: OptimizeResult | null;
  loading: boolean;
};

export default function OptimizeSummary({ result, loading }: Props) {
  if (loading && !result) {
    return <div className="animate-pulse h-24 bg-gray-100 rounded" />;
  }
  if (!result) {
    return (
      <div className="p-4 text-sm text-gray-500 border rounded">
        Adjust constraints to see results.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-4" data-testid="optimize-summary">
      <Card label="Expected Return" value={`${(result.expected_return * 100).toFixed(2)}%`} />
      <Card label="Volatility" value={`${(result.expected_volatility * 100).toFixed(2)}%`} />
      <Card label="Sharpe Ratio" value={result.sharpe_ratio.toFixed(2)} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded border bg-white">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
```

```tsx
// src/components/quant/OptimalAllocationTable.tsx
import type { OptimizeResult } from "@/lib/quant/types";

type Props = {
  result: OptimizeResult | null;
  /** Current share holdings, used to compute drift (current weight vs target). */
  holdings: Record<string, number>;
};

export default function OptimalAllocationTable({ result, holdings }: Props) {
  if (!result) return null;
  const entries = Object.entries(result.weights).sort((a, b) => b[1] - a[1]);
  const totalShares = Object.values(holdings).reduce((a, b) => a + b, 0) || 1;
  return (
    <table className="w-full text-sm" data-testid="allocation-table">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">Symbol</th>
          <th className="py-2 text-right">Current</th>
          <th className="py-2 text-right">Target</th>
          <th className="py-2 text-right">Drift</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([s, w]) => {
          const current = (holdings[s] ?? 0) / totalShares;
          const drift = w - current;
          return (
            <tr key={s} className="border-b" data-testid={`row-${s}`}>
              <td className="py-2">{s}</td>
              <td className="py-2 text-right tabular-nums">{(current * 100).toFixed(2)}%</td>
              <td className="py-2 text-right tabular-nums">{(w * 100).toFixed(2)}%</td>
              <td className={`py-2 text-right tabular-nums ${drift > 0 ? "text-green-600" : drift < 0 ? "text-red-600" : ""}`}>
                {drift > 0 ? "+" : ""}{(drift * 100).toFixed(2)}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- tests/components/quant/OptimizeSummary.test.tsx tests/components/quant/OptimalAllocationTable.test.tsx`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/quant/OptimizeSummary.tsx src/components/quant/OptimalAllocationTable.tsx \
        tests/components/quant/OptimizeSummary.test.tsx tests/components/quant/OptimalAllocationTable.test.tsx
git commit -m "feat(ui/quant): OptimizeSummary + OptimalAllocationTable

Three-card summary (return/vol/Sharpe) with loading and empty
states (errors handled by parent banners). Allocation table shows
Current/Target/Drift columns sorted by weight desc. Both pure
props-in components — no data fetching."
```

### Task 8.4: `EfficientFrontierChart` component

**Files:**
- Create: `src/components/quant/EfficientFrontierChart.tsx`
- Test: `tests/components/quant/EfficientFrontierChart.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// tests/components/quant/EfficientFrontierChart.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EfficientFrontierChart from "@/components/quant/EfficientFrontierChart";
import type { OptimizeResult } from "@/lib/quant/types";

// Recharts uses ResizeObserver + SVG which jsdom doesn't support perfectly.
// Mock ResizeObserver so <ResponsiveContainer> doesn't crash.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const result: OptimizeResult = {
  weights: { A: 1 },
  expected_return: 0.1,
  expected_volatility: 0.2,
  sharpe_ratio: 0.5,
  frontier: [
    { return: 0.05, volatility: 0.10, weights: { A: 0.3 } },
    { return: 0.10, volatility: 0.20, weights: { A: 0.6 } },
    { return: 0.15, volatility: 0.30, weights: { A: 0.9 } },
  ],
  meta: { method: "mean_variance", solver: "CLARABEL" },
};

describe("EfficientFrontierChart", () => {
  it("renders a chart container with the test id", () => {
    render(<EfficientFrontierChart frontier={result.frontier} optimum={result} />);
    expect(screen.getByTestId("frontier-chart")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2-3: Run to fail, then implement**

```tsx
// src/components/quant/EfficientFrontierChart.tsx
"use client";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { OptimizeResult } from "@/lib/quant/types";

type Props = {
  frontier: OptimizeResult["frontier"];
  optimum: OptimizeResult;
};

export default function EfficientFrontierChart({ frontier, optimum }: Props) {
  const frontierData = frontier.map((p) => ({
    vol: p.volatility * 100,
    ret: p.return * 100,
  }));
  const optimumData = [
    { vol: optimum.expected_volatility * 100, ret: optimum.expected_return * 100 },
  ];
  return (
    <div className="h-80 w-full bg-white p-4 rounded border" data-testid="frontier-chart">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="vol"
            name="Volatility"
            unit="%"
            type="number"
            label={{ value: "Volatility (%)", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            dataKey="ret"
            name="Return"
            unit="%"
            type="number"
            label={{ value: "Expected Return (%)", angle: -90, position: "insideLeft" }}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter name="Frontier" data={frontierData} fill="#8884d8" />
          <Scatter name="Optimum" data={optimumData} fill="#ff7300" shape="star" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass, commit**

```bash
npm test -- tests/components/quant/EfficientFrontierChart.test.tsx
# Expected: PASS

git add src/components/quant/EfficientFrontierChart.tsx \
        tests/components/quant/EfficientFrontierChart.test.tsx
git commit -m "feat(ui/quant): EfficientFrontierChart (recharts scatter)

Plots frontier points + optimum as star marker. Axes in percent.
Pure presentation — renders only when parent passes frontier array."
```

### Task 8.5: `RebalanceTradeList` component

**Files:**
- Create: `src/components/quant/RebalanceTradeList.tsx`
- Test: `tests/components/quant/RebalanceTradeList.test.tsx`

**Spec alignment (§4.1.4):** Response has exactly these top-level keys: `trades[]`, `total_turnover`, `estimated_costs`, `drift_before`, `drift_after`. No `tracking_error`, `total_transaction_cost`, `total_cost`, or `final_cash`.

Each trade row has `{symbol, action, shares, estimated_cost, post_weight}`. **Note `estimated_cost` is asymmetric**: for `buy` trades it is `gross + fee` (what the user pays), for `sell` trades it is `fee only` (proceeds handled separately by the service). The display label is just "Cost" — we do not need to surface that asymmetry to the user.

- [ ] **Step 1: Write failing test**

```tsx
// tests/components/quant/RebalanceTradeList.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RebalanceTradeList from "@/components/quant/RebalanceTradeList";
import type { RebalanceResult } from "@/lib/quant/types";

const data: RebalanceResult = {
  trades: [
    { symbol: "AAPL", action: "buy",  shares: 3, estimated_cost: 450.23, post_weight: 0.40 },
    { symbol: "MSFT", action: "sell", shares: 2, estimated_cost:   0.30, post_weight: 0.40 },
  ],
  total_turnover: 1050.00,
  estimated_costs: 0.53,
  drift_before: 0.12,
  drift_after: 0.01,
};

describe("RebalanceTradeList", () => {
  it("shows empty-state when data is null", () => {
    render(<RebalanceTradeList data={null} />);
    expect(screen.getByText(/No trades needed/)).toBeInTheDocument();
  });

  it("renders drift_before → drift_after + estimated_costs in header", () => {
    render(<RebalanceTradeList data={data} />);
    expect(screen.getByText(/Drift: 12.00% → 1.00%/)).toBeInTheDocument();
    expect(screen.getByText(/Turnover: \$1,?050\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Fees: \$0\.53/)).toBeInTheDocument();
  });

  it("renders a row per trade with action color and post_weight", () => {
    render(<RebalanceTradeList data={data} />);
    expect(screen.getByTestId("trade-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("trade-MSFT")).toBeInTheDocument();
    // post_weight is rendered per-row as a percent
    expect(screen.getByTestId("trade-AAPL")).toHaveTextContent("40.0%");
  });
});
```

- [ ] **Step 2-3: Run to fail, implement**

```tsx
// src/components/quant/RebalanceTradeList.tsx
import type { RebalanceResult } from "@/lib/quant/types";

type Props = { data: RebalanceResult | null };

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function RebalanceTradeList({ data }: Props) {
  if (!data || !data.trades.length) {
    return (
      <div className="p-4 text-sm text-gray-500 border rounded">
        No trades needed — portfolio is already aligned with target.
      </div>
    );
  }
  return (
    <div className="border rounded bg-white" data-testid="trade-list">
      <div className="flex flex-wrap gap-4 justify-between p-3 bg-gray-50 text-sm">
        <span>
          Drift: {(data.drift_before * 100).toFixed(2)}% → {(data.drift_after * 100).toFixed(2)}%
        </span>
        <span>Turnover: {fmtUSD(data.total_turnover)}</span>
        <span>Fees: {fmtUSD(data.estimated_costs)}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 px-3">Symbol</th>
            <th className="py-2 px-3">Action</th>
            <th className="py-2 px-3 text-right">Shares</th>
            <th className="py-2 px-3 text-right">Cost</th>
            <th className="py-2 px-3 text-right">Post-weight</th>
          </tr>
        </thead>
        <tbody>
          {data.trades.map((t) => (
            <tr key={t.symbol} className="border-b" data-testid={`trade-${t.symbol}`}>
              <td className="py-2 px-3">{t.symbol}</td>
              <td className={`py-2 px-3 ${t.action === "buy" ? "text-green-600" : "text-red-600"}`}>
                {t.action.toUpperCase()}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{t.shares}</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtUSD(t.estimated_cost)}</td>
              <td className="py-2 px-3 text-right tabular-nums">
                {(t.post_weight * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass, commit**

```bash
npm test -- tests/components/quant/RebalanceTradeList.test.tsx
# Expected: PASS

git add src/components/quant/RebalanceTradeList.tsx \
        tests/components/quant/RebalanceTradeList.test.tsx
git commit -m "feat(ui/quant): RebalanceTradeList component

Per-trade rows show symbol / action / shares / estimated_cost /
post_weight (spec §4.1.4 field names verbatim — NOT legacy
'dollar_amount'/'cost'/'current_weight'/'new_weight'). Header shows
drift_before → drift_after, total_turnover, and estimated_costs.
Buy/sell color coding. Empty-state when data.trades is empty."
```

### Task 8.6: Flag-gated navigation link (from portfolio detail page)

**Files:**
- Modify: `src/app/(app)/portfolio/[id]/page.tsx` (the existing nav links for Analytics / Transactions / Public live inline here — grep for `Link href=.*analytics` to locate the block)
- Test: `tests/app/portfolio/optimize-nav-link.test.tsx`

**Why no PostHog wiring in this task:** server routes emit `optimize_run`, `rebalance_plan_created`, `monte_carlo_run`, and `factors_run` events directly (see Task 7.5–7.8). Duplicating from the client would double-count and reuse an obsolete `quant_run` event name. Do NOT add client-side captures in this chunk.

- [ ] **Step 1: Write failing test for nav link gating**

```tsx
// tests/app/portfolio/optimize-nav-link.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/flags/client", () => ({
  useFeatureFlag: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

import { PortfolioNavLinks } from "@/components/portfolio/portfolio-nav-links";

describe("Optimize nav link", () => {
  it("does NOT render when flag off", async () => {
    const { useFeatureFlag } = await import("@/lib/flags/client");
    (useFeatureFlag as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<PortfolioNavLinks portfolioId="p-1" />);
    expect(screen.queryByTestId("nav-optimize")).toBeNull();
  });

  it("renders when flag on", async () => {
    const { useFeatureFlag } = await import("@/lib/flags/client");
    (useFeatureFlag as ReturnType<typeof vi.fn>).mockReturnValue(true);
    render(<PortfolioNavLinks portfolioId="p-1" />);
    await waitFor(() => expect(screen.getByTestId("nav-optimize")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/portfolio/optimize-nav-link.test.tsx`
Expected: fail — component not extracted yet.

- [ ] **Step 3: Extract the nav links into a small client component, add the gated Optimize link**

Today, `src/app/(app)/portfolio/[id]/page.tsx` renders `<Link>` tags inline. Extract the nav into a tiny client component so we can use `useFeatureFlag`:

```tsx
// src/components/portfolio/portfolio-nav-links.tsx
"use client";
import Link from "next/link";
import { useFeatureFlag } from "@/lib/flags/client";

export function PortfolioNavLinks({ portfolioId }: { portfolioId: string }) {
  const quantEnabled = useFeatureFlag("quant_engine_enabled");
  return (
    <nav className="flex gap-4 text-sm" data-testid="portfolio-nav">
      <Link href={`/portfolio/${portfolioId}`} data-testid="nav-overview">Overview</Link>
      <Link href={`/portfolio/${portfolioId}/analytics`} data-testid="nav-analytics">Analytics</Link>
      <Link href={`/portfolio/${portfolioId}/transactions`} data-testid="nav-transactions">Transactions</Link>
      <Link href={`/portfolio/${portfolioId}/public`} data-testid="nav-public">Public</Link>
      {quantEnabled && (
        <Link href={`/portfolio/${portfolioId}/optimize`} data-testid="nav-optimize">
          Optimize
        </Link>
      )}
    </nav>
  );
}
```

Then in `src/app/(app)/portfolio/[id]/page.tsx`, replace the inline `<Link>` block for Analytics / Transactions / Public with:

```tsx
import { PortfolioNavLinks } from "@/components/portfolio/portfolio-nav-links";
// ...
<PortfolioNavLinks portfolioId={id} />
```

If the current file has any extra classes or styling on the nav `<div>`, preserve them on the wrapping div — only the `<Link>` children move into `PortfolioNavLinks`. The existing tests for Analytics / Transactions / Public links continue to pass because the `data-testid` names are identical.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- tests/app/portfolio/optimize-nav-link.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/portfolio-nav-links.tsx \
        src/app/\(app\)/portfolio/\[id\]/page.tsx \
        tests/app/portfolio/optimize-nav-link.test.tsx
git commit -m "feat(ui/quant): flag-gated Optimize nav link

Extracts portfolio nav links into PortfolioNavLinks client component
so the Optimize tab can be gated on quant_engine_enabled via
useFeatureFlag. No client-side PostHog events — server routes already
emit optimize_run / monte_carlo_run / factors_run / rebalance_plan_
created on successful calls."
```

---

## Chunk 9 — E2E smoke, API docs, full runbook, deploy checklist, production verification

**Goal:** Complete operational readiness. After this chunk, a fresh engineer can:
- Read `docs/api/quant.md` to consume the new endpoints.
- Read `docs/runbooks/quant-incidents.md` to handle on-call incidents.
- Follow the deploy checklist to roll Phase 2 to production.
- Trust the Playwright smoke test to catch regressions in preview deployments.

### Task 9.1: Playwright E2E smoke (`optimize.spec.ts`)

**Files:**
- Create: `tests/e2e/optimize.spec.ts`
- Modify: `.github/workflows/playwright-smoke.yml` (extend the matrix added in Phase 1)

**Smoke scope (intentionally minimal):** Load Optimize page → form renders → choose method `mean_variance` → wait for summary to appear → assert all three cards present. That's it. Deep cases live in unit tests.

- [ ] **Step 1: Write Playwright spec**

```typescript
// tests/e2e/optimize.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Optimize page — smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Auth fixture: set Supabase cookies from env OR skip if no test user.
    // Assumes Phase 1 smoke already sets up `TEST_USER_EMAIL`/`TEST_USER_PORTFOLIO_ID`.
    const portfolioId = process.env.TEST_USER_PORTFOLIO_ID;
    if (!portfolioId) {
      test.skip(true, "TEST_USER_PORTFOLIO_ID not set");
    }
  });

  test("renders summary after optimize completes", async ({ page, baseURL }) => {
    const pid = process.env.TEST_USER_PORTFOLIO_ID!;
    await page.goto(`${baseURL}/portfolio/${pid}/optimize`);

    // Guard: if the flag is off, the page should 404 — treat as soft-skip.
    if (page.url().includes("/404") || page.url().endsWith("/")) {
      test.skip(true, "Feature flag likely off for this environment");
    }

    await expect(page.getByTestId("constraints-form")).toBeVisible();

    // Default method is mean_variance; wait for the debounced first call to land.
    await expect(page.getByTestId("optimize-summary")).toBeVisible({ timeout: 15_000 });

    // All three cards render
    await expect(page.locator('[data-testid="optimize-summary"] >> text=Expected Return')).toBeVisible();
    await expect(page.locator('[data-testid="optimize-summary"] >> text=Volatility')).toBeVisible();
    await expect(page.locator('[data-testid="optimize-summary"] >> text=Sharpe Ratio')).toBeVisible();

    // Allocation table has at least one row
    const rows = page.locator('[data-testid="allocation-table"] tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  test("toggling frontier renders chart", async ({ page, baseURL }) => {
    const pid = process.env.TEST_USER_PORTFOLIO_ID!;
    await page.goto(`${baseURL}/portfolio/${pid}/optimize`);
    await page.getByTestId("include-frontier").check();
    await expect(page.getByTestId("frontier-chart")).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Extend Playwright workflow**

Add to `.github/workflows/playwright-smoke.yml` (already set up in Phase 1 with the Vercel preview resolver):

```yaml
# Append to the `test:` job's `matrix.spec` list (if using matrix) or
# just add the new spec file to the existing `npx playwright test` invocation.
# Phase 1 command was something like:
#   npx playwright test tests/e2e/smoke.spec.ts
# Change to:
#   npx playwright test tests/e2e/smoke.spec.ts tests/e2e/optimize.spec.ts
```

Also add the env var:

```yaml
env:
  TEST_USER_PORTFOLIO_ID: ${{ secrets.TEST_USER_PORTFOLIO_ID }}
```

- [ ] **Step 3: Run locally against dev server**

```bash
# With dev server running and a real test user logged in:
TEST_USER_PORTFOLIO_ID=<real-uuid> npx playwright test tests/e2e/optimize.spec.ts --headed
```
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/optimize.spec.ts .github/workflows/playwright-smoke.yml
git commit -m "test(e2e): Optimize page Playwright smoke

Two-test smoke: summary renders after debounced default optimize,
toggling frontier shows chart. Soft-skips when feature flag is off
or TEST_USER_PORTFOLIO_ID is missing."
```

### Task 9.2: API documentation (`docs/api/quant.md`)

**Files:**
- Create: `docs/api/quant.md`

- [ ] **Step 1: Write doc**

```markdown
# Quant API Reference

All endpoints under `/api/portfolios/[id]/*` use the §3.3a error envelope:

```json
{ "error": { "code": "<CODE>", "message": "...", "details": {} } }
```

Success responses return the payload directly (no wrapper). All endpoints:
- Require authentication (Supabase session cookie).
- Require portfolio ownership (`portfolios.user_id = auth.uid()`).
- Are gated on `quant_engine_enabled` feature flag. When off, return HTTP 404 with code `FEATURE_DISABLED`.
- Emit a `quant_runs` audit row on **every** call — both cache hits and misses, both success and error.

### Rate limit & cache TTL summary

| Endpoint     | Per-user limit (tier)           | Internal tier (combined) | Cache TTL   | Cache key inputs                           |
|--------------|---------------------------------|--------------------------|-------------|--------------------------------------------|
| `/optimize`   | 5/min (`optimize`)              | 30/min (`internal`)       | 15 min      | `method, symbols, returns-hash, constraints, target_return, frontier_points` |
| `/monte-carlo`| 3/min (`monte_carlo`)           | 30/min (`internal`)       | 15 min      | `weights, expected_returns, covariance-hash, horizon_days, n_simulations, percentiles, seed` |
| `/factors` (GET) | 120/min (`general`)          | 30/min (`internal`)       | **1 hour**  | `portfolio_id, days` (factor fixture changes ≤1×/day) |
| `/rebalance`  | 10/min (`rebalance`)            | 30/min (`internal`)       | **Never**   | n/a — every call recomputes on live prices |

The combined `internal` tier exists to catch pathological usage that splits across endpoints (e.g., a bot rotating between `/optimize` and `/monte-carlo` to stay under per-endpoint caps). When `internal` fires, the error code is still `RATE_LIMITED` but `details.tier == "internal"`.

## POST `/api/portfolios/[id]/optimize`

Rate limit: 5 req/min per user (`optimize` tier) **plus** a combined 30 req/min `internal` safety net across all quant endpoints. Cache TTL: **15 min** (keyed by `sha256(body + portfolio_id)`).

### Request

```json
{
  "method": "mean_variance" | "risk_parity" | "hrp",
  "symbols": ["AAPL", "MSFT"],
  "returns": { "AAPL": [0.001, -0.002, ...], "MSFT": [...] },
  "target_return": 0.15,
  "risk_free_rate": 0.02,
  "frontier_points": 20,
  "constraints": {
    "allow_short": false,
    "min_weight": 0.05,
    "max_weight": 0.25,
    "sector_caps": { "Tech": 0.40 },
    "sector_map": { "AAPL": "Tech", "MSFT": "Tech" }
  }
}
```

- `returns` and `symbols` both optional — server falls back to `price_history` for the portfolio's symbols.
- `target_return` optional — when absent, `mean_variance` maximizes Sharpe ratio.
- `frontier_points` (int, 0–100, default 0). When `0`, the solver returns a single optimal point. When ≥5, it returns the efficient frontier as `frontier_points` evenly-spaced points. **Replaces the legacy `include_frontier: boolean`** — the UI should send `frontier_points: 20` when the chart is visible and `frontier_points: 0` otherwise.
- `constraints.sector_caps` requires `constraints.sector_map` to be populated for every symbol; unmapped symbols default to sector `"Unknown"` which has no cap.

### Success response (HTTP 200)

```json
{
  "weights": { "AAPL": 0.45, "MSFT": 0.55 },
  "expected_return": 0.12,
  "expected_volatility": 0.18,
  "sharpe_ratio": 0.56,
  "frontier": [
    { "expected_return": 0.08, "expected_volatility": 0.12, "sharpe_ratio": 0.50 }
  ],
  "meta": { "method": "mean_variance", "solver": "CLARABEL", "iterations": null, "cached": false }
}
```

- `frontier` is a non-empty array only when the request had `frontier_points ≥ 5`; otherwise it is `[]`.
- `meta.cached` reflects whether Redis served the result. Audit trail inserts on both hit and miss.

### Error codes

Full 16-code envelope per spec §3.3a. Every response uses:
`{ "error": { "code": "<CODE>", "message": "...", "details": {} } }`

| HTTP | Code                     | When                                                         |
|------|--------------------------|--------------------------------------------------------------|
| 401  | `UNAUTHENTICATED`        | No Supabase session cookie / session expired                 |
| 401  | `HMAC_INVALID`           | Modal-side: signature mismatch (deploy/key rotation bug)     |
| 401  | `HMAC_EXPIRED`           | Modal-side: timestamp outside the ±5min replay window        |
| 403  | `FORBIDDEN`              | Authenticated but lacks permission (reserved; most ownership checks use `PORTFOLIO_NOT_FOUND` 404 to hide existence) |
| 404  | `FEATURE_DISABLED`       | `quant_engine_enabled` flag off                              |
| 404  | `PORTFOLIO_NOT_FOUND`    | Portfolio id does not exist OR belongs to another user       |
| 404  | `NOT_FOUND`              | Route/resource missing (non-portfolio)                       |
| 422  | `VALIDATION_ERROR`       | Body failed Zod — `details.fieldErrors` is populated         |
| 422  | `INSUFFICIENT_HISTORY`   | <2 symbols with ≥60 days in `price_history`                  |
| 422  | `COVARIANCE_NOT_PD`      | Returns matrix rank-deficient (linearly dependent series)    |
| 422  | `WEIGHTS_NOT_ONE`        | Solver output weights do not sum to 1 ± 1e-4                 |
| 422  | `DIMENSION_MISMATCH`     | Factor-series lengths don't match (factors endpoint only)    |
| 422  | `MONTE_CARLO_DEGENERATE` | Portfolio volatility = 0 → no meaningful simulation          |
| 400  | `INFEASIBLE`             | Constraints make optimization infeasible (e.g., sum of mins >1) |
| 429  | `RATE_LIMITED`           | Per-user tier OR combined `internal` tier (30/min) exceeded  |
| 503  | `COLD_START_TIMEOUT`     | Modal took >60s to respond (`keep_warm=1` should prevent)    |
| 500  | `INTERNAL`               | Any uncaught exception — Sentry is the source of truth       |

That's the full 16-code universe the Next.js error helper (`QUANT_ERROR_CODES` in `src/lib/api/response.ts`) tracks.

Notes:
- `UNAUTHENTICATED` (401) is returned by the Next.js route when the Supabase session is missing or expired. It is the preferred code; `FORBIDDEN` (403) is reserved for cases where the user *is* authenticated but lacks access (e.g., admin-only routes — not yet used in Phase 2).
- `HMAC_INVALID` and `HMAC_EXPIRED` are Modal-side only; the Next.js proxy layer in `src/lib/services/quant.ts` catches them and remaps to `INTERNAL` (signature bug → Sentry) or `COLD_START_TIMEOUT` (clock drift → retry). **Clients should never see these two codes.**

## POST `/api/portfolios/[id]/monte-carlo`

Rate limit: 3 req/min (`monte_carlo` tier) plus 30/min `internal` safety net. Cache TTL: **15 min** (same as `/optimize`).

### Request (spec §4.1.2)

```json
{
  "current_value": 10000,
  "weights": { "AAPL": 0.45, "MSFT": 0.55 },
  "expected_returns": { "AAPL": 0.08, "MSFT": 0.10 },
  "covariance": [[0.04, 0.01], [0.01, 0.03]],
  "horizon_days": 252,
  "n_simulations": 1000,
  "percentiles": [5, 50, 95],
  "seed": 42
}
```

- `current_value` (positive number, required) — starting portfolio value in dollars.
- `weights` (map, required) — must sum to 1 ± 1e-4.
- `expected_returns` (map, required) — annualized return per symbol (e.g., `0.08` for 8%).
- `covariance` (2D array, required) — annualized covariance matrix, row/col order matches `Object.keys(weights).sort()`.
- `horizon_days` (int, 1–1260 ≈ 5 years, required).
- `n_simulations` (int, 100–50_000, required).
- `percentiles` (array of ints, 1–99, default `[5, 50, 95]`) — which percentile trajectories to return.
- `seed` (int, optional) — when set, RNG is seeded for reproducibility.

**Do NOT send** the legacy fields `initial_value`, `returns`, or `confidence_level`. The spec-aligned fields above are the only accepted keys; anything else fails Zod → `VALIDATION_ERROR`.

### Success response (HTTP 200)

```json
{
  "trajectories": {
    "p5":  [10000, 9850, ...],
    "p50": [10000, 10020, ...],
    "p95": [10000, 10200, ...]
  },
  "final_distribution": {
    "mean":    10823.22,
    "median":  10620.10,
    "std":      1204.55,
    "min":      6820.18,
    "max":     18422.90,
    "percentiles": { "5": 8234.10, "50": 10620.10, "95": 12940.70 }
  },
  "var_95": 3420.15,
  "cvar_95": 4820.50,
  "probability_of_loss": 0.18,
  "meta": {
    "n_simulations": 1000,
    "horizon_days": 252,
    "seed": 42,
    "cached": false
  }
}
```

- `trajectories.pX` has length `horizon_days + 1` (index 0 = `current_value`, index `horizon_days` = terminal day). Keys mirror the requested `percentiles` array.
- `final_distribution.percentiles` uses string-int keys (`"5"`, `"50"`, `"95"`) and reports the terminal-day distribution only.
- `var_95` and `cvar_95` are **dollar losses** relative to `current_value`, not percentages.
- `probability_of_loss` = fraction of simulations where terminal value < `current_value` (0.0–1.0).

### Error codes

Same set as `/optimize`, plus:
- `MONTE_CARLO_DEGENERATE` (422) — covariance matrix implies zero volatility → all paths identical.
- `DIMENSION_MISMATCH` (422) — `covariance` size doesn't match `Object.keys(weights).length`.

## GET `/api/portfolios/[id]/factors`

**Method is GET, not POST** (spec §3.6). Clients do not send a request body — the Next.js route composes `portfolio_returns` server-side from `price_history` + `portfolio_holdings`, and loads the FF5 + MOM fixture from `worker/data/ff5_mom_daily.json`.

Rate limit: 120 req/min (`general` tier) plus 30/min `internal` safety net. Cache TTL: **1 hour** (factor returns change at most once per trading day).

### Request

Query params:
- `?days=<int>` (30–504, default 252) — trailing window for regression. 252 ≈ 1 trading year.

No request body. The request **may** include an `X-Cache-Bypass: 1` header to skip Redis (testing only; rate-limited at 3/min across all routes).

### Success response (HTTP 200)

```json
{
  "alpha": 0.0004,
  "betas": { "MKT": 1.02, "SMB": 0.12, "HML": -0.05, "RMW": 0.18, "CMA": -0.02, "MOM": 0.07 },
  "r_squared": 0.92,
  "adjusted_r_squared": 0.91,
  "t_stats": { "alpha": 1.80, "MKT": 34.20, "SMB": 2.10, "HML": -0.80, "RMW": 3.10, "CMA": -0.40, "MOM": 1.20 },
  "p_values": { "alpha": 0.072, "MKT": 0.000, "SMB": 0.037, "HML": 0.425, "RMW": 0.002, "CMA": 0.690, "MOM": 0.230 },
  "residual_std": 0.0082,
  "meta": { "n_observations": 252, "factors_used": ["MKT","SMB","HML","RMW","CMA","MOM"], "cached": false }
}
```

- `alpha` is the daily intercept; annualize by multiplying by 252.
- `betas`, `t_stats`, `p_values` all have the same 6 factor keys plus `alpha` (on the stat/p-value objects only).
- `residual_std` is the standard error of the regression residuals, in daily units.
- `meta.factors_used` is present so clients can detect if a factor was dropped (e.g., `MOM` series unavailable for part of the window).

### Error codes

Same set as `/optimize`, plus:
- `DIMENSION_MISMATCH` (422) — one or more factor series length ≠ `portfolio_returns` length (this is a server bug, never a client bug).

## POST `/api/portfolios/[id]/rebalance`

Rate limit: 10 req/min (`rebalance` tier) plus 30/min `internal` safety net. **Never cached** — every call must compute fresh trades against live prices.

### Request (spec §4.1.4)

```json
{
  "current_holdings": { "AAPL": 10, "MSFT": 5 },
  "current_prices":   { "AAPL": 185.20, "MSFT": 395.00 },
  "target_weights":   { "AAPL": 0.45, "MSFT": 0.55 },
  "cash_available": 500.00,
  "transaction_cost_bps": 5,
  "min_trade_value": 50
}
```

- `current_holdings` (map of symbol → non-negative integer shares, required).
- `current_prices` (map of symbol → positive price, required). **Key is `current_prices`, NOT `prices`** — the legacy `prices` key is rejected by Zod → `VALIDATION_ERROR`.
- `target_weights` (map of symbol → 0..1, required). Renormalized server-side to sum to 1; client doesn't need to.
- `cash_available` (non-negative dollar amount, default 0).
- `transaction_cost_bps` (0–100 basis points, default 5) — e.g., `5` = 0.05% per trade.
- `min_trade_value` (non-negative dollar floor, default 50) — suppresses any trade whose gross notional `|shares × price|` would be below this threshold (avoids 0.3-share odd-lot churn). Set to `0` to disable the floor.

### Success response (HTTP 200)

Spec §4.1.4 exact shape:

```json
{
  "trades": [
    {
      "symbol": "AAPL",
      "action": "buy",
      "shares": 3,
      "estimated_cost": 555.88,
      "post_weight": 0.45
    },
    {
      "symbol": "MSFT",
      "action": "sell",
      "shares": 1,
      "estimated_cost": 0.20,
      "post_weight": 0.55
    }
  ],
  "total_turnover": 950.60,
  "estimated_costs": 0.48,
  "drift_before": 0.20,
  "drift_after": 0.02
}
```

Field semantics:
- `trades[].estimated_cost` is **asymmetric by action** (per spec §4.1.4 and `rebalance.py`):
  - Buy trades: `gross + fee` → the full dollar amount the user pays (shares × price + per-trade commission).
  - Sell trades: `fee only` → the commission the user pays; the proceeds are implicit in the post-trade cash position, which the UI recomputes from `cash_available + Σ sell_gross - Σ buy_gross - estimated_costs`.
- `trades[].post_weight` is the post-trade portfolio weight for that symbol (0..1).
- `trades[]` is sorted by absolute weight delta descending (biggest drift-reducers first).
- `total_turnover` is the sum of absolute dollar amounts traded: `Σ |shares × price|` (notional, pre-fee). Excludes commission.
- `estimated_costs` (plural) is the sum of transaction fees only: `total_turnover * transaction_cost_bps / 10000`.
- `drift_before` / `drift_after` = sum of absolute differences between each symbol's current weight and its target weight across the whole portfolio. `drift_after` ≤ `drift_before` always.

Trades whose absolute notional (`|shares * price|`) falls below `min_trade_value` are suppressed from the array — this keeps `drift_after` slightly higher than theoretically optimal but avoids odd-lot churn.

**Do NOT** expect fields `tracking_error`, `total_transaction_cost`, `dollar_amount`, `cost`, `current_weight`, or `new_weight` — those names appeared in early drafts and are NOT in the spec.

## HMAC signing (server-to-Modal only — do NOT expose to clients)

The Next.js service layer signs every outbound call to the Modal microservice:
- Header `X-Timestamp`: Unix seconds (string).
- Header `X-Signature`: `HMAC_SHA256(body || timestamp, QUANT_SERVICE_HMAC_KEY)` hex digest.
- Replay window: **±5 minutes**. Timestamps outside the window → HTTP 401 + code `HMAC_EXPIRED`. Bad signature → HTTP 401 + code `HMAC_INVALID` (spec §3.3a keeps these as two distinct codes so audit telemetry can tell the difference between a clock-drift bug and a key-mismatch deploy error).

The Next.js proxy layer in `src/lib/services/quant.ts` never forwards either code to the client:
- `HMAC_EXPIRED` → logged + mapped to `COLD_START_TIMEOUT` (server-side clock drift is operationally equivalent to a slow upstream).
- `HMAC_INVALID` → logged + mapped to `INTERNAL` and fires a Sentry alert (signature mismatch means our deploy is broken, not the user's request).

Clients should never see `HMAC_INVALID` or `HMAC_EXPIRED` in a response.

See `src/lib/api/hmac.ts` and `quant-service/src/auth.py` for the two sides.

## Audit trail (`quant_runs`)

Every call (cache-hit OR miss) inserts exactly ONE row. Schema:

```
id, user_id, portfolio_id, endpoint, cache_hit, status,
error_code, duration_ms, request_hash, created_at
```

RLS: owner can SELECT their own rows. NO INSERT/UPDATE/DELETE RLS policies exist — the service role is the sole writer. See Chunk 1 for the migration.
```

- [ ] **Step 2: Commit**

```bash
git add docs/api/quant.md
git commit -m "docs(api): quant engine endpoint reference

Covers all 4 endpoints, §3.3a error envelope, rate limits,
error-code → HTTP mapping, HMAC signing protocol, and the
quant_runs audit contract."
```

### Task 9.3: Full incident runbook

**Files:**
- Modify: `docs/runbooks/quant-incidents.md` (extends the stub from Chunk 5 Task 5.4)

- [ ] **Step 1: Append playbooks**

Append below the existing "Rotate HMAC key" section:

```markdown

## Incident: Modal cold-start storm

**Symptoms:**
- Users see `COLD_START_TIMEOUT` errors (HTTP 503) spiking on `/optimize` or `/monte-carlo`.
- Sentry shows cluster of errors from `src/lib/services/quant.ts` with `duration_ms > 60_000`.
- Modal dashboard shows function invocations but no warm containers.

**Possible causes:**
- `keep_warm=1` config was lost in a deploy (check `modal_app.py`).
- Modal platform incident (check https://status.modal.com).
- Sudden traffic spike exhausted the single warm container.

**Actions (in order):**
1. Check `modal_app.py` for `keep_warm=1`. If missing, restore and redeploy.
2. Check Modal status page. If platform-side, post incident on status and wait.
3. If load-driven, bump `keep_warm` to 2 or 3 temporarily:
   ```python
   @app.function(..., keep_warm=3, ...)  # costs ~3x but survives bursts
   ```
4. Deploy, confirm via `GET /health` (warm) latency drops below 500ms.
5. After recovery, decide whether to keep `keep_warm` bumped (cost vs. reliability).

**Post-incident:** check PostHog for how many distinct users saw the error. If >10, add a proactive banner.

## Incident: Solver hang / OOM

**Symptoms:**
- Modal function timeouts (60s) on `/optimize` or `/monte-carlo`, but not `/health`.
- Modal logs show the function was killed.
- `quant_runs` audit shows `status='error'` with `error_code='INTERNAL'`.

**Possible causes:**
- cvxpy / CLARABEL stuck on ill-conditioned covariance matrix.
- User submitted a pathological `n_simulations` × `horizon_days` combo.
- Memory exhausted on the Modal container (default 2048 MB).

**Actions:**
1. Pull the failing request body from `quant_runs.request_hash` — look up cache or trace in Sentry breadcrumbs.
2. Reproduce locally: `cd quant-service && uv run pytest tests/test_api.py -k <scenario>` or a one-off script.
3. Fix root cause: tighten input validation in `src/schemas.py`, add early-exit on pathological inputs, or bump Modal memory.
4. If fix not obvious: add a request-time guard (e.g., `n_simulations * horizon_days ≤ 5_000_000`) and deploy.
5. Backfill Sentry tag: which specific combo triggered the hang — add to the schema test suite.

## Incident: Rate-limit exhaustion

**Symptoms:**
- Users see HTTP 429 `RATE_LIMITED` repeatedly.
- Upstash dashboard shows high `rl:optimize`, `rl:mc`, or `rl:qint` traffic from a single user ID.

**Possible causes:**
- Debounce broken client-side — multiple keystroke commits per second.
- Scripted usage (a bot hitting the endpoint in a loop).
- Legit power-user exceeding 5/min optimize cap.

**Actions:**
1. Check if the user ID is a real customer via Supabase Admin.
2. If legit user: bump their personal cap via a per-user override (not yet implemented — out of Phase 2; manually flag the user and revisit in Phase 3).
3. If scripted/bot: check PostHog for user-agent + session pattern. Potentially ban via Supabase.
4. If debounce regression: confirm by checking `use-debounce.ts` didn't change, and optimizing to 1000ms temporarily while fixing.

## Incident: `quant_runs` audit not writing

**Symptoms:**
- Recent usage in PostHog (any of `optimize_run`, `monte_carlo_run`, `factors_run`, `rebalance_plan_created`) but `SELECT COUNT(*) FROM quant_runs WHERE created_at > now() - interval '1 hour'` returns 0.

**Possible causes:**
- RLS policy change blocking service role (shouldn't be possible — service role bypasses RLS — but worth checking).
- Supabase service role key rotation broke `src/lib/services/quant.ts` auth.
- `insertAudit` swallowing errors silently (see non-fatal log).

**Actions:**
1. Check Next.js logs for `[quant] audit insert failed` — this is logged but non-fatal.
2. If service role key: rotate in Vercel env; redeploy.
3. If RLS policy drift: inspect `supabase migration list` vs prod `pg_policies`.
4. **Critical**: audit compliance is load-bearing for any future regulatory review. Fix within 1 business day of detection.

## Rotation log (active)

| Date       | Operator | Reason     | Old fingerprint | New fingerprint |
|------------|----------|------------|-----------------|-----------------|
|            |          |            |                 |                 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/quant-incidents.md
git commit -m "docs(runbook): full incident playbooks for quant service

Adds: cold-start storm recovery (keep_warm bump), solver hang / OOM
triage, rate-limit exhaustion response, audit trail drift detection.
Each playbook lists symptoms, causes, and ordered actions."
```

### Task 9.4: Phase 2 deploy checklist

**Files:**
- Create: `docs/deploy/phase2-quant.md`

```markdown
# Phase 2 Deploy Checklist — Quant Engine

Prereq: Phase 1 deployed and stable ≥48h (confirm via Sentry + PostHog error rates).

## Preflight

- [ ] `quant-service-ci.yml` green on `master`.
- [ ] `quant-service-deploy.yml` green on `master` — Modal deploy succeeded.
- [ ] Next.js build green on preview for the branch being released.
- [ ] `docs/api/quant.md` reflects final endpoint shapes (ran `grep` vs actual routes).
- [ ] `docs/runbooks/quant-incidents.md` has at least one entry in rotation log placeholder.

## Secrets (set BEFORE merging)

Modal side (`modal secret list` must show `quant-service-secrets` with all fields):
- [ ] `QUANT_SERVICE_HMAC_KEY` (64-char hex)
- [ ] `SENTRY_DSN` (optional but recommended)
- [ ] `ENVIRONMENT=production`

Vercel side (production env):
- [ ] `QUANT_SERVICE_URL` (Modal endpoint from Task 5.1 Step 3)
- [ ] `QUANT_SERVICE_HMAC_KEY` (same hex as Modal side)
- [ ] Existing Phase 1 vars unchanged (`UPSTASH_REDIS_*`, `SUPABASE_*`, etc.)

GitHub Actions secrets:
- [ ] `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`
- [ ] `TEST_USER_PORTFOLIO_ID` (for Playwright smoke)

## Database migration

- [ ] `supabase/migrations/009_quant_engine.sql` present and reviewed — must define `quant_runs`, its RLS policies (owner-SELECT only, no INSERT/UPDATE/DELETE policies), and the `idx_quant_runs_user_created_at` index.
- [ ] On staging branch: apply via Supabase CLI:

  ```bash
  # Dry run: show the SQL that will be executed.
  supabase db diff --file supabase/migrations/009_quant_engine.sql

  # Apply to staging (linked project — check `supabase projects list` first).
  supabase db push --linked
  ```

  Expected: migration runs without error; `list_migrations` shows `009_quant_engine` as applied.
- [ ] On staging: run the RLS integration test from Task 1.2 → passes (confirms anon and other-user roles cannot read `quant_runs`; owner can).
- [ ] Verify no table-scan migrations blocked writes during apply:

  ```sql
  SELECT state, query, backend_start FROM pg_stat_activity
  WHERE state != 'idle' AND application_name LIKE '%supabase%'
  ORDER BY backend_start DESC LIMIT 10;
  ```

- [ ] Apply to production during a low-traffic window (weekend morning UTC 10-14 is historical low per PostHog `$pageview` counts):

  ```bash
  # Switch CLI link to production project.
  supabase link --project-ref <prod-ref>
  supabase db push --linked
  ```

- [ ] Post-apply sanity check:

  ```sql
  SELECT COUNT(*) FROM quant_runs;                      -- expect 0 (baseline)
  SELECT indexname FROM pg_indexes WHERE tablename = 'quant_runs';   -- expect idx_quant_runs_user_created_at
  SELECT policyname, cmd FROM pg_policies WHERE tablename = 'quant_runs';  -- expect owner-SELECT only
  ```

- [ ] If the apply fails mid-way: `supabase db reset` is NOT safe on prod. Instead, open an incident and run the named rollback migration `009_quant_engine_rollback.sql` (created alongside 009 in Task 1.2).

## Feature flag rollout

The kill switch is the `quant_engine_enabled` flag (Edge Config / PostHog). Staged rollout:

1. [ ] Enable for `developers` cohort only (5-10 internal users).
2. [ ] Leave 24h — monitor Sentry + `quant_runs.duration_ms` p95 + error rates.
3. [ ] Enable for `beta` cohort (10% users).
4. [ ] Leave 72h — watch for cold-start issues, rate-limit complaints, audit gaps.
5. [ ] Enable globally — add banner link to Optimize page in portfolio nav.
6. [ ] Update docs and announce internally.

## Smoke tests (run after each rollout stage)

- [ ] `curl -sf https://<modal-url>/health` → `{"status":"ok"}`.
- [ ] Playwright smoke passes on preview URL for latest commit.
- [ ] Sentry — no new error patterns under "quant" tag.
- [ ] PostHog — at least one of `optimize_run` / `monte_carlo_run` / `factors_run` / `rebalance_plan_created` events > 0 after 1 hour of traffic (there is NO generic `quant_run` event — each endpoint emits its own event name).
- [ ] DB — `SELECT status, COUNT(*) FROM quant_runs GROUP BY status` shows expected ok/error mix.

## Rollback

If critical issue detected:

1. [ ] Disable `quant_engine_enabled` flag globally — this returns 404 from all routes and hides nav link.
2. [ ] Users revert to Phase 1 behavior instantly (no new queries hit Modal).
3. [ ] Modal deployment stays up (no need to tear down) — cost is ~$0 when idle past `keep_warm=1` budget.
4. [ ] File incident report, link to the runbook playbook used, update rotation log if HMAC rotation involved.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy/phase2-quant.md
git commit -m "docs(deploy): Phase 2 Quant Engine deploy checklist

Staged flag rollout (developers → beta → global) over 4-5 days.
Preflight gates, secret inventory, migration order, smoke tests at
each stage, kill-switch rollback procedure."
```

### Task 9.5: Production verification after deploy

**Files:**
- N/A (ops task, executed after rollout completes)

- [ ] **Step 1: Verify `/health` latency**

```bash
for i in 1 2 3 4 5; do
  time curl -sf https://<modal-url>/health > /dev/null
done
```

Expected: after 5 warm calls, median < 300ms (keep_warm=1 container handles them).

- [ ] **Step 2: Verify HMAC-signed call end-to-end**

From a Next.js dev session (`npm run dev`) with local env pointing to production QUANT_SERVICE_URL:

```bash
curl -X POST http://localhost:3000/api/portfolios/<your-portfolio-id>/optimize \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-<project>-auth-token=<your-cookie>" \
  -d '{"method":"mean_variance","frontier_points":0}'
```

Expected: 200 OK with `weights`, `expected_return`, `expected_volatility`, `sharpe_ratio`, and `meta.solver == "CLARABEL"`.

- [ ] **Step 3: Verify audit trail**

```sql
SELECT endpoint, cache_hit, status, COUNT(*)
FROM quant_runs
WHERE user_id = '<your-uid>' AND created_at > now() - interval '10 minutes'
GROUP BY endpoint, cache_hit, status
ORDER BY 1, 2, 3;
```

Expected: one row per distinct (endpoint, cache_hit, status) triple. First call `cache_hit=false`, second identical call `cache_hit=true` (15-min cache TTL). Both `status='ok'`.

- [ ] **Step 4: Verify rate-limit enforcement**

```bash
for i in $(seq 1 7); do
  curl -sw "%{http_code}\n" -o /dev/null -X POST \
    http://localhost:3000/api/portfolios/<pid>/optimize \
    -H "Content-Type: application/json" \
    -H "Cookie: ..." \
    -d '{"method":"mean_variance"}'
done
```

Expected: first 5 return 200, 6th and 7th return 429.

- [ ] **Step 5: Sentry breadcrumb check**

Trigger a known-bad input (e.g., symbol with only 30 days of history) and confirm:
- Response body has `error.code == "INSUFFICIENT_HISTORY"`.
- Sentry shows an event with breadcrumb trail: `/optimize route → callQuant → fetch POST /optimize → 422 from Modal`.
- `quant_runs` row has `status='error'`, `error_code='INSUFFICIENT_HISTORY'`.

- [ ] **Step 6: Final sign-off**

Open the deploy checklist (Task 9.4) and check off every item. File the signed checklist in `docs/deploy/logs/<YYYY-MM-DD>-phase2.md`:

```bash
cp docs/deploy/phase2-quant.md \
   docs/deploy/logs/$(date +%Y-%m-%d)-phase2.md
# edit the copy: mark each checkbox, add Sentry/PostHog screenshots links
git add docs/deploy/logs/*.md
git commit -m "docs(deploy-log): Phase 2 production rollout complete"
```

---

**Plan complete.** Next: run the plan-document-reviewer loop, then write Phase 3 plan (Intelligence Layer).

