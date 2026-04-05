# Analytics Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix data persistence, implement real P&L tracking, and build professional-grade analytics for InvestTracker.

**Architecture:** Phase A fixes the backend foundation (snapshots, returns, benchmarks, allocation, price history). Phase C builds the user-facing features on top (dashboard P&L, historical charts, leaderboard history, position P&L). Phase B adds professional analytics (advanced returns, risk dashboard, attribution, income, concentration alerts, social badges).

**Tech Stack:** Next.js 16.2 (App Router), TypeScript, Supabase (PostgreSQL + Auth), Upstash Redis, Recharts, shadcn/ui, Vitest. NOTE: Next.js 16 renames middleware to "proxy" — use `proxy.ts` not `middleware.ts`.

**Spec:** `docs/superpowers/specs/2026-04-04-analytics-overhaul-design.md`

---

## File Structure

### New Files

```
src/lib/services/
  returns.ts              — TWR, MWR, simple return calculations
  benchmarks.ts           — Benchmark data fetch, storage, comparison
  attribution.ts          — BHB attribution analysis
  concentration.ts        — Risk evaluation and alert generation
  dividend-analytics.ts   — Income tracking, yield, projections

src/app/api/
  dashboard/summary/route.ts         — Aggregated P&L across all portfolios
  analytics/[pid]/returns/route.ts   — TWR, MWR, calendar returns
  analytics/[pid]/attribution/route.ts — BHB attribution
  analytics/[pid]/income/route.ts    — Dividend/income analytics
  portfolio/[id]/alerts/route.ts     — Concentration alerts CRUD
  portfolio/[id]/alerts/[aid]/route.ts — Dismiss alert
  discover/leaderboard/history/route.ts — Historical rankings
  discover/winners/route.ts          — Daily winners/losers
  cron/snapshots/backfill/route.ts   — Backfill missing snapshots
  cron/status/route.ts               — Cron health status

src/components/
  dashboard/pnl-cards.tsx            — P&L KPI cards with daily change
  dashboard/position-pnl-table.tsx   — Positions with P&L and sparklines
  dashboard/benchmark-overlay.tsx    — Portfolio vs benchmark chart
  analytics/returns-summary.tsx      — TWR/MWR/Simple cards
  analytics/calendar-returns.tsx     — Monthly returns heatmap
  analytics/rolling-returns.tsx      — Rolling return lines
  analytics/drawdown-chart.tsx       — Inverted drawdown area chart
  analytics/risk-dashboard.tsx       — Risk gauges and scatter
  analytics/attribution-waterfall.tsx — BHB waterfall chart
  analytics/income-dashboard.tsx     — Dividend income components
  discover/winners-losers.tsx        — Daily top movers widget
  discover/ranking-chart.tsx         — Ranking progression line chart
  portfolio/concentration-alerts.tsx — Alert banners

supabase/migrations/
  007_analytics_overhaul.sql         — All new tables, columns, indexes, RLS, fixes

tests/
  lib/services/returns.test.ts       — TWR/MWR unit tests
  lib/services/benchmarks.test.ts    — Benchmark service tests
  lib/services/concentration.test.ts — Concentration rules tests
```

### Modified Files

```
src/lib/services/snapshots.ts        — Add cron_runs logging, benchmark fetch, new metrics
src/lib/cache/redis.ts               — Add new cache key prefixes
src/app/api/cron/snapshots/route.ts  — Add monitoring, retry, benchmark pipeline
src/app/api/analytics/[pid]/allocation/route.ts — Use market value not cost basis
src/app/api/analytics/[pid]/risk/route.ts       — Add new risk metrics
src/app/api/portfolio/[id]/route.ts  — Enrich positions with P&L
src/app/api/portfolio/history/route.ts — Use snapshots as primary source
src/components/dashboard/kpi-cards.tsx — Replace with pnl-cards
```

---

## Chunk 1: Database Migration + Snapshot Reliability (Phase A1)

### Task 1: Write migration 007

**Files:**
- Create: `supabase/migrations/007_analytics_overhaul.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 007_analytics_overhaul.sql
-- Analytics Overhaul: new tables, fix missing columns, add metrics columns

-- ═══════════════════════════════════════════════════════════════════
-- FIX: Add missing columns referenced by migration 006 functions
-- ═══════════════════════════════════════════════════════════════════

-- positions.deleted_at (referenced in 006 RLS but never created)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- current_prices.is_active (referenced in 006 indexes)
ALTER TABLE current_prices ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- price_history.is_active (referenced in 006 indexes)
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: cron_runs — job execution monitoring
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  portfolios_processed INTEGER DEFAULT 0,
  portfolios_failed INTEGER DEFAULT 0,
  error_details JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_date ON cron_runs(job_name, started_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON cron_runs FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: benchmark_prices — daily benchmark index data
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS benchmark_prices (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  change_pct NUMERIC,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_date ON benchmark_prices(symbol, date DESC);

ALTER TABLE benchmark_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON benchmark_prices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service write" ON benchmark_prices FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: leaderboard_history — daily leaderboard snapshots
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leaderboard_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  rankings JSONB NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (snapshot_date, category, period)
);

ALTER TABLE leaderboard_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON leaderboard_history FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service write" ON leaderboard_history FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: portfolio_alerts — concentration risk alerts
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  is_dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_active
  ON portfolio_alerts(portfolio_id) WHERE NOT is_dismissed;

ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access" ON portfolio_alerts FOR ALL
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════
-- ALTER portfolio_snapshots: add new metric columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS twr NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS mwr NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS calmar_ratio NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS var_95 NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS tracking_error NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS information_ratio NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_mtd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_ytd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_total NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS portfolio_yield NUMERIC;

-- ═══════════════════════════════════════════════════════════════════
-- ALTER profiles: add badges column
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]'::jsonb;

-- ═══════════════════════════════════════════════════════════════════
-- Refresh statistics
-- ═══════════════════════════════════════════════════════════════════

ANALYZE cron_runs;
ANALYZE benchmark_prices;
ANALYZE leaderboard_history;
ANALYZE portfolio_alerts;
ANALYZE portfolio_snapshots;
ANALYZE positions;
ANALYZE current_prices;
ANALYZE price_history;
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `npx supabase db push` or apply via Supabase dashboard SQL editor.
Expected: Migration runs without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_analytics_overhaul.sql
git commit -m "feat(db): add migration 007 — analytics overhaul tables and columns"
```

---

### Task 2: Add cron monitoring to snapshot system

**Files:**
- Modify: `src/lib/services/snapshots.ts`
- Modify: `src/app/api/cron/snapshots/route.ts`
- Create: `src/app/api/cron/status/route.ts`

- [ ] **Step 1: Add cron_runs logging to snapshots.ts**

Add to `src/lib/services/snapshots.ts` — new function after `createAdminSupabase()`:

