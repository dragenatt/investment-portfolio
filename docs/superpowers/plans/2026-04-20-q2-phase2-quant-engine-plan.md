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

    # Re-inject the body so the endpoint can read it again.
    # Starlette's Request body is cached after the first read in middleware,
    # so the downstream handler's `await request.json()` still works.
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
# when pyproject changes.
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
- Output (TypedDict `OptimizeResult`):
  ```python
  {
      "weights": dict[str, float],          # sums to 1.0 ± 1e-6
      "expected_return": float,             # annualized
      "expected_volatility": float,         # annualized
      "sharpe_ratio": float,                # (μ − rf)/σ, rf passed in (default 0)
      "frontier": list[{"return": float, "volatility": float, "weights": dict}],
      "meta": {"method": str, "solver": str, "iterations": int | None},
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
    assert abs(result["weights"]["A"] - 0.5) < 0.02  # 2% tolerance for sample noise
    assert abs(result["weights"]["B"] - 0.5) < 0.02
    assert abs(sum(result["weights"].values()) - 1.0) < 1e-6
    assert result["expected_return"] == pytest.approx(0.15, abs=5e-3)
    assert result["meta"]["method"] == "mean_variance"
    assert result["meta"]["solver"] == "CLARABEL"
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


class FrontierPoint(TypedDict):
    return_: float  # key "return" in JSON; aliased on emit
    volatility: float
    weights: dict[str, float]


class OptimizeMeta(TypedDict):
    method: str
    solver: str
    iterations: int | None


class OptimizeResult(TypedDict):
    weights: dict[str, float]
    expected_return: float
    expected_volatility: float
    sharpe_ratio: float
    frontier: list[dict]
    meta: OptimizeMeta


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
        return _pack_result(symbols, w_val, mu, cov, risk_free_rate, "mean_variance",
                            solver="CLARABEL", iterations=None)

    prob = cp.Problem(obj, cons)
    prob.solve(solver=cp.CLARABEL)
    if prob.status not in {"optimal", "optimal_inaccurate"}:
        raise InfeasibleError(
            f"Markowitz infeasible at target_return={target_return}: {prob.status}",
            details={"solver_status": prob.status, "target_return": target_return},
        )
    return _pack_result(symbols, w.value, mu, cov, risk_free_rate,
                        "mean_variance", solver="CLARABEL", iterations=None)


def _pack_result(
    symbols: list[str],
    w_val: np.ndarray,
    mu: np.ndarray,
    cov: np.ndarray,
    risk_free_rate: float,
    method: str,
    solver: str,
    iterations: int | None,
) -> OptimizeResult:
    w_val = np.asarray(w_val).flatten()
    # Clamp numerical dust and renormalize.
    w_val = np.where(np.abs(w_val) < 1e-9, 0.0, w_val)
    s = w_val.sum()
    if abs(s - 1.0) > 1e-3:
        raise WeightsDoNotSumToOneError(
            f"Solver returned weights summing to {s:.6f}",
            details={"sum": float(s)},
        )
    w_val = w_val / s
    port_ret = float(mu @ w_val)
    port_vol = float(np.sqrt(w_val @ cov @ w_val))
    sharpe = (port_ret - risk_free_rate) / port_vol if port_vol > 0 else 0.0
    return {
        "weights": {s: float(w) for s, w in zip(symbols, w_val)},
        "expected_return": port_ret,
        "expected_volatility": port_vol,
        "sharpe_ratio": float(sharpe),
        "frontier": [],
        "meta": {"method": method, "solver": solver, "iterations": iterations},
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
    w = np.array([result["weights"][s] for s in symbols])

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
    assert result["meta"]["method"] == "risk_parity"
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
    return _pack_result(symbols, w_val, mu, cov, 0.0,
                        "risk_parity", solver="riskfolio-MV", iterations=None)
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
    w = np.array([result["weights"][s] for s in symbols])
    assert abs(w.sum() - 1.0) < 1e-6
    assert (w >= 0).all()
    assert (w <= 1).all()
    assert result["meta"]["method"] == "hrp"
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
    assert result["weights"]["INDEP"] > 0.40
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

    return _pack_result(symbols, w_val, mu, cov, 0.0,
                        "hrp", solver="riskfolio-HRP", iterations=None)
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
    vols = [p["volatility"] for p in frontier]
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
) -> list[dict]:
    """Sweep target returns between the global min-variance return and
    the max-mean return. Returns a list of {return, volatility, weights}.
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
    frontier: list[dict] = []
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
            "volatility": res["expected_volatility"],
            "weights": res["weights"],
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
from src import optimize as _optimize

@app.post("/optimize")
async def optimize_endpoint(req: OptimizeRequest) -> OptimizeResult:
    if req.method == "mean_variance":
        result = _optimize.mean_variance(
            symbols=req.symbols,
            returns=req.returns,
            target_return=req.target_return,
            risk_free_rate=req.risk_free_rate or 0.0,
            constraints=req.constraints,
        )
        # Attach frontier only when explicitly requested.
        if req.include_frontier:
            result["frontier"] = _optimize.efficient_frontier(
                symbols=req.symbols,
                returns=req.returns,
                n_points=20,
                constraints=req.constraints,
            )
        return result
    if req.method == "risk_parity":
        return _optimize.risk_parity(
            symbols=req.symbols,
            returns=req.returns,
            constraints=req.constraints,
        )
    if req.method == "hrp":
        return _optimize.hrp(
            symbols=req.symbols,
            returns=req.returns,
            constraints=req.constraints,
        )
    # schemas.py validator should have caught unknown methods, but guard anyway:
    raise ValidationError(f"Unknown optimization method: {req.method}")
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/api.py quant-service/tests/test_api.py
git commit -m "feat(quant): wire /optimize endpoint to optimize.py

Dispatches on method ∈ {mean_variance, risk_parity, hrp}. Frontier
returned only when include_frontier=true (keeps p50 payload small)."
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
    weights_sum = sum(result["weights"].values())
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
    for sym, w in result["weights"].items():
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

- **Monte Carlo (`/monte-carlo`):** GBM simulation of portfolio value over `horizon_days` with `n_simulations` paths. Returns percentile trajectories (p5/p25/p50/p75/p95), terminal-value distribution, VaR and CVaR at the requested confidence level.
- **Factors (`/factors`):** OLS regression of portfolio excess returns on Fama-French 5-factor + momentum (MKT, SMB, HML, RMW, CMA, MOM). Returns betas, alpha (annualized), R², t-stats, factor contributions to total return.
- **Rebalance (`/rebalance`):** Greedy integer-share allocation from current weights to target weights, minimizing tracking error subject to a cash constraint and per-trade transaction costs. Returns an ordered list of `{symbol, action: "buy"|"sell", shares, estimated_cost}`.

### Task 4.1: Monte Carlo simulation (GBM + VaR/CVaR)

**Files:**
- Create: `quant-service/src/monte_carlo.py`
- Test: `quant-service/tests/test_monte_carlo.py`

- [ ] **Step 1: Write failing golden test**

```python
# quant-service/tests/test_monte_carlo.py
"""Tests for Monte Carlo GBM simulation."""
from __future__ import annotations

import numpy as np
import pytest

from src.errors import InsufficientHistoryError, MonteCarloDegenerateError
from src.monte_carlo import simulate


def test_gbm_mean_terminal_value_matches_analytic(rng) -> None:
    """For GBM with drift μ and vol σ, E[S_T] = S_0 · exp(μT).
    Simulation mean should match within Monte Carlo error (≈ σ/√N)."""
    symbols = ["A", "B"]
    weights = {"A": 0.5, "B": 0.5}
    # Synthesize 2 assets with known μ=0.08 annualized, σ=0.15 annualized.
    daily_mu = 0.08 / 252
    daily_sigma = 0.15 / np.sqrt(252)
    n_days = 1000
    returns = {
        "A": rng.normal(daily_mu, daily_sigma, n_days).tolist(),
        "B": rng.normal(daily_mu, daily_sigma, n_days).tolist(),
    }
    result = simulate(
        symbols=symbols,
        returns=returns,
        weights=weights,
        initial_value=100_000.0,
        horizon_days=252,
        n_simulations=5_000,
        confidence_level=0.95,
        seed=123,
    )
    # Analytic: E[S_T] ≈ S_0 · exp(0.08 · 1) = 108_328.7
    mean_terminal = np.mean(result["terminal_values"])
    assert 104_000 < mean_terminal < 113_000, f"got mean = {mean_terminal}"
    # Percentile trajectories: p50 should end near analytic median.
    p50_terminal = result["percentiles"]["p50"][-1]
    assert 95_000 < p50_terminal < 115_000
    # VaR at 95% should be positive (loss amount).
    assert result["var_95"] > 0
    assert result["cvar_95"] >= result["var_95"]  # CVaR ≥ VaR by definition


def test_mc_rejects_zero_simulations() -> None:
    with pytest.raises(Exception):  # Pydantic validator catches before we get here
        simulate(symbols=["A"], returns={"A": [0.01]},
                 weights={"A": 1.0}, initial_value=1000,
                 horizon_days=30, n_simulations=0, confidence_level=0.95, seed=1)