```typescript
// ─── Cron Monitoring ────────────────────────────────────────────────────────

export async function startCronRun(
  supabase: SupabaseClient,
  jobName: string
): Promise<string> {
  const { data } = await supabase
    .from('cron_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()
  return data?.id ?? ''
}

export async function finishCronRun(
  supabase: SupabaseClient,
  runId: string,
  result: { processed: number; errors: number; errorDetails?: unknown }
): Promise<void> {
  if (!runId) return
  const status = result.errors === 0 ? 'success' : result.processed > 0 ? 'partial' : 'failed'
  await supabase
    .from('cron_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      portfolios_processed: result.processed,
      portfolios_failed: result.errors,
      error_details: result.errorDetails ?? null,
      duration_ms: Date.now(), // will be calculated in route
    })
    .eq('id', runId)
}
```

- [ ] **Step 2: Update cron route to use monitoring**

Rewrite `src/app/api/cron/snapshots/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import {
  runNightlySnapshots,
  refreshLeaderboard,
  createAdminSupabase,
  startCronRun,
  finishCronRun,
} from '@/lib/services/snapshots'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const startTime = Date.now()
  const runId = await startCronRun(supabase, 'nightly_snapshots')

  try {
    // 1. Snapshots
    const snapshotResult = await runNightlySnapshots()

    // 2. Archive leaderboard to history BEFORE refreshing
    const { data: currentLeaderboard } = await supabase
      .from('leaderboard_cache')
      .select('category, period, rankings')

    if (currentLeaderboard && currentLeaderboard.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      const historyRows = currentLeaderboard.map((row) => ({
        snapshot_date: today,
        category: row.category,
        period: row.period,
        rankings: row.rankings,
      }))
      await supabase
        .from('leaderboard_history')
        .upsert(historyRows, { onConflict: 'snapshot_date,category,period' })
    }

    // 3. Refresh leaderboard
    await refreshLeaderboard()

    const duration = Date.now() - startTime
    await finishCronRun(supabase, runId, {
      processed: snapshotResult.processed,
      errors: snapshotResult.errors,
    })

    // Update duration_ms properly
    await supabase
      .from('cron_runs')
      .update({ duration_ms: duration })
      .eq('id', runId)

    return NextResponse.json({
      success: true,
      snapshots: { processed: snapshotResult.processed, errors: snapshotResult.errors },
      leaderboard: 'refreshed',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    await finishCronRun(supabase, runId, {
      processed: 0,
      errors: 1,
      errorDetails: { message: err instanceof Error ? err.message : 'Unknown error' },
    })
    await supabase.from('cron_runs').update({ duration_ms: duration }).eq('id', runId)

    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error', duration: `${duration}ms` },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Create cron status endpoint**

Create `src/app/api/cron/status/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/services/snapshots'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()

  const { data: runs } = await supabase
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(14)

  const lastSuccess = runs?.find((r) => r.status === 'success')
  const lastRun = runs?.[0]
  const hoursSinceSuccess = lastSuccess
    ? (Date.now() - new Date(lastSuccess.started_at).getTime()) / (1000 * 60 * 60)
    : Infinity

  return NextResponse.json({
    healthy: hoursSinceSuccess < 26,
    lastRun,
    lastSuccess,
    hoursSinceLastSuccess: Math.round(hoursSinceSuccess * 10) / 10,
    recentRuns: runs,
  })
}
```

- [ ] **Step 4: Run tests and verify build**

Run: `cd C:/Users/ponye/Projects/investment-portfolio && npm run build`
Expected: Build succeeds without type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/snapshots.ts src/app/api/cron/snapshots/route.ts src/app/api/cron/status/route.ts
git commit -m "feat(cron): add monitoring, leaderboard history archival, and health endpoint"
```

---

### Task 3: Snapshot backfill endpoint

**Files:**
- Create: `src/app/api/cron/snapshots/backfill/route.ts`

- [ ] **Step 1: Create backfill route**

```typescript
import { NextResponse } from 'next/server'
import { createAdminSupabase, computePortfolioSnapshot } from '@/lib/services/snapshots'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to') || new Date().toISOString().split('T')[0]
  const portfolioId = url.searchParams.get('portfolio_id')

  if (!from) {
    return NextResponse.json({ error: 'Missing "from" date parameter' }, { status: 400 })
  }

  const supabase = createAdminSupabase()

  // Get portfolios to backfill
  let portfolioIds: string[] = []
  if (portfolioId) {
    portfolioIds = [portfolioId]
  } else {
    const { data } = await supabase.from('portfolios').select('id')
    portfolioIds = data?.map((p) => p.id) ?? []
  }

  // Generate date range
  const dates: string[] = []
  const current = new Date(from)
  const end = new Date(to)
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }

  let processed = 0
  let errors = 0

  for (const date of dates) {
    for (const pid of portfolioIds) {
      try {
        const snapshot = await computePortfolioSnapshot(supabase, pid, date)
        if (snapshot) {
          await supabase
            .from('portfolio_snapshots')
            .upsert(snapshot, { onConflict: 'portfolio_id,snapshot_date' })
          processed++
        }
      } catch (err) {
        console.error(`[backfill] Failed ${pid} on ${date}:`, err)
        errors++
      }
    }
    // Pause between dates to respect rate limits
    await new Promise((r) => setTimeout(r, 1000))
  }

  return NextResponse.json({ processed, errors, dates: dates.length, portfolios: portfolioIds.length })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/snapshots/backfill/route.ts
git commit -m "feat(cron): add snapshot backfill endpoint"
```

---

### Task 4: Return calculation service (TWR + MWR)

**Files:**
- Create: `src/lib/services/returns.ts`
- Create: `tests/lib/services/returns.test.ts`

- [ ] **Step 1: Write failing tests for return calculations**

Create `tests/lib/services/returns.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSimpleReturn, calculateTWR, calculateMWR } from '@/lib/services/returns'

describe('calculateSimpleReturn', () => {
  it('calculates positive return', () => {
    expect(calculateSimpleReturn(11000, 10000)).toBeCloseTo(10, 1)
  })

  it('calculates negative return', () => {
    expect(calculateSimpleReturn(9000, 10000)).toBeCloseTo(-10, 1)
  })

  it('returns 0 when cost is 0', () => {
    expect(calculateSimpleReturn(100, 0)).toBe(0)
  })
})

describe('calculateTWR', () => {
  it('calculates TWR with no cash flows', () => {
    // Portfolio goes from 10000 to 11000 over 3 snapshots
    const snapshots = [
      { date: '2026-01-01', value: 10000 },
      { date: '2026-01-02', value: 10500 },
      { date: '2026-01-03', value: 11000 },
    ]
    const result = calculateTWR(snapshots, [])
    expect(result).toBeCloseTo(10, 0) // ~10% total return
  })

  it('calculates TWR ignoring cash flow timing', () => {
    // Deposit right before a drop, then recovery
    const snapshots = [
      { date: '2026-01-01', value: 10000 },
      { date: '2026-01-02', value: 10000 }, // value before deposit
      { date: '2026-01-03', value: 18000 }, // 20000 after deposit, dropped to 18000
      { date: '2026-01-04', value: 20000 }, // recovered
    ]
    const cashFlows = [
      { date: '2026-01-02', amount: 10000 }, // deposit of 10000
    ]
    const result = calculateTWR(snapshots, cashFlows)
    // Sub-period 1: 10000→10000 = 0%
    // Sub-period 2: 20000→18000 = -10% (value after deposit was 20000)
    // Sub-period 3: 18000→20000 = +11.1%
    // TWR = (1+0)(1-0.10)(1+0.111) - 1 ≈ 0%
    expect(result).toBeCloseTo(0, 0)
  })
})

describe('calculateMWR', () => {
  it('calculates MWR for simple growth', () => {
    const cashFlows = [
      { date: '2026-01-01', amount: -10000 }, // invest 10000
    ]
    const currentValue = 11000
    const endDate = new Date('2026-12-31')
    const result = calculateMWR(cashFlows, currentValue, endDate)
    expect(result).toBeGreaterThan(5) // should be ~10% annualized
    expect(result).toBeLessThan(15)
  })

  it('returns 0 when no cash flows', () => {
    expect(calculateMWR([], 0, new Date())).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run tests/lib/services/returns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement returns service**

Create `src/lib/services/returns.ts`:

```typescript
/**
 * Return Calculations Service
 *
 * Implements three return methodologies:
 * - Simple Return: (value - cost) / cost
 * - TWR (Time-Weighted): Strategy performance, independent of cash flows
 * - MWR (Money-Weighted / IRR): Personal return accounting for timing
 */

type Snapshot = { date: string; value: number }
type CashFlow = { date: string; amount: number }

/**
 * Simple return as percentage.
 */
export function calculateSimpleReturn(currentValue: number, totalCost: number): number {
  if (totalCost === 0) return 0
  return ((currentValue - totalCost) / totalCost) * 100
}

/**
 * Time-Weighted Return (TWR).
 *
 * Splits timeline into sub-periods at each cash flow event.
 * Each sub-period: Ri = (V_end / V_start) - 1
 * TWR = Π(1 + Ri) - 1
 *
 * Returns percentage (e.g., 10.5 for 10.5%).
 */
export function calculateTWR(snapshots: Snapshot[], cashFlows: CashFlow[]): number {
  if (snapshots.length < 2) return 0

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  if (cashFlows.length === 0) {
    // No cash flows — simple start-to-end return
    const startVal = sorted[0].value
    const endVal = sorted[sorted.length - 1].value
    if (startVal === 0) return 0
    return ((endVal / startVal) - 1) * 100
  }

  // Sort cash flows by date
  const sortedCF = [...cashFlows].sort((a, b) => a.date.localeCompare(b.date))

  // Build sub-periods between cash flow events
  let chainedReturn = 1
  let subPeriodStart = sorted[0].value

  for (const cf of sortedCF) {
    // Find snapshot value just before this cash flow
    const beforeCF = sorted
      .filter((s) => s.date <= cf.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0]

    if (!beforeCF || subPeriodStart === 0) continue

    const subReturn = beforeCF.value / subPeriodStart
    chainedReturn *= subReturn

    // New sub-period starts at value + cash flow
    subPeriodStart = beforeCF.value + cf.amount
  }

  // Final sub-period: last cash flow to end
  const endVal = sorted[sorted.length - 1].value
  if (subPeriodStart > 0) {
    chainedReturn *= endVal / subPeriodStart
  }

  return (chainedReturn - 1) * 100
}

/**
 * Money-Weighted Return (MWR / IRR).
 *
 * Uses Newton-Raphson to solve for the rate where NPV of cash flows = 0.
 * Cash flows: investments are negative, withdrawals/current value are positive.
 *
 * Returns annualized percentage.
 */
export function calculateMWR(
  cashFlows: CashFlow[],
  currentValue: number,
  endDate: Date
): number {
  if (cashFlows.length === 0 || currentValue === 0) return 0

  // Build all flows with day offsets
  const allFlows = cashFlows.map((cf) => ({
    amount: cf.amount,
    days: (new Date(cf.date).getTime() - new Date(cashFlows[0].date).getTime()) / (1000 * 60 * 60 * 24),
  }))

  // Add current value as final positive flow
  const totalDays = (endDate.getTime() - new Date(cashFlows[0].date).getTime()) / (1000 * 60 * 60 * 24)
  if (totalDays <= 0) return 0

  allFlows.push({ amount: currentValue, days: totalDays })

  // Newton-Raphson to find daily rate
  let rate = 0.0001 // initial guess (daily)
  const maxIterations = 100
  const tolerance = 1e-8

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0
    let derivative = 0

    for (const flow of allFlows) {
      const discountFactor = Math.pow(1 + rate, flow.days)
      if (!isFinite(discountFactor) || discountFactor === 0) break
      npv += flow.amount / discountFactor
      derivative -= (flow.days * flow.amount) / (discountFactor * (1 + rate))
    }

    if (Math.abs(derivative) < 1e-12) break
    const newRate = rate - npv / derivative

    if (Math.abs(newRate - rate) < tolerance) {
      rate = newRate
      break
    }
    rate = newRate
  }

  // Annualize: (1 + daily_rate)^365 - 1
  const annualReturn = (Math.pow(1 + rate, 365) - 1) * 100
  return isFinite(annualReturn) ? Math.round(annualReturn * 100) / 100 : 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run tests/lib/services/returns.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/returns.ts tests/lib/services/returns.test.ts
git commit -m "feat(services): add TWR, MWR, and simple return calculations with tests"
```

---

### Task 5: Benchmark data service

**Files:**
- Create: `src/lib/services/benchmarks.ts`

- [ ] **Step 1: Create benchmark service**

```typescript
/**
 * Benchmark Data Service
 *
 * Fetches and stores daily benchmark prices (SPY, IPC, QQQ, ACWI).
 * Data source priority: Twelve Data → Finnhub → Yahoo Finance.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

export const BENCHMARKS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', currency: 'USD' },
  { symbol: 'QQQ', name: 'NASDAQ 100 ETF', currency: 'USD' },
] as const

export type BenchmarkSymbol = (typeof BENCHMARKS)[number]['symbol']

/**
 * Fetch today's benchmark close prices and store them.
 */
export async function fetchAndStoreBenchmarks(supabase: SupabaseClient): Promise<number> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  let stored = 0
  const today = new Date().toISOString().split('T')[0]

  for (const benchmark of BENCHMARKS) {
    try {
      let close: number | null = null

      // Try Twelve Data first
      if (apiKey) {
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${benchmark.symbol}&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (res.ok) {
          const data = await res.json()
          if (data.price) close = parseFloat(data.price)
        }
      }

      // Fallback to Finnhub
      if (close === null && process.env.FINNHUB_API_KEY) {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${benchmark.symbol}&token=${process.env.FINNHUB_API_KEY}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (res.ok) {
          const data = await res.json()
          if (data.c) close = data.c
        }
      }

      if (close !== null) {
        // Get yesterday's close for change_pct
        const { data: yesterday } = await supabase
          .from('benchmark_prices')
          .select('close')
          .eq('symbol', benchmark.symbol)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .single()

        const changePct = yesterday
          ? ((close - yesterday.close) / yesterday.close) * 100
          : null

        await supabase.from('benchmark_prices').upsert(
          { symbol: benchmark.symbol, date: today, close, change_pct: changePct },
          { onConflict: 'symbol,date' }
        )
        stored++
      }

      // Rate limit delay
      await new Promise((r) => setTimeout(r, 1500))
    } catch (err) {
      console.error(`[benchmarks] Failed to fetch ${benchmark.symbol}:`, err)
    }
  }

  return stored
}