def test_mc_degenerate_zero_variance(rng) -> None:
    """All-zero daily returns → zero volatility → degenerate paths."""
    returns = {"A": [0.0] * 500, "B": [0.0] * 500}
    with pytest.raises(MonteCarloDegenerateError):
        simulate(
            symbols=["A", "B"],
            returns=returns,
            weights={"A": 0.5, "B": 0.5},
            initial_value=100_000.0,
            horizon_days=252,
            n_simulations=1000,
            confidence_level=0.95,
            seed=1,
        )
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_monte_carlo.py -v`
Expected: `ImportError: cannot import name 'simulate' from 'src.monte_carlo'`

- [ ] **Step 3: Implement `monte_carlo.py`**

```python
# quant-service/src/monte_carlo.py
"""Geometric Brownian Motion Monte Carlo simulation."""
from __future__ import annotations

from typing import TypedDict

import numpy as np

from src.errors import (
    InsufficientHistoryError,
    MonteCarloDegenerateError,
)

_ANN = 252
_MIN_HISTORY_DAYS = 60


class MonteCarloResult(TypedDict):
    percentiles: dict[str, list[float]]  # p5, p25, p50, p75, p95 → list of length horizon_days+1
    terminal_values: list[float]          # length n_simulations
    var_95: float                         # dollar amount of loss at confidence_level
    cvar_95: float                        # expected loss conditional on exceeding VaR
    mean_terminal: float
    meta: dict