/**
 * Get benchmark prices for a date range, normalized to start at 100.
 */
export async function getBenchmarkSeries(
  supabase: SupabaseClient,
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<{ dates: string[]; values: number[] }> {
  const { data } = await supabase
    .from('benchmark_prices')
    .select('date, close')
    .eq('symbol', symbol)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })

  if (!data || data.length === 0) return { dates: [], values: [] }

  const startClose = data[0].close
  return {
    dates: data.map((d) => d.date),
    values: data.map((d) => (d.close / startClose) * 100),
  }
}
```

- [ ] **Step 2: Integrate benchmark fetch into cron**

Add to the cron route `src/app/api/cron/snapshots/route.ts`, after leaderboard refresh:

```typescript
import { fetchAndStoreBenchmarks } from '@/lib/services/benchmarks'

// ... inside the try block, after refreshLeaderboard():

    // 4. Fetch benchmark prices
    const benchmarksStored = await fetchAndStoreBenchmarks(supabase)
```

- [ ] **Step 3: Add new cache key**

Add to `src/lib/cache/redis.ts` CACHE_KEYS:

```typescript
  DASHBOARD_SUMMARY: 'dashboard:summary:',
  ANALYTICS_RETURNS: 'analytics:returns:',
  ANALYTICS_ATTRIBUTION: 'analytics:attribution:',
  ANALYTICS_INCOME: 'analytics:income:',
  BENCHMARK: 'benchmark:',
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/benchmarks.ts src/app/api/cron/snapshots/route.ts src/lib/cache/redis.ts
git commit -m "feat(benchmarks): add benchmark data pipeline with Twelve Data + Finnhub fallback"
```

---

### Task 6: Fix allocation to use market value

**Files:**
- Modify: `src/app/api/analytics/[pid]/allocation/route.ts`

- [ ] **Step 1: Update allocation to use current prices**

Replace the data fetching logic in `src/app/api/analytics/[pid]/allocation/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_ALLOCATION}${pid}`,
    300,
    async () => {
      // Get positions
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, asset_type, quantity, avg_cost, currency')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return { byType: [], bySymbol: [], total: 0 }

      // Get current prices for all position symbols
      const symbols = positions.map((p) => p.symbol)
      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of prices ?? []) {
        priceMap[p.symbol] = p.price
      }

      // Get sector data from company_data
      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector, market_cap')
        .in('symbol', symbols)

      const sectorMap: Record<string, string> = {}
      const capMap: Record<string, number> = {}
      for (const c of companies ?? []) {
        sectorMap[c.symbol] = c.sector ?? 'Unknown'
        capMap[c.symbol] = c.market_cap ?? 0
      }

      // Calculate using market value (current price), fallback to avg_cost
      const byType: Record<string, number> = {}
      const bySector: Record<string, number> = {}
      const bySymbol: Array<{ symbol: string; value: number; pct: number; stale: boolean }> = []
      let total = 0

      for (const pos of positions) {
        const currentPrice = priceMap[pos.symbol]
        const value = pos.quantity * (currentPrice ?? pos.avg_cost)
        const stale = !currentPrice
        total += value
        byType[pos.asset_type] = (byType[pos.asset_type] || 0) + value
        bySector[sectorMap[pos.symbol] ?? 'Unknown'] = (bySector[sectorMap[pos.symbol] ?? 'Unknown'] || 0) + value
        bySymbol.push({ symbol: pos.symbol, value, pct: 0, stale })
      }

      bySymbol.forEach((s) => { s.pct = total > 0 ? (s.value / total) * 100 : 0 })

      return {
        byType: Object.entries(byType).map(([name, value]) => ({
          name,
          value,
          pct: total > 0 ? (value / total) * 100 : 0,
        })),
        bySector: Object.entries(bySector).map(([name, value]) => ({
          name,
          value,
          pct: total > 0 ? (value / total) * 100 : 0,
        })),
        bySymbol: bySymbol.sort((a, b) => b.value - a.value),
        total,
      }
    }
  )
  return success(data)
}
```

- [ ] **Step 2: Verify build**

Run: `cd C:/Users/ponye/Projects/investment-portfolio && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/[pid]/allocation/route.ts
git commit -m "fix(allocation): use market value instead of cost basis, add sector breakdown"
```

---

## Chunk 2: Dashboard P&L + Position P&L (Phase C1 + C4)

### Task 7: Dashboard summary API

**Files:**
- Create: `src/app/api/dashboard/summary/route.ts`

- [ ] **Step 1: Create dashboard summary endpoint**

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.DASHBOARD_SUMMARY}${user.id}`,
    120, // 2 minutes
    async () => {
      // Get all user portfolios with positions
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (!portfolios || portfolios.length === 0) {
        return { total_value: 0, total_cost: 0, total_return: 0, total_return_pct: 0, daily_change: 0, daily_change_pct: 0, weekly_change: 0, weekly_change_pct: 0, best_position: null, worst_position: null }
      }

      const pids = portfolios.map((p) => p.id)

      // Get all positions with current prices
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost, portfolio_id')
        .in('portfolio_id', pids)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) {
        return { total_value: 0, total_cost: 0, total_return: 0, total_return_pct: 0, daily_change: 0, daily_change_pct: 0, weekly_change: 0, weekly_change_pct: 0, best_position: null, worst_position: null }
      }

      const symbols = [...new Set(positions.map((p) => p.symbol))]
      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of prices ?? []) priceMap[p.symbol] = p.price

      // Calculate totals
      let totalValue = 0
      let totalCost = 0
      let bestPos = { symbol: '', pct: -Infinity }
      let worstPos = { symbol: '', pct: Infinity }

      for (const pos of positions) {
        const price = priceMap[pos.symbol] ?? pos.avg_cost
        const value = pos.quantity * price
        const cost = pos.quantity * pos.avg_cost
        totalValue += value
        totalCost += cost

        const pct = cost > 0 ? ((value - cost) / cost) * 100 : 0
        if (pct > bestPos.pct) bestPos = { symbol: pos.symbol, pct }
        if (pct < worstPos.pct) worstPos = { symbol: pos.symbol, pct }
      }

      const totalReturn = totalValue - totalCost
      const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

      // Get yesterday's and last week's snapshots for change calculation
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const lastWeek = new Date(today)
      lastWeek.setDate(lastWeek.getDate() - 7)

      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('portfolio_id, snapshot_date, total_value')
        .in('portfolio_id', pids)
        .gte('snapshot_date', lastWeek.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false })

      let yesterdayTotal = 0
      let weekAgoTotal = 0
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      const weekAgoStr = lastWeek.toISOString().split('T')[0]

      for (const pid of pids) {
        const pidSnaps = snapshots?.filter((s) => s.portfolio_id === pid) ?? []
        const ySnap = pidSnaps.find((s) => s.snapshot_date <= yesterdayStr)
        const wSnap = pidSnaps.find((s) => s.snapshot_date <= weekAgoStr)
        if (ySnap) yesterdayTotal += ySnap.total_value
        if (wSnap) weekAgoTotal += wSnap.total_value
      }

      const dailyChange = yesterdayTotal > 0 ? totalValue - yesterdayTotal : 0
      const dailyChangePct = yesterdayTotal > 0 ? (dailyChange / yesterdayTotal) * 100 : 0
      const weeklyChange = weekAgoTotal > 0 ? totalValue - weekAgoTotal : 0
      const weeklyChangePct = weekAgoTotal > 0 ? (weeklyChange / weekAgoTotal) * 100 : 0

      return {
        total_value: Math.round(totalValue * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        total_return: Math.round(totalReturn * 100) / 100,
        total_return_pct: Math.round(totalReturnPct * 100) / 100,
        daily_change: Math.round(dailyChange * 100) / 100,
        daily_change_pct: Math.round(dailyChangePct * 100) / 100,
        weekly_change: Math.round(weeklyChange * 100) / 100,
        weekly_change_pct: Math.round(weeklyChangePct * 100) / 100,
        best_position: bestPos.symbol ? bestPos : null,
        worst_position: worstPos.symbol ? worstPos : null,
      }
    }
  )
  return success(data)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/dashboard/summary/route.ts
git commit -m "feat(dashboard): add aggregated P&L summary endpoint"
```

---

### Task 8: Enrich portfolio positions with P&L

**Files:**
- Modify: `src/lib/services/portfolio.ts` (add P&L enrichment function)

- [ ] **Step 1: Add enrichPositionsWithPnL function**

Add to `src/lib/services/portfolio.ts`:

```typescript
/**
 * Enrich positions with current prices, P&L, and sparkline data.
 */
export async function enrichPositionsWithPnL(
  supabase: SupabaseClient,
  positions: Array<{ symbol: string; quantity: number; avg_cost: number; [key: string]: unknown }>
): Promise<Array<{
  symbol: string
  quantity: number
  avg_cost: number
  current_price: number
  market_value: number
  pnl_absolute: number
  pnl_percent: number
  daily_change: number
  daily_change_pct: number
  sparkline_7d: number[]
  is_stale: boolean
  [key: string]: unknown
}>> {
  if (positions.length === 0) return []

  const symbols = positions.map((p) => p.symbol)

  // Get current prices
  const { data: prices } = await supabase
    .from('current_prices')
    .select('symbol, price, fetched_at')
    .in('symbol', symbols)

  const priceMap: Record<string, { price: number; fetched_at: string }> = {}
  for (const p of prices ?? []) priceMap[p.symbol] = p

  // Get last 7 days of price history for sparklines
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const { data: history } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .gte('date', sevenDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const sparkMap: Record<string, number[]> = {}
  for (const h of history ?? []) {
    if (!sparkMap[h.symbol]) sparkMap[h.symbol] = []
    sparkMap[h.symbol].push(h.close)
  }

  // Get yesterday's close for daily change
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const prevCloseMap: Record<string, number> = {}
  for (const sym of symbols) {
    const closes = sparkMap[sym] ?? []
    // Find the close for yesterday or the most recent before today
    if (closes.length >= 2) {
      prevCloseMap[sym] = closes[closes.length - 2]
    }
  }

  const now = Date.now()
  const staleThreshold = 24 * 60 * 60 * 1000 // 24 hours

  return positions.map((pos) => {
    const priceData = priceMap[pos.symbol]
    const currentPrice = priceData?.price ?? pos.avg_cost
    const isStale = priceData
      ? now - new Date(priceData.fetched_at).getTime() > staleThreshold
      : true

    const marketValue = pos.quantity * currentPrice
    const costBasis = pos.quantity * pos.avg_cost
    const pnlAbsolute = marketValue - costBasis
    const pnlPercent = costBasis > 0 ? (pnlAbsolute / costBasis) * 100 : 0

    const prevClose = prevCloseMap[pos.symbol]
    const dailyChange = prevClose ? (currentPrice - prevClose) * pos.quantity : 0
    const dailyChangePct = prevClose && prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0

    return {
      ...pos,
      current_price: currentPrice,
      market_value: Math.round(marketValue * 100) / 100,
      pnl_absolute: Math.round(pnlAbsolute * 100) / 100,
      pnl_percent: Math.round(pnlPercent * 100) / 100,
      daily_change: Math.round(dailyChange * 100) / 100,
      daily_change_pct: Math.round(dailyChangePct * 100) / 100,
      sparkline_7d: sparkMap[pos.symbol] ?? [],
      is_stale: isStale,
    }
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/services/portfolio.ts
git commit -m "feat(portfolio): add position P&L enrichment with sparklines and daily change"
```

---

## Chunk 3: Historical Chart + Leaderboard History + Winners/Losers (Phase C2 + C3)

### Task 9: Update portfolio history to use snapshots

**Files:**
- Modify: `src/app/api/portfolio/history/route.ts`

- [ ] **Step 1: Add snapshot-based data source**

Add at the beginning of the GET handler in `src/app/api/portfolio/history/route.ts`, before the transaction-based reconstruction. Insert this block after the cache check:

```typescript
  // PRIMARY SOURCE: Use portfolio_snapshots if available
  const { data: snapshotData } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value')
    .in('portfolio_id', portfolioIds)
    .gte('snapshot_date', cutoffStr)
    .order('snapshot_date', { ascending: true })

  if (snapshotData && snapshotData.length >= 7) {
    // Aggregate across portfolios by date
    const dateValues: Record<string, number> = {}
    for (const snap of snapshotData) {
      dateValues[snap.snapshot_date] = (dateValues[snap.snapshot_date] || 0) + snap.total_value
    }

    const timeline = Object.entries(dateValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }))

    // Add benchmark overlay
    const { getBenchmarkSeries } = await import('@/lib/services/benchmarks')
    const benchmarkData = await getBenchmarkSeries(supabase, 'SPY', cutoffStr, new Date().toISOString().split('T')[0])

    // Normalize portfolio to start at 100 for comparison
    const startValue = timeline[0]?.value || 1
    const normalizedPortfolio = timeline.map((t) => ({
      date: t.date,
      value: t.value,
      normalized: (t.value / startValue) * 100,
    }))

    const result = {
      timeline: normalizedPortfolio,
      benchmark: benchmarkData,
      benchmarkSymbol: 'SPY',
      source: 'snapshots',
    }

    await cacheSet(cacheKey, result, range === 'max' || parseInt(range) > 30 ? 600 : 120)
    return success(result)
  }

  // FALLBACK: Reconstruct from transactions + price_history (existing code below)
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/portfolio/history/route.ts
git commit -m "feat(history): use snapshots as primary data source with benchmark overlay"
```

---

### Task 10: Leaderboard history and winners/losers endpoints

**Files:**
- Create: `src/app/api/discover/leaderboard/history/route.ts`
- Create: `src/app/api/discover/winners/route.ts`