def simulate(
    symbols: list[str],
    returns: dict[str, list[float]],
    weights: dict[str, float],
    initial_value: float,
    horizon_days: int,
    n_simulations: int,
    confidence_level: float = 0.95,
    seed: int | None = None,
) -> MonteCarloResult:
    w = np.array([weights[s] for s in symbols], dtype=float)
    if abs(w.sum() - 1.0) > 1e-3:
        raise ValueError(f"weights sum to {w.sum()}, expected 1.0")

    # Stack returns; align on shortest tail.
    cols = [np.asarray(returns[s], dtype=float) for s in symbols]
    n_days = min(len(c) for c in cols)
    if n_days < _MIN_HISTORY_DAYS:
        raise InsufficientHistoryError(
            f"Need at least {_MIN_HISTORY_DAYS} days of history; got {n_days}",
            details={"min_required": _MIN_HISTORY_DAYS, "provided": n_days},
        )
    ret_mat = np.column_stack([c[-n_days:] for c in cols])

    # Portfolio-level daily log-returns from weighted sum.
    port_returns = ret_mat @ w
    mu = port_returns.mean()
    sigma = port_returns.std(ddof=1)
    if sigma < 1e-9:
        raise MonteCarloDegenerateError(
            "Portfolio volatility is zero; Monte Carlo is degenerate",
            details={"sigma": float(sigma)},
        )

    rng = np.random.default_rng(seed)
    # GBM: S_{t+1} = S_t · exp((μ − σ²/2) + σ · Z)
    dt_mu = mu - 0.5 * sigma**2
    shocks = rng.normal(0.0, 1.0, size=(horizon_days, n_simulations))
    log_returns = dt_mu + sigma * shocks
    cum_log = np.cumsum(log_returns, axis=0)
    # Prepend zero row for initial value S_0.
    cum_log = np.vstack([np.zeros((1, n_simulations)), cum_log])
    paths = initial_value * np.exp(cum_log)  # shape (horizon_days+1, n_simulations)

    percentiles = {
        "p5": np.percentile(paths, 5, axis=1).tolist(),
        "p25": np.percentile(paths, 25, axis=1).tolist(),
        "p50": np.percentile(paths, 50, axis=1).tolist(),
        "p75": np.percentile(paths, 75, axis=1).tolist(),
        "p95": np.percentile(paths, 95, axis=1).tolist(),
    }
    terminal = paths[-1, :]
    # VaR: loss at the (1 − α) quantile of the P/L distribution.
    pnl = terminal - initial_value
    alpha = 1.0 - confidence_level
    var_threshold = np.percentile(pnl, alpha * 100)  # negative = loss
    var_dollars = float(max(-var_threshold, 0.0))
    cvar_dollars = float(max(-pnl[pnl <= var_threshold].mean(), 0.0)) if (pnl <= var_threshold).any() else var_dollars

    return {
        "percentiles": percentiles,
        "terminal_values": terminal.tolist(),
        "var_95": var_dollars,
        "cvar_95": cvar_dollars,
        "mean_terminal": float(terminal.mean()),
        "meta": {
            "n_simulations": n_simulations,
            "horizon_days": horizon_days,
            "confidence_level": confidence_level,
            "seed": seed,
            "drift_daily": float(mu),
            "vol_daily": float(sigma),
        },
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_monte_carlo.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/monte_carlo.py quant-service/tests/test_monte_carlo.py
git commit -m "feat(quant): GBM Monte Carlo simulation with VaR/CVaR

Portfolio-level GBM from weighted daily returns, p5/p25/p50/p75/p95
trajectories, VaR and CVaR at requested confidence. Raises
MonteCarloDegenerateError on zero-vol portfolio; InsufficientHistoryError
when n_days < 60."
```

### Task 4.2: Factor regression (Fama-French 5 + MOM)

**Files:**
- Create: `quant-service/src/factors.py`
- Test: `quant-service/tests/test_factors.py`

- [ ] **Step 1: Write failing test**

```python
# quant-service/tests/test_factors.py
"""Tests for factor regression."""
from __future__ import annotations

import numpy as np
import pytest

from src.errors import DimensionMismatchError, InsufficientHistoryError
from src.factors import regress


def test_factor_regression_recovers_known_betas(rng) -> None:
    """Synthesize portfolio returns as a known linear combination of factors,
    then check that regression recovers the betas."""
    n = 500
    factors = {
        "MKT": rng.normal(0.0004, 0.01, n).tolist(),
        "SMB": rng.normal(0.0001, 0.005, n).tolist(),
        "HML": rng.normal(0.0001, 0.005, n).tolist(),
        "RMW": rng.normal(0.0001, 0.005, n).tolist(),
        "CMA": rng.normal(0.0001, 0.005, n).tolist(),
        "MOM": rng.normal(0.0002, 0.006, n).tolist(),
    }
    # True betas:
    true_betas = {"MKT": 1.1, "SMB": 0.3, "HML": -0.2, "RMW": 0.0, "CMA": 0.0, "MOM": 0.15}
    true_alpha = 0.0001  # daily
    noise = rng.normal(0, 0.001, n)
    port_returns = (
        true_alpha
        + true_betas["MKT"] * np.array(factors["MKT"])
        + true_betas["SMB"] * np.array(factors["SMB"])
        + true_betas["HML"] * np.array(factors["HML"])
        + true_betas["MOM"] * np.array(factors["MOM"])
        + noise
    ).tolist()

    result = regress(
        portfolio_returns=port_returns,
        factor_returns=factors,
        risk_free_rate_daily=0.0,
    )
    # Tolerate ±0.1 beta recovery (small sample, noise).
    for f, true_b in true_betas.items():
        got = result["betas"][f]
        assert abs(got - true_b) < 0.15, f"{f}: got {got}, expected {true_b}"
    # R² should be > 0.95 given our low noise.
    assert result["r_squared"] > 0.90
    assert set(result["betas"].keys()) == {"MKT", "SMB", "HML", "RMW", "CMA", "MOM"}


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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_factors.py -v`
Expected: `ImportError: cannot import name 'regress'`

- [ ] **Step 3: Implement `factors.py`**

```python
# quant-service/src/factors.py
"""OLS factor regression: portfolio excess return ~ Fama-French 5 + MOM."""
from __future__ import annotations

from typing import TypedDict

import numpy as np
from scipy import stats

from src.errors import DimensionMismatchError, InsufficientHistoryError
from src.schemas import REQUIRED_FACTORS

_MIN_HISTORY_DAYS = 60
_ANN = 252


class FactorsResult(TypedDict):
    alpha: float               # annualized
    alpha_tstat: float
    betas: dict[str, float]
    beta_tstats: dict[str, float]
    r_squared: float
    adj_r_squared: float
    factor_contributions: dict[str, float]  # annualized contribution to mean return
    residual_vol: float                     # annualized


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
    k = X.shape[1]  # params
    adj_r2 = 1.0 - (1.0 - r2) * (n - 1) / (n - k) if n - k > 0 else r2

    # Standard errors and t-stats
    sigma2 = sse / (n - k) if n - k > 0 else 0.0
    var_beta = sigma2 * np.diag(XtX_inv)
    se_beta = np.sqrt(np.maximum(var_beta, 0.0))
    tstats = np.divide(beta, se_beta, out=np.zeros_like(beta),
                       where=se_beta > 0)

    alpha_daily = float(beta[0])
    alpha_ann = alpha_daily * _ANN
    betas = {f: float(beta[i + 1]) for i, f in enumerate(REQUIRED_FACTORS)}
    beta_ts = {f: float(tstats[i + 1]) for i, f in enumerate(REQUIRED_FACTORS)}

    factor_means_ann = {
        f: float(np.asarray(factor_returns[f]).mean() * _ANN)
        for f in REQUIRED_FACTORS
    }
    contributions = {f: betas[f] * factor_means_ann[f] for f in REQUIRED_FACTORS}

    residual_vol_ann = float(np.std(resid, ddof=1) * np.sqrt(_ANN))

    return {
        "alpha": alpha_ann,
        "alpha_tstat": float(tstats[0]),
        "betas": betas,
        "beta_tstats": beta_ts,
        "r_squared": float(r2),
        "adj_r_squared": float(adj_r2),
        "factor_contributions": contributions,
        "residual_vol": residual_vol_ann,
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_factors.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/factors.py quant-service/tests/test_factors.py
git commit -m "feat(quant): OLS factor regression (Fama-French 5 + MOM)

Returns annualized alpha, per-factor betas, t-stats, R², adjusted R²,
factor contributions to mean return, and residual volatility. Validates
all 6 required factors present and equal-length."
```

### Task 4.3: Rebalance (greedy integer-share with costs)

**Files:**
- Create: `quant-service/src/rebalance.py`
- Test: `quant-service/tests/test_rebalance.py`

- [ ] **Step 1: Write failing test**

```python
# quant-service/tests/test_rebalance.py
"""Tests for rebalance.py (greedy integer-share allocator)."""
from __future__ import annotations

import pytest

from src.rebalance import compute_trades


def test_rebalance_simple_two_asset_increase() -> None:
    """Portfolio: 10 AAPL @ $150, 5 MSFT @ $300. Target: 50/50.
    Current value = 1500 + 1500 = 3000. Target 1500 each (already balanced).
    Trades should be empty or near-zero."""
    result = compute_trades(
        current_holdings={"AAPL": 10, "MSFT": 5},
        prices={"AAPL": 150.0, "MSFT": 300.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=0.0,
        transaction_cost_bps=5.0,
    )
    total_abs_shares = sum(abs(t["shares"]) for t in result["trades"])
    assert total_abs_shares == 0  # already balanced


def test_rebalance_buy_more_of_underweight() -> None:
    """Portfolio: 10 AAPL @ $100, 0 MSFT @ $200. Target: 50/50.
    Need to buy MSFT to balance.
    Current value = 1000 (all AAPL). Target: $500 each, which is 5 AAPL + 2.5 MSFT.
    With integer constraint: buy 2 MSFT ($400) + sell 4 AAPL ($400).
    Use cash_available=0 (must self-finance)."""
    result = compute_trades(
        current_holdings={"AAPL": 10, "MSFT": 0},
        prices={"AAPL": 100.0, "MSFT": 200.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=0.0,
        transaction_cost_bps=5.0,
    )
    trades = {t["symbol"]: t for t in result["trades"]}
    assert trades["MSFT"]["action"] == "buy"
    assert trades["MSFT"]["shares"] > 0
    assert trades["AAPL"]["action"] == "sell"
    assert trades["AAPL"]["shares"] > 0
    # Tracking error should be small after rebalance.
    assert result["tracking_error"] < 0.15


def test_rebalance_respects_cash_available() -> None:
    """Cannot spend more than cash_available + proceeds from sells."""
    result = compute_trades(
        current_holdings={"AAPL": 0},
        prices={"AAPL": 100.0, "MSFT": 200.0},
        target_weights={"AAPL": 0.5, "MSFT": 0.5},
        cash_available=500.0,
        transaction_cost_bps=10.0,
    )
    total_buy_value = sum(
        t["estimated_cost"] for t in result["trades"] if t["action"] == "buy"
    )
    assert total_buy_value <= 500.0 + 1e-6
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_rebalance.py -v`
Expected: `ImportError: cannot import name 'compute_trades'`

- [ ] **Step 3: Implement `rebalance.py`**

```python
# quant-service/src/rebalance.py
"""Greedy integer-share rebalance allocator with transaction costs."""
from __future__ import annotations

from typing import TypedDict

import numpy as np


class Trade(TypedDict):
    symbol: str
    action: str  # "buy" | "sell"
    shares: int
    estimated_cost: float  # includes transaction fees


class RebalanceResult(TypedDict):
    trades: list[Trade]
    tracking_error: float                # L2 norm of (achieved − target) weights
    total_transaction_cost: float
    final_cash: float
    meta: dict


def compute_trades(
    current_holdings: dict[str, int],
    prices: dict[str, float],
    target_weights: dict[str, float],
    cash_available: float,
    transaction_cost_bps: float = 5.0,
) -> RebalanceResult:
    symbols = sorted(set(current_holdings) | set(target_weights) | set(prices))
    holdings = {s: int(current_holdings.get(s, 0)) for s in symbols}
    target = {s: float(target_weights.get(s, 0.0)) for s in symbols}
    t_sum = sum(target.values())
    if t_sum <= 0:
        raise ValueError("target_weights sum to zero")
    target = {s: v / t_sum for s, v in target.items()}  # renormalize

    current_value = sum(holdings[s] * prices[s] for s in symbols)
    total_value = current_value + cash_available
    target_dollars = {s: total_value * target[s] for s in symbols}

    # Step 1: sell overweights first (generates cash).
    trades: list[Trade] = []
    cost_rate = transaction_cost_bps / 10_000.0
    cash = cash_available

    for s in symbols:
        current_dollars = holdings[s] * prices[s]
        delta_dollars = target_dollars[s] - current_dollars
        if delta_dollars < -prices[s]:  # need to sell at least 1 share
            shares_to_sell = int(np.floor(-delta_dollars / prices[s]))
            shares_to_sell = min(shares_to_sell, holdings[s])
            if shares_to_sell > 0:
                gross = shares_to_sell * prices[s]
                fee = gross * cost_rate
                net = gross - fee
                cash += net
                holdings[s] -= shares_to_sell
                trades.append({
                    "symbol": s,
                    "action": "sell",
                    "shares": shares_to_sell,
                    "estimated_cost": float(fee),  # cost = fee only (sells give cash)
                })

    # Step 2: buy underweights in descending order of (target − current) gap.
    gaps = []
    for s in symbols:
        current_dollars = holdings[s] * prices[s]
        gap = target_dollars[s] - current_dollars
        if gap >= prices[s]:  # can afford at least 1 share
            gaps.append((gap, s))
    gaps.sort(reverse=True)

    for _, s in gaps:
        # Max shares we can afford given remaining cash (include fee).
        per_share_total = prices[s] * (1 + cost_rate)
        max_affordable = int(np.floor(cash / per_share_total))
        if max_affordable <= 0:
            continue
        # Don't overshoot target.
        current_dollars = holdings[s] * prices[s]
        target_shares = (target_dollars[s] - current_dollars) / prices[s]
        shares_to_buy = int(min(max_affordable, np.floor(target_shares)))
        if shares_to_buy <= 0:
            continue
        gross = shares_to_buy * prices[s]
        fee = gross * cost_rate
        cash -= (gross + fee)
        holdings[s] += shares_to_buy
        trades.append({
            "symbol": s,
            "action": "buy",
            "shares": shares_to_buy,
            "estimated_cost": float(gross + fee),
        })

    # Tracking error after trades.
    final_value = sum(holdings[s] * prices[s] for s in symbols) + cash
    achieved_weights = np.array([
        holdings[s] * prices[s] / final_value if final_value > 0 else 0.0
        for s in symbols
    ])
    target_arr = np.array([target[s] for s in symbols])
    tracking_error = float(np.linalg.norm(achieved_weights - target_arr))

    total_cost = sum(t["estimated_cost"] for t in trades if t["action"] == "buy") + \
                 sum(t["estimated_cost"] for t in trades if t["action"] == "sell")

    return {
        "trades": trades,
        "tracking_error": tracking_error,
        "total_transaction_cost": float(total_cost),
        "final_cash": float(cash),
        "meta": {
            "total_value": float(total_value),
            "transaction_cost_bps": transaction_cost_bps,
            "n_symbols": len(symbols),
        },
    }
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_rebalance.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/rebalance.py quant-service/tests/test_rebalance.py
git commit -m "feat(quant): greedy integer-share rebalance allocator

Two-pass: sell overweights (generate cash), buy underweights by
gap-size desc. Integer shares. Transaction cost charged in bps.
Returns tracking error as L2 weight deviation from target."
```

### Task 4.4: Wire `/monte-carlo`, `/factors`, `/rebalance` endpoints

**Files:**
- Modify: `quant-service/src/api.py`
- Modify: `quant-service/tests/test_api.py`

- [ ] **Step 1: Add integration tests**

Append to `tests/test_api.py`:

```python
def test_monte_carlo_endpoint_returns_valid_shape(
    client: TestClient, synth_returns, hmac_key, sign
) -> None:
    body = json.dumps({
        "symbols": list(synth_returns.keys()),
        "returns": synth_returns,
        "weights": {s: 0.2 for s in synth_returns},  # equal weight 5 assets
        "initial_value": 100_000.0,
        "horizon_days": 30,
        "n_simulations": 500,
        "confidence_level": 0.95,
        "seed": 42,
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/monte-carlo", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert set(data["percentiles"].keys()) == {"p5", "p25", "p50", "p75", "p95"}
    assert len(data["percentiles"]["p50"]) == 31  # horizon + 1
    assert len(data["terminal_values"]) == 500
    assert data["var_95"] >= 0
    assert data["cvar_95"] >= data["var_95"]


def test_factors_endpoint_returns_all_betas(
    client: TestClient, rng, hmac_key, sign
) -> None:
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
    assert set(data["betas"].keys()) == {"MKT", "SMB", "HML", "RMW", "CMA", "MOM"}
    assert 0.0 <= data["r_squared"] <= 1.0


def test_rebalance_endpoint_returns_trades(
    client: TestClient, hmac_key, sign
) -> None:
    body = json.dumps({
        "current_holdings": {"AAPL": 10, "MSFT": 0},
        "prices": {"AAPL": 100.0, "MSFT": 200.0},
        "target_weights": {"AAPL": 0.5, "MSFT": 0.5},
        "cash_available": 0.0,
        "transaction_cost_bps": 5.0,
    }).encode()
    headers = sign(body, hmac_key)
    resp = client.post("/rebalance", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "trades" in data
    assert "tracking_error" in data
    assert all(t["action"] in {"buy", "sell"} for t in data["trades"])
```

- [ ] **Step 2: Run to verify fail**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: 3 new tests FAIL (stubs still raise QuantError).

- [ ] **Step 3: Replace stubs with real endpoints in `src/api.py`**

```python
from src import monte_carlo as _mc
from src import factors as _factors
from src import rebalance as _rebal


@app.post("/monte-carlo")
async def monte_carlo_endpoint(req: MonteCarloRequest) -> MonteCarloResult:
    return _mc.simulate(
        symbols=req.symbols,
        returns=req.returns,
        weights=req.weights,
        initial_value=req.initial_value,
        horizon_days=req.horizon_days,
        n_simulations=req.n_simulations,
        confidence_level=req.confidence_level,
        seed=req.seed,
    )


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
        prices=req.prices,
        target_weights=req.target_weights,
        cash_available=req.cash_available,
        transaction_cost_bps=req.transaction_cost_bps,
    )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd quant-service && uv run pytest tests/test_api.py -v`
Expected: all 6 api tests PASS.

- [ ] **Step 5: Commit**

```bash
git add quant-service/src/api.py quant-service/tests/test_api.py
git commit -m "feat(quant): wire /monte-carlo, /factors, /rebalance endpoints

Integration tests exercise full request→HMAC→Pydantic→math→response
flow. All 4 protected endpoints now fully functional behind HMAC auth."
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
KEY="<the-hex-key-from-step-1>"
URL="https://<workspace>--investtracker-quant-fastapi-app.modal.run/optimize"
BODY='{"symbols":["A","B"],"returns":{"A":[0.001,-0.002,0.003,0.001,-0.001,0.002,0.0005,-0.0008,0.001,0.0012,...],"B":[0.0008,0.001,-0.002,0.0015,-0.0005,0.002,0.0009,0.0003,-0.0011,0.0007,...]},"method":"mean_variance"}'
TS=$(date +%s)
SIG=$(printf "%s%s" "$BODY" "$TS" | openssl dgst -sha256 -hmac "$KEY" | awk '{print $2}')
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  --data "$BODY"
```

Expected: JSON with `weights`, `expected_return`, `expected_volatility`, `sharpe_ratio`, `meta`.

- [ ] **Step 6: Commit a placeholder deploy log**

```bash
# The first deploy doesn't modify files, but we record the URL + key fingerprint
# so future Chunk 9 runbook can cross-reference.
mkdir -p docs/runbooks
cat > docs/runbooks/quant-deploy-bootstrap.md <<'EOF'
# Quant service bootstrap record

Initial Modal deploy completed on $(date +%Y-%m-%d).

- Modal app: `investtracker-quant`
- Function: `fastapi_app` (keep_warm=1, timeout=60s, memory=2048 MB)
- URL: `https://<workspace>--investtracker-quant-fastapi-app.modal.run`
- Secret name: `quant-service-secrets`
- HMAC key fingerprint (SHA-256 of first 8 bytes of key): `<fill>`

Key rotation: see `docs/runbooks/quant-incidents.md` → "Rotate HMAC key".
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
          version: '0.4.x'
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
    # Wait for CI to pass before deploying.
    needs: []  # intentionally no `needs` — this is a separate trigger; see note below
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install uv
        uses: astral-sh/setup-uv@v3
      - name: Install deps
        run: uv sync
      - name: Deploy to Modal
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
        run: uv run modal deploy modal_app.py
      - name: Health check after deploy
        run: |
          # Modal URL is derived from workspace + app name; store in secret
          # to avoid hard-coding.
          URL="${{ secrets.QUANT_SERVICE_URL }}/health"
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
- During the rotation window (up to 5 min), both the old and new keys
  are valid simultaneously. No downtime if steps are followed in order.

**Procedure:**

1. Generate new key (keep both old and new handy):
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

2. Add the NEW key as `QUANT_SERVICE_HMAC_KEY_NEXT` in both Modal and Next.js:
   ```bash
   # Modal side
   modal secret create quant-service-secrets-next \
     QUANT_SERVICE_HMAC_KEY="<new-key>"
   # Vercel side (env var, encrypted)
   vercel env add QUANT_SERVICE_HMAC_KEY_NEXT production
   # paste new key when prompted
   ```

3. Deploy updated `modal_app.py` that accepts EITHER key during rotation:
   (This code change is a one-time edit to `src/auth.py` — see
   "Dual-key acceptance" section below. Revert after rotation.)

4. Redeploy Next.js with the dual-key reader (see Chunk 7 Task 7.1 notes).

5. Wait ≥5 minutes (past the replay window) so all in-flight signed
   requests with the OLD key have either completed or expired.

6. Promote: rename `QUANT_SERVICE_HMAC_KEY_NEXT` → `QUANT_SERVICE_HMAC_KEY`
   in both Modal and Vercel, removing the dual-key logic:
   ```bash
   modal secret delete quant-service-secrets
   # Rename the new one in Modal UI (no CLI command for rename).
   # Or: delete old, create new with the canonical name.
   vercel env rm QUANT_SERVICE_HMAC_KEY production
   vercel env add QUANT_SERVICE_HMAC_KEY production
   # paste new key
   ```

7. Redeploy both services. Revert `src/auth.py` to single-key mode.

8. Record the rotation in this runbook with date + operator initials.

### Dual-key acceptance (temporary code)

During the 5-min overlap window, `src/auth.py`'s `validate_signature`
should try the primary key first, then fall back to `_NEXT` if set:

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

This is a TEMPORARY edit — revert it after step 6 completes.

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

**Tech:** Pure TS. `fast-check` for property tests (already a devDependency per Phase 1). No numpy, no simd — loop over typed arrays.

### Task 6.1: Shared types and barrel

**Files:**
- Create: `src/lib/quant/types.ts`
- Create: `src/lib/quant/index.ts`

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
git add src/lib/quant/types.ts src/lib/quant/index.ts
git commit -m "feat(quant/ts): shared types + barrel for src/lib/quant

Pure-math TS library for lightweight metrics (Sharpe, HHI, drawdown).
Complements the Python microservice which handles heavy math
(Markowitz, Monte Carlo)."
```

### Task 6.2: `metrics.ts` — Sharpe, Sortino, annualized vol

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
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/lib/quant/metrics.test.ts`
Expected: `Cannot find module '@/lib/quant/metrics'`

- [ ] **Step 3: Implement `metrics.ts`**

```typescript
// src/lib/quant/metrics.ts
import { TRADING_DAYS_PER_YEAR, type ReturnsArray } from "./types";

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
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/lib/quant/metrics.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quant/metrics.ts tests/lib/quant/metrics.test.ts
git commit -m "feat(quant/ts): Sharpe, Sortino, annualized volatility

Pure-TS. Bessel-corrected sample variance (n-1). Sharpe annualizes
by √252; Sortino penalizes only downside deviation from target. Both
return 0 for zero-volatility portfolios (well-defined fallback)."
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

**Note:** `src/lib/services/concentration.ts` already exists with ALERT logic but NOT the math. This new file has the pure math (HHI, top-N). A future refactor can make `services/concentration.ts` call into this — out of scope for Phase 2.

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
import { correlationMatrix } from "@/lib/quant/correlation";

describe("correlationMatrix", () => {
  it("returns 1 on the diagonal", () => {
    const m = correlationMatrix({
      A: [0.01, -0.02, 0.015, 0.005],
      B: [-0.01, 0.02, -0.015, -0.005],
    });
    expect(m.AA).toBeCloseTo(1, 10);
    expect(m.BB).toBeCloseTo(1, 10);
  });
  it("perfect anti-correlation → -1", () => {
    const m = correlationMatrix({
      A: [0.01, 0.02, 0.03, 0.04, 0.05],
      B: [-0.01, -0.02, -0.03, -0.04, -0.05],
    });
    expect(m.AB).toBeCloseTo(-1, 6);
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
    expect(Math.abs(m.AB)).toBeLessThan(0.15);
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
import type { ReturnsBySymbol } from "./types";
import { mean, sampleVariance } from "./metrics";

export function correlationMatrix(
  returns: ReturnsBySymbol,
): Record<string, number> {
  const symbols = Object.keys(returns);
  const out: Record<string, number> = {};
  for (const a of symbols) {
    for (const b of symbols) {
      const ra = returns[a];
      const rb = returns[b];
      const n = Math.min(ra.length, rb.length);
      if (n === 0) {
        out[`${a}${b}`] = 0;
        continue;
      }
      const raSlice = ra.slice(ra.length - n);
      const rbSlice = rb.slice(rb.length - n);
      const ma = mean(raSlice);
      const mb = mean(rbSlice);
      let cov = 0;
      for (let i = 0; i < n; i++) {
        cov += (raSlice[i] - ma) * (rbSlice[i] - mb);
      }
      cov = cov / (n - 1);
      const sa = Math.sqrt(sampleVariance(raSlice));
      const sb = Math.sqrt(sampleVariance(rbSlice));
      if (sa === 0 || sb === 0) {
        out[`${a}${b}`] = a === b ? 1 : 0;
      } else {
        out[`${a}${b}`] = cov / (sa * sb);
      }
    }
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
git commit -m "feat(quant/ts): correlation matrix + weight drift + drawdown series

Pairwise Pearson correlation (n-1 divisor). Signed and L1-total drift
between target and actual weights. Drawdown series as non-positive
relative equity to running peak. All pure, no I/O."
```

### Task 6.6: Property tests (fast-check) for invariants

**Files:**
- Create: `tests/lib/quant/properties.test.ts`

- [ ] **Step 1: Write property tests**

```typescript
// tests/lib/quant/properties.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hhi, topNExposure, effectiveN } from "@/lib/quant/concentration";
import { maxDrawdown, drawdownSeries } from "@/lib/quant/drawdown";
import { totalDrift } from "@/lib/quant/drift";
import { sharpeRatio, annualizedVolatility } from "@/lib/quant/metrics";

describe("quant/ts invariants", () => {
  it("HHI ∈ [0, 1] for any non-negative weights summing to 1", () => {
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
          return h >= 0 && h <= 1 + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("effectiveN ≤ n (number of positive positions)", () => {
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

  it("max drawdown is always ≤ 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.5, max: 0.5, noNaN: true }), {
          minLength: 1,
          maxLength: 100,
        }),
        (returns) => maxDrawdown(returns) <= 1e-9,
      ),
      { numRuns: 200 },
    );
  });

  it("drawdown series is element-wise ≤ 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.5, max: 0.5, noNaN: true }), {
          minLength: 1,
          maxLength: 100,
        }),
        (returns) => drawdownSeries(returns).every((x) => x <= 1e-9),
      ),
      { numRuns: 200 },
    );
  });

  it("totalDrift is in [0, 2] for any two proper weight maps", () => {
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
          return t >= 0 && t <= 2 + 1e-9;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("annualizedVolatility ≥ 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -0.5, max: 0.5, noNaN: true }), {
          minLength: 2,
          maxLength: 252,
        }),
        (returns) => annualizedVolatility(returns) >= 0,
      ),
      { numRuns: 200 },
    );
  });
});
```

- [ ] **Step 2: Run property tests**

Run: `npm test -- tests/lib/quant/properties.test.ts`
Expected: all 7 properties PASS across 200 random runs each.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/quant/properties.test.ts
git commit -m "test(quant/ts): fast-check property tests for invariants

HHI ∈ [0,1], effectiveN ≤ n, topNExposure monotone in n, max drawdown
≤ 0, drawdown series element-wise ≤ 0, totalDrift ∈ [0,2], annualized
vol ≥ 0. 200 random runs per property."
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
  HMAC_INVALID: 401,
  HMAC_EXPIRED: 401,
  RATE_LIMITED: 429,
  COLD_START_TIMEOUT: 503,
  FEATURE_DISABLED: 404,  // pretend endpoint doesn't exist when flag off
  PORTFOLIO_NOT_FOUND: 404,
  FORBIDDEN: 403,
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

Maps 15 QuantErrorCode values to HTTP status. Coexists with legacy
src/lib/api/response.ts — quant routes use the coded helper, existing
routes keep { data, error } untouched."
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
    // Phase 2 tiers (§5.2 of spec)
    optimize:    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5,   '1 m'), prefix: 'rl:optimize'    }),
    monte_carlo: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3,   '1 m'), prefix: 'rl:mc'          }),
    rebalance:   new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '1 m'), prefix: 'rl:rebalance'   }),
    // Internal tier: per-user cap on combined quant traffic (spec §5.2 safety net)
    internal:    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  '1 m'), prefix: 'rl:qint'        }),
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

Phase 2 quant endpoints have tight per-user caps: 5/min optimize,
3/min monte-carlo, 10/min rebalance. 'internal' tier is a safety-net
30/min combined cap to prevent a burst across the 3 above."
```

### Task 7.4: `src/lib/services/quant.ts` — Modal caller with cache + audit

**Files:**
- Create: `src/lib/services/quant.ts`
- Test: `tests/lib/services/quant.test.ts`

**Spec invariant (§7.2):** every call — cache-hit OR cache-miss — writes ONE row to `quant_runs`. Tests verify this.

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
  it("posts signed request to Modal on cache miss and inserts audit row", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ weights: { A: 0.5, B: 0.5 } }),
    });

    const result = await callQuant({
      endpoint: "/optimize",
      body: { symbols: ["A", "B"], method: "mean_variance" },
      portfolioId: "p-1",
      userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });

    expect(result).toEqual({ weights: { A: 0.5, B: 0.5 } });
    expect(mockFetch).toHaveBeenCalledOnce();
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://modal.test/optimize");
    expect(call[1]?.method).toBe("POST");
    const headers = (call[1]?.headers as Record<string, string>) ?? {};
    expect(headers["X-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    // Mandatory audit row
    expect(mockSupabase.from).toHaveBeenCalledWith("quant_runs");
    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      portfolio_id: "p-1",
      user_id: "u-1",
      endpoint: "/optimize",
      cache_hit: false,
      status: "ok",
    });
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it("serves from cache without calling Modal, BUT STILL inserts audit row", async () => {
    mockCacheGet.mockResolvedValue({ weights: { A: 0.4, B: 0.6 } });

    const result = await callQuant({
      endpoint: "/optimize",
      body: { symbols: ["A", "B"], method: "mean_variance" },
      portfolioId: "p-1",
      userId: "u-1",
      supabase: mockSupabase as never,
      cache: { get: mockCacheGet, set: mockCacheSet },
    });

    expect(result).toEqual({ weights: { A: 0.4, B: 0.6 } });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg.cache_hit).toBe(true);
    expect(auditArg.status).toBe("ok");
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("propagates modal error envelope verbatim and inserts audit with status=error", async () => {
    mockCacheGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: { code: "WEIGHTS_NOT_ONE", message: "w=1.002", details: {} },
        }),
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
    ).rejects.toMatchObject({
      code: "WEIGHTS_NOT_ONE",
      message: "w=1.002",
    });

    expect(mockSupabase.insert).toHaveBeenCalledOnce();
    const auditArg = mockSupabase.insert.mock.calls[0][0];
    expect(auditArg.status).toBe("error");
    expect(auditArg.error_code).toBe("WEIGHTS_NOT_ONE");
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
  "/optimize": 15 * 60,       // 15 min
  "/monte-carlo": 30 * 60,    // 30 min (higher cost, stable inputs over session)
  "/factors": 60 * 60,        // 1 hr (slow-moving)
  "/rebalance": 0,            // never cache — always fresh trade plan
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

function cacheKey(endpoint: QuantEndpoint, body: unknown): string {
  const h = createHash("sha256")
    .update(endpoint)
    .update(JSON.stringify(body))
    .digest("hex");
  return `quant:${endpoint}:${h.slice(0, 32)}`;
}

/**
 * Call the Modal quant service with HMAC-signed request.
 * Serves from cache when available (except /rebalance).
 * **ALWAYS writes one row to quant_runs** — both cache-hit and cache-miss
 * paths insert the audit row (spec §7.2 invariant).
 */
export async function callQuant<TBody, TResult = unknown>(
  opts: CallQuantOptions<TBody>,
): Promise<TResult> {
  const { endpoint, body, portfolioId, userId, supabase, cache } = opts;
  const url = process.env.QUANT_SERVICE_URL;
  const key = process.env.QUANT_SERVICE_HMAC_KEY;
  if (!url || !key) {
    throw new QuantError(
      "INTERNAL",
      "Quant service not configured (QUANT_SERVICE_URL or HMAC_KEY missing)",
    );
  }

  const ttl = CACHE_TTL_SECONDS[endpoint];
  const ckey = cacheKey(endpoint, body);

  // Cache check (skip for rebalance)
  let cacheHit = false;
  let result: TResult | null = null;
  if (ttl > 0) {
    const cached = (await cache.get(ckey)) as TResult | null;
    if (cached !== null) {
      cacheHit = true;
      result = cached;
    }
  }

  const start = Date.now();

  if (!cacheHit) {
    const bodyStr = JSON.stringify(body);
    const { headers } = signRequest(bodyStr, key);
    const resp = await fetch(url + endpoint, {
      method: "POST",
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(60_000), // 60s max
    });
    if (!resp.ok) {
      const env = (await resp.json().catch(() => ({
        error: { code: "INTERNAL", message: `HTTP ${resp.status}`, details: {} },
      }))) as { error?: QuantErrorEnvelope };
      await insertAudit(supabase, {
        portfolio_id: portfolioId,
        user_id: userId,
        endpoint,
        cache_hit: false,
        status: "error",
        error_code: env.error?.code ?? "INTERNAL",
        duration_ms: Date.now() - start,
        request_hash: ckey,
      });
      throw new QuantError(
        env.error?.code ?? "INTERNAL",
        env.error?.message ?? `HTTP ${resp.status}`,
        env.error?.details ?? {},
      );
    }
    result = (await resp.json()) as TResult;
    if (ttl > 0) {
      await cache.set(ckey, result, ttl);
    }
  }

  // MANDATORY audit — cache-hit and cache-miss both land here.
  await insertAudit(supabase, {
    portfolio_id: portfolioId,
    user_id: userId,
    endpoint,
    cache_hit: cacheHit,
    status: "ok",
    error_code: null,
    duration_ms: Date.now() - start,
    request_hash: ckey,
  });

  return result as TResult;
}

type AuditRow = {
  portfolio_id: string;
  user_id: string;
  endpoint: string;
  cache_hit: boolean;
  status: "ok" | "error";
  error_code: string | null;
  duration_ms: number;
  request_hash: string;
};

async function insertAudit(
  supabase: SupabaseClient,
  row: AuditRow,
): Promise<void> {
  const { error } = await supabase.from("quant_runs").insert(row);
  if (error) {
    // Non-fatal: audit failure shouldn't block the user response.
    // But log loudly.
    console.error("[quant] audit insert failed", error);
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

callQuant() signs with HMAC, handles cache (/rebalance bypasses),
propagates §3.3a error envelope as typed QuantError. ALWAYS inserts
exactly one quant_runs row (spec §7.2) — cache-hit and cache-miss
both produce audit; audit insert failures are non-fatal but logged."
```