- [ ] **Step 1: Create leaderboard history endpoint**

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || 'return'
  const period = url.searchParams.get('period') || '1M'
  const days = parseInt(url.searchParams.get('days') || '30')

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  const { data } = await supabase
    .from('leaderboard_history')
    .select('snapshot_date, rankings')
    .eq('category', category)
    .eq('period', period)
    .gte('snapshot_date', cutoff.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })

  return success(data ?? [])
}
```

- [ ] **Step 2: Create winners/losers endpoint**

Create `src/app/api/discover/winners/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache('discover:winners', 300, async () => {
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Get today's and yesterday's snapshots for public portfolios
    const { data: todaySnaps } = await supabase
      .from('portfolio_snapshots')
      .select('portfolio_id, total_value, total_return_pct')
      .eq('snapshot_date', today)

    const { data: yesterdaySnaps } = await supabase
      .from('portfolio_snapshots')
      .select('portfolio_id, total_value')
      .eq('snapshot_date', yesterdayStr)

    if (!todaySnaps || !yesterdaySnaps) return { winners: [], losers: [] }

    const yesterdayMap: Record<string, number> = {}
    for (const s of yesterdaySnaps) yesterdayMap[s.portfolio_id] = s.total_value

    // Get public portfolio IDs
    const { data: publicPortfolios } = await supabase
      .from('portfolios')
      .select('id, name, user_id')
      .eq('visibility', 'public')
      .is('deleted_at', null)

    const publicIds = new Set(publicPortfolios?.map((p) => p.id) ?? [])
    const portfolioMap: Record<string, { name: string; user_id: string }> = {}
    for (const p of publicPortfolios ?? []) portfolioMap[p.id] = p

    const changes = todaySnaps
      .filter((s) => publicIds.has(s.portfolio_id) && yesterdayMap[s.portfolio_id])
      .map((s) => {
        const prev = yesterdayMap[s.portfolio_id]
        const change = s.total_value - prev
        const changePct = prev > 0 ? (change / prev) * 100 : 0
        return {
          portfolio_id: s.portfolio_id,
          name: portfolioMap[s.portfolio_id]?.name ?? 'Unknown',
          change: Math.round(change * 100) / 100,
          change_pct: Math.round(changePct * 100) / 100,
          total_value: s.total_value,
        }
      })
      .sort((a, b) => b.change_pct - a.change_pct)

    return {
      winners: changes.slice(0, 5),
      losers: changes.slice(-5).reverse(),
    }
  })

  return success(data)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/discover/leaderboard/history/route.ts src/app/api/discover/winners/route.ts