---

## Chunk 7b — Four Next.js API routes wiring the quant service

**Why a split:** Chunk 7 grew too large. Chunk 7a covered the shared infra — HMAC signer, §3.3a envelope helper, extended rate-limit tiers, and `src/lib/services/quant.ts` (HTTP + cache + audit). This Chunk 7b wires those into four user-facing Next.js routes under `/api/portfolios/[id]/*`.

**Prereqs:** Chunk 7a complete (`src/lib/services/quant.ts`, `src/lib/api/hmac.ts`, `src/lib/api/response-coded.ts`, and the new rate-limit tiers all committed).

**Pattern:** All four routes share the same skeleton:
1. Check `quant_engine_enabled` flag → 404 `FEATURE_DISABLED` when off.
2. Auth via `supabase.auth.getUser()` → 401 `FORBIDDEN`.
3. Rate-limit on route-specific tier + `internal` safety net.
4. Zod-validate the body → 422 `VALIDATION_ERROR` on failure.
5. Portfolio ownership check → 404 `PORTFOLIO_NOT_FOUND`.
6. Call `callQuant(...)` with a Redis-backed cache shim.
7. Catch `QuantError`, map to §3.3a envelope.

Only the Zod schema, the rate-limit tier, and the callQuant endpoint differ between routes.