git commit -m "feat(discover): add leaderboard history and daily winners/losers endpoints"
```

---

## Chunk 4: Concentration Alerts + Advanced Returns + Risk Pro (Phase B2, B1, B5)

### Task 11: Concentration risk service and alerts endpoint

**Files:**
- Create: `src/lib/services/concentration.ts`
- Create: `src/app/api/portfolio/[id]/alerts/route.ts`
- Create: `src/app/api/portfolio/[id]/alerts/[aid]/route.ts`

- [ ] **Step 1: Create concentration service**

```typescript
/**
 * Concentration Risk Service
 *
 * Evaluates portfolio concentration and generates alerts.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

type ConcentrationAlert = {
  portfolio_id: string
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  details: Record<string, unknown>
}

export function evaluateConcentration(
  positions: Array<{ symbol: string; asset_type: string; value: number }>,
  totalValue: number,
  portfolioId: string,
  sectorMap?: Record<string, string>
): ConcentrationAlert[] {
  const alerts: ConcentrationAlert[] = []
  if (totalValue === 0) return alerts

  // Rule 1: Single position > 25% (warning), > 40% (critical)
  for (const pos of positions) {
    const weight = pos.value / totalValue
    if (weight > 0.40) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'position_concentration',
        severity: 'critical',
        message: `${pos.symbol} represents ${(weight * 100).toFixed(1)}% of your portfolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.40 },
      })
    } else if (weight > 0.25) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'position_concentration',
        severity: 'warning',
        message: `${pos.symbol} represents ${(weight * 100).toFixed(1)}% of your portfolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.25 },
      })
    }
  }

  // Rule 2: Sector > 50%
  if (sectorMap) {
    const sectorTotals: Record<string, number> = {}
    for (const pos of positions) {
      const sector = sectorMap[pos.symbol] ?? 'Unknown'
      sectorTotals[sector] = (sectorTotals[sector] || 0) + pos.value
    }
    for (const [sector, value] of Object.entries(sectorTotals)) {
      const weight = value / totalValue
      if (weight > 0.50 && sector !== 'Unknown') {
        alerts.push({
          portfolio_id: portfolioId,
          alert_type: 'sector_concentration',
          severity: 'warning',
          message: `${sector} sector is ${(weight * 100).toFixed(1)}% of your portfolio`,
          details: { sector, weight, threshold: 0.50 },
        })
      }
    }
  }

  // Rule 3: Single asset type > 80%
  const typeTotals: Record<string, number> = {}
  for (const pos of positions) {
    typeTotals[pos.asset_type] = (typeTotals[pos.asset_type] || 0) + pos.value
  }
  for (const [type, value] of Object.entries(typeTotals)) {
    const weight = value / totalValue
    if (weight > 0.80) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'asset_type_concentration',
        severity: 'warning',
        message: `${(weight * 100).toFixed(1)}% of your portfolio is in ${type}`,
        details: { asset_type: type, weight, threshold: 0.80 },
      })
    }
  }

  return alerts
}

export async function saveAlerts(
  supabase: SupabaseClient,
  alerts: ConcentrationAlert[]
): Promise<void> {
  if (alerts.length === 0) return

  // Clear existing non-dismissed alerts for these portfolios
  const portfolioIds = [...new Set(alerts.map((a) => a.portfolio_id))]
  for (const pid of portfolioIds) {
    await supabase
      .from('portfolio_alerts')
      .delete()
      .eq('portfolio_id', pid)
      .eq('is_dismissed', false)
  }

  // Insert new alerts
  await supabase.from('portfolio_alerts').insert(
    alerts.map((a) => ({
      ...a,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }))
  )
}
```

- [ ] **Step 2: Create alerts API routes**

Create `src/app/api/portfolio/[id]/alerts/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data } = await supabase
    .from('portfolio_alerts')
    .select('*')
    .eq('portfolio_id', id)
    .eq('is_dismissed', false)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: false })

  return success(data ?? [])
}
```

Create `src/app/api/portfolio/[id]/alerts/[aid]/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { aid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('portfolio_alerts')
    .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
    .eq('id', aid)

  if (dbError) return error(dbError.message, 500)
  return success({ dismissed: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/concentration.ts src/app/api/portfolio/[id]/alerts/route.ts src/app/api/portfolio/[id]/alerts/[aid]/route.ts
git commit -m "feat(alerts): add concentration risk evaluation and alerts CRUD"
```

---

### Task 12: Advanced returns endpoint

**Files:**
- Create: `src/app/api/analytics/[pid]/returns/route.ts`

- [ ] **Step 1: Create returns endpoint**

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { calculateSimpleReturn, calculateTWR, calculateMWR } from '@/lib/services/returns'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1Y'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_RETURNS}${pid}:${period}`,
    600,
    async () => {
      // Get snapshots
      const cutoff = getPeriodCutoff(period)
      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('portfolio_id', pid)
        .gte('snapshot_date', cutoff)
        .order('snapshot_date', { ascending: true })

      // Get transactions for TWR/MWR
      const { data: transactions } = await supabase
        .from('transactions')
        .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id)')
        .eq('position.portfolio_id', pid)
        .gte('executed_at', cutoff)
        .order('executed_at', { ascending: true })

      const snaps = (snapshots ?? []).map((s) => ({ date: s.snapshot_date, value: s.total_value }))
      const lastSnap = snapshots?.[snapshots.length - 1]
      const firstSnap = snapshots?.[0]

      // Simple return
      const simple = lastSnap && firstSnap
        ? calculateSimpleReturn(lastSnap.total_value, lastSnap.total_cost)
        : 0

      // TWR
      const cashFlows = (transactions ?? [])
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: (t.executed_at as string).split('T')[0],
          amount: t.type === 'buy' ? -(t.quantity as number) * (t.price as number) : (t.quantity as number) * (t.price as number),
        }))

      const twr = calculateTWR(snaps, cashFlows)
      const mwr = lastSnap
        ? calculateMWR(cashFlows, lastSnap.total_value, new Date())
        : 0

      // Calendar returns (monthly)
      const calendar = buildCalendarReturns(snapshots ?? [])

      // Period comparison table
      const periods = await buildPeriodReturns(supabase, pid)

      return { summary: { simple, twr, mwr, period }, calendar, periods }
    }
  )

  return success(data)
}

function getPeriodCutoff(period: string): string {
  const now = new Date()
  switch (period) {
    case '1M': now.setMonth(now.getMonth() - 1); break
    case '3M': now.setMonth(now.getMonth() - 3); break
    case '6M': now.setMonth(now.getMonth() - 6); break
    case 'YTD': now.setMonth(0); now.setDate(1); break
    case '1Y': now.setFullYear(now.getFullYear() - 1); break
    case 'ALL': now.setFullYear(2020); break
    default: now.setFullYear(now.getFullYear() - 1)
  }
  return now.toISOString().split('T')[0]
}

function buildCalendarReturns(snapshots: Array<{ snapshot_date: string; total_value: number }>) {
  const monthly: Record<string, { start: number; end: number }> = {}
  for (const snap of snapshots) {
    const month = snap.snapshot_date.slice(0, 7) // YYYY-MM
    if (!monthly[month]) monthly[month] = { start: snap.total_value, end: snap.total_value }
    monthly[month].end = snap.total_value
  }

  const years: Record<number, (number | null)[]> = {}
  for (const [month, data] of Object.entries(monthly)) {
    const [yearStr, monthStr] = month.split('-')
    const year = parseInt(yearStr)
    const monthIdx = parseInt(monthStr) - 1
    if (!years[year]) years[year] = new Array(12).fill(null)
    years[year][monthIdx] = data.start > 0 ? ((data.end - data.start) / data.start) * 100 : 0
  }

  return Object.entries(years).map(([year, months]) => ({
    year: parseInt(year),
    months,
    total: months.reduce((sum: number, m) => sum + (m ?? 0), 0),
  }))
}

async function buildPeriodReturns(supabase: ReturnType<typeof import('@/lib/supabase/server').createServerSupabase extends () => Promise<infer T> ? () => T : never>, pid: string) {
  // Simplified — returns basic period comparison
  return []
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/analytics/[pid]/returns/route.ts
git commit -m "feat(analytics): add advanced returns endpoint with TWR, MWR, calendar returns"
```

---

### Task 13: Enhanced risk endpoint

**Files:**
- Modify: `src/app/api/analytics/[pid]/risk/route.ts`

- [ ] **Step 1: Enhance risk endpoint with new metrics**

Add drawdown series, rolling volatility, and new metrics to the existing risk route. Add these calculations after the existing metrics:

```typescript
      // NEW: Calmar Ratio
      const cagr = returns.length > 0
        ? (Math.pow(1 + mean(returns), TRADING_DAYS) - 1)
        : 0
      const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : 0

      // NEW: VaR 95%
      const sortedReturns = [...returns].sort((a, b) => a - b)
      const var95Index = Math.floor(returns.length * 0.05)
      const var95 = sortedReturns[var95Index] ? Math.abs(sortedReturns[var95Index]) * totalValue : 0

      // NEW: Drawdown series
      const drawdownSeries = values.map((_, i) => {
        const peak = Math.max(...values.slice(0, i + 1))
        return peak > 0 ? -((peak - values[i]) / peak) * 100 : 0
      })
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/analytics/[pid]/risk/route.ts
git commit -m "feat(risk): add Calmar ratio, VaR 95%, drawdown series to risk endpoint"
```

---

## Chunk 5: Income + Attribution + Social (Phase B3, B4, B6)

### Task 14: Income/dividend analytics endpoint

**Files:**
- Create: `src/lib/services/dividend-analytics.ts`
- Create: `src/app/api/analytics/[pid]/income/route.ts`

- [ ] **Step 1: Create dividend analytics service**

```typescript
import { type SupabaseClient } from '@supabase/supabase-js'

export async function getIncomeAnalytics(supabase: SupabaseClient, portfolioId: string) {
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const monthStart = `${now.toISOString().slice(0, 7)}-01`

  // Get dividend transactions
  const { data: dividends } = await supabase
    .from('transactions')
    .select('quantity, price, executed_at, position:positions!inner(portfolio_id, symbol)')
    .eq('type', 'dividend')
    .eq('position.portfolio_id', portfolioId)
    .order('executed_at', { ascending: true })

  const allDivs = dividends ?? []

  // MTD, YTD, all-time
  let mtd = 0, ytd = 0, allTime = 0
  const monthlyHistory: Record<string, number> = {}

  for (const d of allDivs) {
    const amount = (d.quantity as number) * (d.price as number)
    const date = d.executed_at as string
    allTime += amount
    if (date >= yearStart) ytd += amount
    if (date >= monthStart) mtd += amount

    const month = date.slice(0, 7)
    monthlyHistory[month] = (monthlyHistory[month] || 0) + amount
  }

  return {
    summary: { mtd, ytd, all_time: allTime },
    monthly_history: Object.entries(monthlyHistory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount })),
  }
}
```

- [ ] **Step 2: Create income endpoint**

Create `src/app/api/analytics/[pid]/income/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { getIncomeAnalytics } from '@/lib/services/dividend-analytics'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_INCOME}${pid}`,
    600,
    () => getIncomeAnalytics(supabase, pid)
  )
  return success(data)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/dividend-analytics.ts src/app/api/analytics/[pid]/income/route.ts
git commit -m "feat(income): add dividend/income analytics service and endpoint"
```

---

### Task 15: Attribution analysis endpoint

**Files:**
- Create: `src/lib/services/attribution.ts`
- Create: `src/app/api/analytics/[pid]/attribution/route.ts`

- [ ] **Step 1: Create attribution service**

```typescript
/**
 * BHB Attribution Analysis (Brinson-Hood-Beebower)
 *
 * Decomposes portfolio excess return into:
 * - Allocation effect: impact of sector weight decisions
 * - Selection effect: impact of stock picking within sectors
 * - Interaction effect: combined effect
 */