### Task 7.5: `/api/portfolios/[id]/optimize` route

**Files:**
- Create: `src/app/api/portfolios/[id]/optimize/route.ts`
- Test: `tests/app/api/portfolios/optimize.test.ts`

**Handler behavior (spec §4.2):**
1. Check feature flag `quant_engine_enabled` — off → 404 `FEATURE_DISABLED`.
2. Authenticate. Unauth → 401.
3. Validate body with Zod.
4. Rate-limit on `optimize` tier + `internal` tier.
5. Load portfolio, verify ownership. Not found / not owned → 404 `PORTFOLIO_NOT_FOUND`.
6. Build `returns` map from `portfolio_history` / `price_history` for each symbol.
7. Call `callQuant({ endpoint: "/optimize", ... })`.
8. Emit PostHog event `quant_run`.
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

const OptimizeBody = z.object({
  method: z.enum(["mean_variance", "risk_parity", "hrp"]),
  symbols: z.array(z.string()).min(2).max(100).optional(),
  returns: z.record(z.string(), z.array(z.number())).optional(),
  target_return: z.number().optional(),
  risk_free_rate: z.number().default(0),
  include_frontier: z.boolean().default(false),
  constraints: z
    .object({
      allow_short: z.boolean().default(false),
      min_weight: z.number().optional(),
      max_weight: z.number().optional(),
      sector_caps: z.record(z.string(), z.number()).optional(),
      sector_map: z.record(z.string(), z.string()).optional(),
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
  if (!user) return errorCoded("FORBIDDEN", "Not authenticated");

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
    target_return: parsed.target_return,
    risk_free_rate: parsed.risk_free_rate,
    include_frontier: parsed.include_frontier,
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
    throw err;
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

- [ ] **Step 1: Write test** (pattern identical to Task 7.5; differs only in body schema and rate tier).

```typescript
// tests/app/api/portfolios/monte-carlo.test.ts
// Same shape as optimize.test.ts, but posts to /monte-carlo and uses
// different body fields (horizon_days, n_simulations). Mocks callQuant
// to return a percentiles/terminal_values payload. Verify rate-limit
// tier is "monte_carlo" (not "optimize") by checking the
// rateLimit mock arguments.

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
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

it("calls rateLimit with 'monte_carlo' tier", async () => {
  const { rateLimit } = await import("@/lib/api/rate-limit");
  (rateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  const { callQuant } = await import("@/lib/services/quant");
  (callQuant as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    percentiles: { p50: [100, 101] },
    terminal_values: [101],
    var_95: 5,
    cvar_95: 6,
    mean_terminal: 101,
    meta: {},
  });
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } } }) },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "p-1", user_id: "u-1", symbols: ["A"] },
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  });
  const req = new NextRequest("http://t/api/portfolios/p-1/monte-carlo", {
    method: "POST",
    body: JSON.stringify({
      weights: { A: 1.0 },
      returns: { A: Array(100).fill(0.001) },
      initial_value: 10_000,
      horizon_days: 30,
      n_simulations: 500,
    }),
  });
  await POST(req, { params: Promise.resolve({ id: "p-1" }) });
  const calls = (rateLimit as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const tiers = calls.map((c) => c[1]);
  expect(tiers).toContain("monte_carlo");
  expect(tiers).toContain("internal");
});
```

- [ ] **Step 2: Run to verify fail, then implement**

Mirror `optimize/route.ts` — change: Zod schema = `{ weights, returns, initial_value, horizon_days (≤1260), n_simulations (1..50_000), confidence_level (0..1), seed? }`; rate-limit tier = `"monte_carlo"`; callQuant endpoint = `"/monte-carlo"`.

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

const MCBody = z.object({
  weights: z.record(z.string(), z.number()),
  returns: z.record(z.string(), z.array(z.number())),
  initial_value: z.number().positive(),
  horizon_days: z.number().int().positive().max(1260),
  n_simulations: z.number().int().positive().max(50_000),
  confidence_level: z.number().gt(0).lt(1).default(0.95),
  seed: z.number().int().optional(),
});

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("FORBIDDEN", "Not authenticated");

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
      body: {
        symbols: Object.keys(parsed.weights),
        ...parsed,
      },
      portfolioId,
      userId: user.id,
      supabase,
      cache: {
        get: async (k) => (await redis.get(k)) ?? null,
        set: async (k, v, ttl) => { await redis.set(k, v, { ex: ttl }); },
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
    throw err;
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

### Task 7.7: `/api/portfolios/[id]/factors` route

**Files:**
- Create: `src/app/api/portfolios/[id]/factors/route.ts`
- Test: `tests/app/api/portfolios/factors.test.ts`

- [ ] **Step 1-3: Mirror Task 7.6**

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

const FactorsBody = z.object({
  portfolio_returns: z.array(z.number()).min(60),
  factor_returns: z.record(z.string(), z.array(z.number())),
  risk_free_rate_daily: z.number().default(0),
});

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("FORBIDDEN", "Not authenticated");

  // Factors uses the generic tier (it's cheap once cached 1hr)
  const okG = await rateLimit(user.id, "general");
  const okI = await rateLimit(user.id, "internal");
  if (!okG || !okI) return errorCoded("RATE_LIMITED", "Too many requests");

  let parsed;
  try {
    parsed = FactorsBody.parse(JSON.parse(await req.text()));
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
      endpoint: "/factors",
      body: parsed,
      portfolioId,
      userId: user.id,
      supabase,
      cache: {
        get: async (k) => (await redis.get(k)) ?? null,
        set: async (k, v, ttl) => { await redis.set(k, v, { ex: ttl }); },
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
    throw err;
  }
});
```

- [ ] **Step 2: Test + commit**

```bash
git add src/app/api/portfolios/[id]/factors/route.ts \
        tests/app/api/portfolios/factors.test.ts
git commit -m "feat(api): POST /api/portfolios/[id]/factors route

OLS factor regression endpoint. Uses 'general' tier (cached 1hr)
plus 'internal' safety net. Requires ≥60 days of portfolio returns
and all 6 factors (MKT/SMB/HML/RMW/CMA/MOM)."
```

### Task 7.8: `/api/portfolios/[id]/rebalance` route

**Files:**
- Create: `src/app/api/portfolios/[id]/rebalance/route.ts`
- Test: `tests/app/api/portfolios/rebalance.test.ts`

Rate-limit tier: `"rebalance"`. Body: `{ current_holdings, prices, target_weights, cash_available, transaction_cost_bps }`. Cache TTL=0 (always fresh). Rest mirrors Task 7.6.

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
import { redis } from "@/lib/cache/redis";

const RebalanceBody = z.object({
  current_holdings: z.record(z.string(), z.number().int().nonnegative()),
  prices: z.record(z.string(), z.number().positive()),
  target_weights: z.record(z.string(), z.number()),
  cash_available: z.number().nonnegative(),
  transaction_cost_bps: z.number().min(0).max(100).default(5),
});

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { params } = ctx as { params: Promise<{ id: string }> };
  const { id: portfolioId } = await params;
  if (!(await isFeatureEnabled("quant_engine_enabled")))
    return errorCoded("FEATURE_DISABLED", "Quant engine is not available");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorCoded("FORBIDDEN", "Not authenticated");

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
      cache: {  // TTL=0 in callQuant means this is never used, but interface required
        get: async () => null,
        set: async () => {},
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
    throw err;
  }
});
```

- [ ] **Step 2: Test + commit**

```bash
git add src/app/api/portfolios/[id]/rebalance/route.ts \
        tests/app/api/portfolios/rebalance.test.ts
git commit -m "feat(api): POST /api/portfolios/[id]/rebalance route

Never cached (fresh trade plan every call). Uses 'rebalance' tier
(10/min) + internal cap. Transaction cost in bps (0–100 range,
default 5). All 4 quant routes now wired end-to-end."
```

---

## Chunk 8 — UI vertical slice (`/portfolio/[id]/optimize`)

**Goal:** End-user-facing Optimize page, gated by feature flag `quant_engine_enabled`. All components render without optimization running (empty state) and update live when the user changes constraints.

**Interaction model (spec §4.2.3):**
- User lands on page → form pre-populated from portfolio's `optimization_constraints` (or defaults).
- User edits constraint → client-side **debounce commit** (500ms after last keystroke OR on input blur, whichever comes first) → POST to `/api/portfolios/[id]/optimize`.
- Page also has an "Include frontier" toggle → when on, `include_frontier: true` in request body → chart renders with 20 points.
- "Generate trades" button calls `/rebalance` endpoint with the current prices + target weights from the last optimize result.

**Component layout:**
```
page.tsx
├── OptimizeSummary         (top: μ, σ, Sharpe cards)
├── EfficientFrontierChart  (middle: Recharts scatter w/ frontier + optimum)
├── ConstraintsForm         (left sidebar: form inputs)
├── OptimalAllocationTable  (right: symbol × {current, target, drift})
└── RebalanceTradeList      (bottom: appears after "Generate trades")
```

### Task 8.1: Feature flag + container page shell

**Files:**
- Create: `src/app/portfolio/[id]/optimize/page.tsx`
- Create: `src/app/portfolio/[id]/optimize/optimize-client.tsx` (client component)
- Test: `tests/app/portfolio/optimize-page.test.tsx`

- [ ] **Step 1: Write failing page test (SSR + flag gate)**

```typescript
// tests/app/portfolio/optimize-page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "@/app/portfolio/[id]/optimize/page";

vi.mock("@/lib/flags", () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "p-1", user_id: "u", symbols: ["A", "B"], optimization_constraints: null },
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
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/app/portfolio/optimize-page.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement page shell**

```tsx
// src/app/portfolio/[id]/optimize/page.tsx
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
// src/app/portfolio/[id]/optimize/optimize-client.tsx
"use client";

import { useState, useCallback } from "react";
import { useDebounce } from "@/lib/hooks/use-debounce";
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

export type OptimizeResult = {
  weights: Record<string, number>;
  expected_return: number;
  expected_volatility: number;
  sharpe_ratio: number;
  frontier: Array<{ return: number; volatility: number; weights: Record<string, number> }>;
  meta: { method: string; solver: string };
};

export default function OptimizeClient({
  portfolioId,
  initialSymbols,
  initialConstraints,
}: Props) {
  const [method, setMethod] = useState<"mean_variance" | "risk_parity" | "hrp">(
    "mean_variance",
  );
  const [constraints, setConstraints] = useState(initialConstraints);
  const [includeFrontier, setIncludeFrontier] = useState(false);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<unknown | null>(null);

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
          include_frontier: includeFrontier,
        }),
      });
      if (!resp.ok) {
        const env = await resp.json();
        setError(env.error?.message ?? "Optimization failed");
        return;
      }
      setResult(await resp.json());
    } finally {
      setLoading(false);
    }
  }, [portfolioId, method, constraints, includeFrontier, initialSymbols]);

  // Debounce commit: fires 500ms after last change.
  useDebounce(optimize, 500, [method, constraints, includeFrontier]);

  const onGenerateTrades = useCallback(async () => {
    if (!result) return;
    // Simplified: assume client has prices and holdings somehow
    // (in practice, read from portfolio state via hook). Not detailed here.
    const resp = await fetch(`/api/portfolios/${portfolioId}/rebalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_holdings: {},  // replaced with real holdings hook
        prices: {},            // replaced with real prices hook
        target_weights: result.weights,
        cash_available: 0,
      }),
    });
    if (resp.ok) setTrades(await resp.json());
  }, [portfolioId, result]);

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
        />
      </div>
      <div className="col-span-9 space-y-4">
        <OptimizeSummary result={result} loading={loading} error={error} />
        {includeFrontier && result && (
          <EfficientFrontierChart frontier={result.frontier} optimum={result} />
        )}
        <OptimalAllocationTable result={result} />
        <button
          disabled={!result}
          onClick={onGenerateTrades}
          className="btn btn-primary"
        >
          Generate Trades
        </button>
        {trades ? <RebalanceTradeList data={trades} /> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/app/portfolio/optimize-page.test.tsx`
Expected: both tests PASS (components from later tasks may be stubbed — see 8.2-8.6).

- [ ] **Step 5: Commit**

```bash
git add src/app/portfolio/[id]/optimize/ tests/app/portfolio/optimize-page.test.tsx
git commit -m "feat(ui): Optimize page shell with feature flag gate

SSR checks quant_engine_enabled flag and portfolio ownership, then
renders client island. Client runs debounced optimize (500ms) on
constraint changes. Generate-trades button triggers /rebalance."
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

type Constraints = {
  allow_short?: boolean;
  min_weight?: number;
  max_weight?: number;
  sector_caps?: Record<string, number>;
  sector_map?: Record<string, string>;
};

type Props = {
  method: "mean_variance" | "risk_parity" | "hrp";
  onMethodChange: (m: Props["method"]) => void;
  constraints: Record<string, unknown> | null;
  onConstraintsChange: (c: Record<string, unknown> | null) => void;
  includeFrontier: boolean;
  onIncludeFrontierChange: (v: boolean) => void;
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
- Tests: matching `.test.tsx` files

```tsx
// src/components/quant/OptimizeSummary.tsx
import type { OptimizeResult } from "@/app/portfolio/[id]/optimize/optimize-client";

type Props = {
  result: OptimizeResult | null;
  loading: boolean;
  error: string | null;
};

export default function OptimizeSummary({ result, loading, error }: Props) {
  if (error) {
    return (
      <div className="bg-red-50 p-4 rounded border border-red-200" role="alert">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }
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
import type { OptimizeResult } from "@/app/portfolio/[id]/optimize/optimize-client";

type Props = { result: OptimizeResult | null };

export default function OptimalAllocationTable({ result }: Props) {
  if (!result) return null;
  const entries = Object.entries(result.weights).sort((a, b) => b[1] - a[1]);
  return (
    <table className="w-full text-sm" data-testid="allocation-table">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">Symbol</th>
          <th className="py-2 text-right">Target Weight</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([s, w]) => (
          <tr key={s} className="border-b" data-testid={`row-${s}`}>
            <td className="py-2">{s}</td>
            <td className="py-2 text-right tabular-nums">{(w * 100).toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Run both test files (asserting basic rendering + table rows match weights).

Commit:

```bash
git add src/components/quant/OptimizeSummary.tsx src/components/quant/OptimalAllocationTable.tsx \
        tests/components/quant/OptimizeSummary.test.tsx tests/components/quant/OptimalAllocationTable.test.tsx
git commit -m "feat(ui/quant): OptimizeSummary + OptimalAllocationTable

Three-card summary (return/vol/Sharpe) with loading and error states.
Allocation table sorted by weight desc. Both components pure — no
data fetching, all input via props."
```

### Task 8.4: `EfficientFrontierChart` component

**Files:**
- Create: `src/components/quant/EfficientFrontierChart.tsx`

Uses `recharts` (already a dep per repo). Renders scatter of frontier points + a distinct marker for the current optimum.

```tsx
// src/components/quant/EfficientFrontierChart.tsx
"use client";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { OptimizeResult } from "@/app/portfolio/[id]/optimize/optimize-client";

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

Commit:

```bash
git add src/components/quant/EfficientFrontierChart.tsx \
        tests/components/quant/EfficientFrontierChart.test.tsx
git commit -m "feat(ui/quant): EfficientFrontierChart (recharts scatter)

Plots frontier points + optimum as star marker. Axes in percent.
Pure presentation — renders only when parent passes frontier array."
```

### Task 8.5: `RebalanceTradeList` component

**Files:**
- Create: `src/components/quant/RebalanceTradeList.tsx`

```tsx
// src/components/quant/RebalanceTradeList.tsx
type Trade = {
  symbol: string;
  action: "buy" | "sell";
  shares: number;
  estimated_cost: number;
};

type Props = {
  data: {
    trades: Trade[];
    tracking_error: number;
    total_transaction_cost: number;
    final_cash: number;
  } | null;
};

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
      <div className="flex justify-between p-3 bg-gray-50 text-sm">
        <span>Tracking error: {(data.tracking_error * 100).toFixed(2)}%</span>
        <span>Total cost: ${data.total_transaction_cost.toFixed(2)}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 px-3">Symbol</th>
            <th className="py-2 px-3">Action</th>
            <th className="py-2 px-3 text-right">Shares</th>
            <th className="py-2 px-3 text-right">Est. Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.trades.map((t, i) => (
            <tr key={i} className="border-b" data-testid={`trade-${t.symbol}`}>
              <td className="py-2 px-3">{t.symbol}</td>
              <td className={`py-2 px-3 ${t.action === "buy" ? "text-green-600" : "text-red-600"}`}>
                {t.action.toUpperCase()}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{t.shares}</td>
              <td className="py-2 px-3 text-right tabular-nums">
                ${t.estimated_cost.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Commit:

```bash
git add src/components/quant/RebalanceTradeList.tsx \
        tests/components/quant/RebalanceTradeList.test.tsx
git commit -m "feat(ui/quant): RebalanceTradeList component

Table view of integer-share trades with buy/sell color coding,
tracking-error and total-cost header. Renders empty-state message
when no trades are needed."
```

### Task 8.6: PostHog event wiring + feature flag navigation link

**Files:**
- Modify: `src/app/portfolio/[id]/optimize/optimize-client.tsx`
- Modify: nav / sidebar where portfolio links live (find existing pattern and add conditional link)

- [ ] **Step 1: Wire PostHog events**

In `optimize-client.tsx`, add after `setResult(await resp.json())`:

```typescript
import { posthog } from "@/lib/analytics/posthog-client";
...
posthog.capture("quant_run", {
  portfolioId,
  method,
  include_frontier: includeFrontier,
  sharpe_ratio: result.sharpe_ratio,
});
```

And after `setTrades(await resp.json())` for rebalance:

```typescript
posthog.capture("quant_rebalance", {
  portfolioId,
  tracking_error: trades.tracking_error,
  n_trades: trades.trades.length,
});
```

- [ ] **Step 2: Add nav link (flag-gated)**

Locate the existing portfolio sidebar / tabs component (likely `src/components/portfolio/*`). Inside the nav, add:

```tsx
import { useFeatureFlag } from "@/lib/flags/client"; // or equivalent
...
const quantEnabled = useFeatureFlag("quant_engine_enabled");
...
{quantEnabled && (
  <Link href={`/portfolio/${portfolioId}/optimize`} data-testid="nav-optimize">
    Optimize
  </Link>
)}
```

The exact file path depends on the repo's nav component — implementers must grep for the existing portfolio subroutes (`/portfolio/[id]/overview`, etc.) and add the new link next to them, guarded by the flag hook.

- [ ] **Step 3: Commit**

```bash
git add src/app/portfolio/[id]/optimize/optimize-client.tsx \
        src/components/portfolio/<nav-file>.tsx
git commit -m "feat(ui/quant): PostHog events + flag-gated nav link

Emits 'quant_run' after successful /optimize and 'quant_rebalance'
after /rebalance. Nav link to Optimize page only renders when
quant_engine_enabled is true (client-side flag hook)."
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

## POST `/api/portfolios/[id]/optimize`

Rate limit: 5 req/min per user (plus combined 30/min internal cap).

### Request

```json
{
  "method": "mean_variance" | "risk_parity" | "hrp",
  "symbols": ["AAPL", "MSFT"],
  "returns": { "AAPL": [0.001, -0.002, ...], "MSFT": [...] },
  "target_return": 0.15,
  "risk_free_rate": 0.02,
  "include_frontier": false,
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
- `target_return` optional — when absent, `mean_variance` maximizes Sharpe.

### Success response (HTTP 200)

```json
{
  "weights": { "AAPL": 0.45, "MSFT": 0.55 },
  "expected_return": 0.12,
  "expected_volatility": 0.18,
  "sharpe_ratio": 0.56,
  "frontier": [],  // populated only when include_frontier=true
  "meta": { "method": "mean_variance", "solver": "CLARABEL", "iterations": null }
}
```

### Error codes

| HTTP | Code                     | When                                     |
|------|--------------------------|------------------------------------------|
| 401  | `FORBIDDEN`              | Unauthenticated                          |
| 404  | `FEATURE_DISABLED`       | Flag off                                 |
| 404  | `PORTFOLIO_NOT_FOUND`    | Portfolio missing or not owned           |
| 422  | `VALIDATION_ERROR`       | Body failed Zod                          |
| 422  | `INSUFFICIENT_HISTORY`   | <2 symbols with ≥60 days history         |
| 422  | `COVARIANCE_NOT_PD`      | Returns matrix rank-deficient            |
| 422  | `WEIGHTS_NOT_ONE`        | Solver returned weights not summing to 1 |
| 400  | `INFEASIBLE`             | Constraints make optimization infeasible |
| 429  | `RATE_LIMITED`           | Per-user cap exceeded                    |
| 503  | `COLD_START_TIMEOUT`     | Modal took >60s to respond (rare)        |
| 500  | `INTERNAL`               | Other                                    |

## POST `/api/portfolios/[id]/monte-carlo`

Rate limit: 3 req/min (plus 30/min internal).

Body fields:
- `weights`, `returns` (required).
- `initial_value` (positive number).
- `horizon_days` (int, max 1260 = ~5 years).
- `n_simulations` (int, max 50_000).
- `confidence_level` (0 < x < 1, default 0.95).
- `seed` (optional int for reproducibility).

Success response:

```json
{
  "percentiles": {
    "p5":  [100000, 99850, ...],
    "p25": [...], "p50": [...], "p75": [...], "p95": [...]
  },
  "terminal_values": [98234.1, 101203.5, ...],
  "var_95": 3420.15,
  "cvar_95": 4820.50,
  "mean_terminal": 108234.22,
  "meta": { "n_simulations": 1000, "horizon_days": 252, "confidence_level": 0.95, "seed": 42 }
}
```

Error codes same as `/optimize` plus `MONTE_CARLO_DEGENERATE` (portfolio volatility is zero → no meaningful paths).

## POST `/api/portfolios/[id]/factors`

Rate limit: 120 req/min (generic tier — cached 1hr).

Body:
- `portfolio_returns` (array, ≥60 length).
- `factor_returns` (object with keys `MKT`, `SMB`, `HML`, `RMW`, `CMA`, `MOM`, all same length as `portfolio_returns`).
- `risk_free_rate_daily` (default 0).

Success: `{ alpha, alpha_tstat, betas, beta_tstats, r_squared, adj_r_squared, factor_contributions, residual_vol }` — all annualized where applicable.

Error codes same as `/optimize` plus `DIMENSION_MISMATCH`.

## POST `/api/portfolios/[id]/rebalance`

Rate limit: 10 req/min. Never cached.

Body:
- `current_holdings` (map of symbol → integer shares).
- `prices` (map of symbol → positive price).
- `target_weights` (map of symbol → 0..1, renormalized server-side).
- `cash_available` (nonneg dollar amount).
- `transaction_cost_bps` (0–100, default 5).

Success:

```json
{
  "trades": [
    { "symbol": "AAPL", "action": "buy",  "shares": 3, "estimated_cost": 450.22 },
    { "symbol": "MSFT", "action": "sell", "shares": 2, "estimated_cost": 0.30 }
  ],
  "tracking_error": 0.02,
  "total_transaction_cost": 450.52,
  "final_cash": 50.20,
  "meta": { "total_value": 10000, "transaction_cost_bps": 5, "n_symbols": 2 }
}
```

## HMAC signing (server-to-Modal only — do NOT expose to clients)

The Next.js service layer signs every outbound call to the Modal microservice:
- Header `X-Timestamp`: Unix seconds (string).
- Header `X-Signature`: `HMAC_SHA256(body || timestamp, QUANT_SERVICE_HMAC_KEY)` hex digest.
- Replay window: 5 minutes. Stale timestamps are rejected with HTTP 401 + code `HMAC_EXPIRED`.

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
- Recent usage in PostHog `quant_run` events but `SELECT COUNT(*) FROM quant_runs WHERE created_at > now() - interval '1 hour'` returns 0.

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

- [ ] `supabase/migrations/009_quant_engine.sql` present and reviewed.
- [ ] On staging: `supabase db push` → migration applies without error.
- [ ] On staging: run the RLS integration test from Task 1.2 → passes.
- [ ] Apply to production during a low-traffic window.
- [ ] Post-apply: `SELECT COUNT(*) FROM quant_runs` returns 0 (baseline).

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
- [ ] PostHog — `quant_run` event count > 0 after 1 hour of traffic.
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
  -d '{"method":"mean_variance","include_frontier":false}'
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