// S&P 500 sector weights (approximate, updated quarterly)
export const SP500_SECTOR_WEIGHTS: Record<string, number> = {
  'Technology': 0.31,
  'Healthcare': 0.12,
  'Financial Services': 0.13,
  'Consumer Cyclical': 0.10,
  'Communication Services': 0.09,
  'Industrials': 0.08,
  'Consumer Defensive': 0.06,
  'Energy': 0.04,
  'Utilities': 0.03,
  'Real Estate': 0.02,
  'Basic Materials': 0.02,
}

export type SectorAttribution = {
  name: string
  portfolio_weight: number
  benchmark_weight: number
  portfolio_return: number
  benchmark_return: number
  allocation_effect: number
  selection_effect: number
}

export function computeAttribution(
  portfolioSectors: Array<{ sector: string; weight: number; return_pct: number }>,
  benchmarkReturn: number,
  benchmarkWeights: Record<string, number> = SP500_SECTOR_WEIGHTS
): {
  allocation_effect: number
  selection_effect: number
  interaction_effect: number
  sectors: SectorAttribution[]
} {
  let totalAllocation = 0
  let totalSelection = 0
  let totalInteraction = 0
  const sectors: SectorAttribution[] = []

  for (const ps of portfolioSectors) {
    const bw = benchmarkWeights[ps.sector] ?? 0
    const pw = ps.weight
    const pr = ps.return_pct / 100
    const br = benchmarkReturn / 100

    const allocation = (pw - bw) * (br - benchmarkReturn / 100)
    const selection = bw * (pr - br)
    const interaction = (pw - bw) * (pr - br)

    totalAllocation += allocation
    totalSelection += selection
    totalInteraction += interaction

    sectors.push({
      name: ps.sector,
      portfolio_weight: pw,
      benchmark_weight: bw,
      portfolio_return: ps.return_pct,
      benchmark_return: benchmarkReturn,
      allocation_effect: allocation * 100,
      selection_effect: selection * 100,
    })
  }

  return {
    allocation_effect: totalAllocation * 100,
    selection_effect: totalSelection * 100,
    interaction_effect: totalInteraction * 100,
    sectors,
  }
}
```

- [ ] **Step 2: Create attribution endpoint**

Create `src/app/api/analytics/[pid]/attribution/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { computeAttribution, SP500_SECTOR_WEIGHTS } from '@/lib/services/attribution'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1M'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_ATTRIBUTION}${pid}:${period}`,
    3600,
    async () => {
      // Get positions with current prices and sectors
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return null

      const symbols = positions.map((p) => p.symbol)

      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of prices ?? []) priceMap[p.symbol] = p.price

      const sectorMap: Record<string, string> = {}
      for (const c of companies ?? []) sectorMap[c.symbol] = c.sector ?? 'Unknown'

      // Group by sector with returns
      const sectorData: Record<string, { value: number; cost: number }> = {}
      let totalValue = 0

      for (const pos of positions) {
        const price = priceMap[pos.symbol] ?? pos.avg_cost
        const value = pos.quantity * price
        const cost = pos.quantity * pos.avg_cost
        totalValue += value
        const sector = sectorMap[pos.symbol] ?? 'Unknown'
        if (!sectorData[sector]) sectorData[sector] = { value: 0, cost: 0 }
        sectorData[sector].value += value
        sectorData[sector].cost += cost
      }

      const portfolioSectors = Object.entries(sectorData).map(([sector, data]) => ({
        sector,
        weight: totalValue > 0 ? data.value / totalValue : 0,
        return_pct: data.cost > 0 ? ((data.value - data.cost) / data.cost) * 100 : 0,
      }))

      // Get benchmark return for period (simplified)
      const benchmarkReturn = 10 // TODO: calculate from benchmark_prices

      return computeAttribution(portfolioSectors, benchmarkReturn, SP500_SECTOR_WEIGHTS)
    }
  )

  return success(data)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/attribution.ts src/app/api/analytics/[pid]/attribution/route.ts
git commit -m "feat(attribution): add BHB attribution analysis service and endpoint"
```

---

### Task 16: Final integration — wire concentration into snapshot cron

**Files:**
- Modify: `src/app/api/cron/snapshots/route.ts`

- [ ] **Step 1: Add concentration evaluation to nightly cron**

Add after the snapshot upsert in `runNightlySnapshots()` or in the cron route after snapshots:

```typescript
import { evaluateConcentration, saveAlerts } from '@/lib/services/concentration'

    // 5. Evaluate concentration alerts for all portfolios
    // (add this after leaderboard refresh in the cron route)
    for (const pid of snapshotResult.portfolioIds) {
      try {
        const { data: positions } = await supabase
          .from('positions')
          .select('symbol, asset_type, quantity, avg_cost')
          .eq('portfolio_id', pid)
          .gt('quantity', 0)

        const { data: prices } = await supabase
          .from('current_prices')
          .select('symbol, price')
          .in('symbol', (positions ?? []).map((p) => p.symbol))

        const priceMap: Record<string, number> = {}
        for (const p of prices ?? []) priceMap[p.symbol] = p.price

        const enriched = (positions ?? []).map((p) => ({
          symbol: p.symbol,
          asset_type: p.asset_type,
          value: p.quantity * (priceMap[p.symbol] ?? p.avg_cost),
        }))
        const totalValue = enriched.reduce((s, p) => s + p.value, 0)

        const alerts = evaluateConcentration(enriched, totalValue, pid)
        await saveAlerts(supabase, alerts)
      } catch (err) {
        console.error(`[cron] Concentration check failed for ${pid}:`, err)
      }
    }
```

- [ ] **Step 2: Verify full build**

Run: `cd C:/Users/ponye/Projects/investment-portfolio && npm run build`
Expected: Build succeeds with all new endpoints and services.

- [ ] **Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(cron): integrate concentration alerts into nightly snapshot pipeline"
```

---

## Summary

| Chunk | Tasks | Phase | What it delivers |
|-------|-------|-------|------------------|
| 1 | 1-6 | A | Migration, cron monitoring, backfill, TWR/MWR, benchmarks, allocation fix |
| 2 | 7-8 | C1+C4 | Dashboard P&L summary, position P&L enrichment |
| 3 | 9-10 | C2+C3 | Snapshot-based history with benchmark overlay, leaderboard history, winners/losers |
| 4 | 11-13 | B1+B2+B5 | Concentration alerts, advanced returns endpoint, enhanced risk metrics |
| 5 | 14-16 | B3+B4+B6 | Income analytics, BHB attribution, cron integration |

**Frontend components** (dashboard cards, charts, heatmaps, etc.) should be built AFTER these backend tasks are complete and data is flowing. They can be a follow-up plan.

---

*Plan created: 2026-04-04*
*Spec: docs/superpowers/specs/2026-04-04-analytics-overhaul-design.md*
