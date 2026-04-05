# InvestTracker Analytics Overhaul — Design Spec

> **Date:** 2026-04-04
> **Author:** Claude (architect) + Angello (product owner)
> **Status:** Approved
> **Scope:** Complete analytics, P&L, and data persistence overhaul
> **Approach:** A → C → B (fundamentals first → features → pro analytics)
> **Requires:** Vercel Pro (for cron >10s timeout), Upstash paid tier recommended

---

## Problem Statement

InvestTracker has a solid schema with tables for snapshots, price history, and risk metrics, but the data pipeline is unreliable and the frontend doesn't surface the data that exists. Key issues:

1. **Portfolio snapshots don't accumulate** — the Vercel cron likely fails silently, so there's no historical data to display
2. **No real P&L visibility** — users can't see total gains/losses, daily change, or who won/lost
3. **Return calculation is naive** — uses `(value - cost) / cost` instead of TWR or MWR
4. **Allocation uses cost basis** — shows what you PAID, not what it's WORTH
5. **No benchmark data** — can't compare against S&P 500 or IPC
6. **Leaderboard overwrites history** — past rankings are lost on each refresh
7. **Analytics endpoints exist but lack data** — risk metrics require price_history that may have gaps
8. **No dividend/income analytics** — transactions support dividends but there's no income dashboard

## Success Criteria

- User opens dashboard → immediately sees total portfolio value, P&L (absolute + %), and today's change
- Historical chart shows portfolio value over time with benchmark overlay, back to portfolio creation date
- Leaderboard shows who won/lost this week, this month, with historical ranking progression
- Analytics page shows TWR, MWR, calendar returns, risk dashboard, attribution, and income tracking
- Snapshot system is reliable with monitoring, retry logic, and backfill capability
- All calculations use market value (not cost basis) for allocation

---

## Phase C: Feature-Driven (What the User Sees)

### C1: Dashboard P&L Real

**Location:** `/dashboard` — main landing page after login

**KPI Cards (top row, 6 cards):**

| Card | Data | Source |
|------|------|--------|
| Total Portfolio Value | Σ(quantity × current_price) across all portfolios | Real-time from current_prices |
| Total Gain/Loss | total_value - total_cost (absolute + %) | Calculated from positions + prices |
| Today's Change | total_value_now - yesterday's snapshot total_value (absolute + %) | Requires working snapshots |
| This Week's Change | total_value_now - 7-day-ago snapshot (absolute + %) | Requires working snapshots |
| Best Position | Symbol with highest return_pct | Per-position calculation |
| Worst Position | Symbol with lowest return_pct | Per-position calculation |

**Implementation:**
- New API endpoint: `GET /api/dashboard/summary` — aggregates across all user portfolios
- Returns: total_value, total_cost, total_return, total_return_pct, daily_change, daily_change_pct, weekly_change, weekly_change_pct, best_position, worst_position
- Cached 2 minutes in Redis (key: `dashboard:summary:{user_id}`)
- Falls back gracefully if no snapshots exist (shows only current value + cost, no daily change)

**Portfolio Value Chart:**
- Line chart: portfolio total value over time
- Benchmark overlay (S&P 500 or IPC, user-selectable)
- Both lines normalized to 100 at the start date for fair comparison
- Period selector: 1D, 1W, 1M, 3M, 6M, YTD, 1Y, ALL
- Tooltip on hover: date, portfolio value, benchmark value, difference
- Data source: `portfolio_snapshots` for portfolio, `benchmark_prices` for benchmark

**Position Table (below chart):**

| Column | Source |
|--------|--------|
| Symbol | positions.symbol |
| Name | company_data.name |
| Quantity | positions.quantity |
| Avg Cost | positions.avg_cost |
| Current Price | current_prices.price |
| Market Value | quantity × current_price |
| P&L ($) | market_value - (quantity × avg_cost) |
| P&L (%) | pnl / cost × 100 |
| Today's Change | current_price - yesterday_close (from price_history or snapshot) |
| Sparkline | Last 7 days of closing prices (mini line chart) |

- Sortable by any column
- Color coding: green for gains, red for losses
- Click row → navigate to `/market/[symbol]`

### C2: Historical Chart That Works

**Problem:** The portfolio history endpoint reconstructs timeline from price_history, but gaps in price data cause incomplete or broken charts.

**Solution — dual data source:**

1. **Primary:** `portfolio_snapshots` table — one record per portfolio per day with pre-computed total_value
2. **Fallback:** Reconstruct from `price_history` × `positions` for dates before first snapshot
3. **Backfill on creation:** When a user creates a portfolio and adds positions with `opened_at` in the past, generate retroactive snapshots

**API changes:**
- `GET /api/portfolio/history?period=1Y` — reads from snapshots first, fills gaps with reconstruction
- Response: `{ dates: string[], values: number[], benchmark: number[], benchmarkSymbol: string }`
- Cache: 10 minutes for periods > 1M, 2 minutes for shorter

**Chart behavior:**
- If fewer than 7 snapshots exist, show a message: "Accumulating data — chart improves daily"
- Always show whatever data is available, never an empty chart
- Benchmark line uses same date range, normalized to portfolio start value

### C3: Leaderboard with History

**New table:**

```sql
CREATE TABLE leaderboard_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  category TEXT NOT NULL,         -- 'return', 'sharpe', 'risk_adjusted', 'consistency'
  period TEXT NOT NULL,           -- '1M', '3M', '1Y'
  rankings JSONB NOT NULL,       -- same structure as leaderboard_cache.rankings
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (snapshot_date, category, period)
);
```

**Nightly process (after leaderboard refresh):**
1. Copy current `leaderboard_cache` rankings into `leaderboard_history` with today's date
2. This creates a historical record of who was where each day

**New UI components:**

| Component | Location | Data |
|-----------|----------|------|
| Winners & Losers widget | `/discover` top section | Top 5 gaining + top 5 losing portfolios today (compare today's snapshot vs yesterday's) |
| Ranking progression chart | `/profile/[username]` and `/portfolio/[id]` | Line chart of portfolio's rank position over time per category |
| Period toggle on leaderboard | `/discover/leaderboard` | Switch between: today, this week, this month, this year |
| Historical winner banner | `/discover/leaderboard` | "🏆 March 2026 Winner: @username (+14.2%)" |

**API:**
- `GET /api/discover/leaderboard/history?category=return&period=1M&days=30` — returns daily ranking snapshots
- `GET /api/discover/winners?period=today` — returns top 5 winners and losers

### C4: Position-Level P&L

**Enhancement to existing position display across all portfolio views:**

Every place positions are shown (dashboard, portfolio detail, analytics), include:
- Market value (quantity × current_price)
- P&L absolute (market_value - cost_basis)
- P&L percentage
- Today's change (absolute + %)
- 7-day sparkline

**New API field in portfolio responses:**
```typescript
interface PositionWithPnL {
  // existing fields
  symbol: string;
  quantity: number;
  avg_cost: number;
  // new fields
  current_price: number;
  market_value: number;
  pnl_absolute: number;
  pnl_percent: number;
  daily_change: number;
  daily_change_pct: number;
  sparkline_7d: number[];  // array of 7 closing prices
}
```

**Implementation:** Enrich position data at the API layer in `GET /api/portfolio/[id]` by joining with `current_prices` and `price_history` (last 7 days).

---

## Phase A: Fundamentals (What Makes C Work)

### A1: Reliable Snapshot System

**Current state:** Vercel cron at 1 AM UTC triggers `GET /api/cron/snapshots`. Protected by `CRON_SECRET`. Processes portfolios in batches of 5 with 2-second pauses. No monitoring, no retry, no visibility into failures. Requires Vercel Pro for `maxDuration=300` (existing code already sets this).

**New table:**

```sql
CREATE TABLE cron_runs (
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

CREATE INDEX idx_cron_runs_job_date ON cron_runs(job_name, started_at DESC);
```

**Changes to `/api/cron/snapshots`:**

1. **Start:** Insert `cron_runs` row with status='running'
2. **Process:** For each portfolio batch, update `portfolios_processed` count
3. **On failure:** Log error to `error_details` JSONB, increment `portfolios_failed`, continue to next portfolio (don't abort)
4. **Finish:** Update status to 'success' or 'partial' (if some failed), set `finished_at` and `duration_ms`
5. **Retry failed:** After main run, retry failed portfolios once more

**New endpoint: `POST /api/cron/snapshots/backfill`**

- Protected by `CRON_SECRET`
- Query params: `from` (date), `to` (date), `portfolio_id` (optional, defaults to all)
- For each date in range: reconstruct portfolio value from `price_history` × `positions` as of that date
- Upsert into `portfolio_snapshots`
- Use case: initial population of historical data, recovery from outages

**New endpoint: `GET /api/cron/status`**

- Returns last 7 days of `cron_runs`
- Shows: last successful run, last failure, average duration
- Protected by auth (admin only or portfolio owner)

**Monitoring:**
- If `cron_runs` has no 'success' entry in the last 26 hours, the status endpoint returns `{ healthy: false }`
- Future: connect to email alert via Gmail MCP or webhook

### A2: Correct Return Calculations

**New service: `src/lib/services/returns.ts`**

```typescript
// Simple return — what already exists, but formalized
function calculateSimpleReturn(totalValue: number, totalCost: number): number;

// Time-Weighted Return — measures strategy performance
// Breaks timeline into sub-periods at each cash flow (transaction)
// TWR = Π(1 + Ri) - 1 where Ri is the return of each sub-period
function calculateTWR(
  snapshots: PortfolioSnapshot[],
  transactions: Transaction[]
): number;

// Money-Weighted Return — measures personal experience
// Uses Newton-Raphson method to find IRR of cash flows
// Cash flows: deposits are negative, withdrawals are positive, current value is final positive flow
function calculateMWR(
  transactions: Transaction[],
  currentValue: number,
  startDate: Date,
  endDate: Date
): number;

// Calculate all three for a given portfolio and period
function calculateAllReturns(
  portfolioId: string,
  period: '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'
): Promise<{ simple: number; twr: number; mwr: number }>;
```

**TWR calculation detail (Modified Dietz / True TWR):**

1. Get all snapshots for the period, ordered by date
2. Get all transactions (buy/sell) for the period, ordered by date
3. Split timeline into sub-periods between consecutive cash flow events
4. For each sub-period: `Ri = (V_end / V_start) - 1` where `V_start` = portfolio value immediately after previous cash flow, `V_end` = portfolio value immediately before next cash flow
5. After each cash flow, new sub-period starts at `V_end + cashflow`
6. Chain: `TWR = Π(1 + Ri) - 1`
7. Annualize if period > 1 year: `TWR_annual = (1 + TWR)^(365/days) - 1`

**MWR calculation detail:**

1. Collect all cash flows: each buy = negative flow, each sell = positive flow
2. Add current portfolio value as final positive flow at today's date
3. Solve for rate `r` where: `Σ CF_i / (1 + r)^t_i = 0` using Newton-Raphson (max 100 iterations, tolerance 1e-8)
4. Annualize: `MWR_annual = (1 + r)^(365/days) - 1`

**Storage:**
- New columns in `portfolio_snapshots`:
  ```sql
  ALTER TABLE portfolio_snapshots ADD COLUMN twr NUMERIC;
  ALTER TABLE portfolio_snapshots ADD COLUMN mwr NUMERIC;
  ```
- Calculated nightly during snapshot generation

### A3: Benchmark Data Pipeline

**New table:**

```sql
CREATE TABLE benchmark_prices (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  change_pct NUMERIC,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX idx_benchmark_date ON benchmark_prices(symbol, date DESC);
```

**Supported benchmarks:**

| Symbol | Name | Use case |
|--------|------|----------|
| SPY | S&P 500 ETF | USD portfolios, default benchmark |
| ^MXX | IPC Mexico | MXN portfolios |
| QQQ | NASDAQ 100 ETF | Tech-heavy portfolios |
| ACWI | MSCI All Country World | Diversified portfolios |

**Data fetch:**
- Added to nightly cron, after snapshots: fetch today's close for all 4 benchmarks
- Source: Yahoo Finance (free, no API key needed) via `yahoo-finance2` npm package or direct API
- Fallback: Twelve Data API
- Backfill: On first run, fetch last 3 years of daily data for all benchmarks

**Benchmark comparison logic:**
- Normalize both series to start at 100 at the comparison start date
- Formula: `normalized_value = (close / start_close) * 100`
- Excess return: `portfolio_return - benchmark_return` for the same period

### A4: Fix Allocation to Use Market Value

**Current bug in `get_portfolio_allocation()` SQL function:**
- Uses `positions.avg_cost` for value calculation
- Should use `current_prices.price`

**Fix (both SQL function AND API route `src/app/api/analytics/[pid]/allocation/route.ts`):**
- Join `positions` with `current_prices` on `(symbol, exchange)` — composite key, not just symbol
- Use `DISTINCT ON (symbol)` or priority logic if multiple exchanges match
- Calculate `market_value = quantity * current_price` instead of `quantity * avg_cost`
- If no current price available, fall back to `avg_cost` with a `stale` flag

**Enhanced allocation views:**

| View | Data source | Grouping |
|------|-------------|----------|
| By asset type | positions.asset_type | stock, etf, crypto, bond, forex, commodity |
| By sector | company_data.sector | Technology, Healthcare, Financials, etc. |
| By geography | Derived from company_data or exchange | US, MX, EU, Asia, Other |
| By market cap | company_data.market_cap ranges | Large (>$10B), Mid ($2-10B), Small (<$2B) |

**Visualization:** Donut chart (primary) + treemap (detailed) for each view. User toggles between views with tabs.

### A5: Price History Reliability

**Gap detection (nightly):**
1. For each symbol with active positions, query `price_history` for last 365 days
2. Compare against business days calendar (exclude weekends, major holidays)
3. If gaps found, attempt to fill using fallback chain: Twelve Data → Finnhub → Yahoo Finance
4. Log gaps that can't be filled (delisted stocks, etc.)

**Backfill on demand:**
- When `GET /api/market/[symbol]/history` is called and data is missing for requested range
- Fetch using fallback chain: Twelve Data → Finnhub → Yahoo Finance (Yahoo is unofficial/unstable, always use as last resort)
- Return combined cached + fresh data
- Add exponential backoff retry (3 attempts) for each source

**Broader coverage:**
- Worker currently fetches prices only for positions (hot) and watchlists (warm)
- Add benchmark symbols (SPY, ^MXX, QQQ, ACWI) to the "hot" list so they're always current
- Add symbols from `leaderboard_cache` rankings to "warm" list

**Stale data indicator:**
- If a price in `current_prices` is older than 24 hours during market hours, API response includes `is_stale: true`
- Frontend shows a subtle indicator (dimmed text, tooltip "Price may be outdated")

---

## Phase B: Professional Analytics

### B1: Advanced Returns Dashboard

**Location:** `/portfolio/[id]/analytics` — enhanced analytics page

**Components:**

1. **Return Summary Cards** — 3 cards showing Simple Return, TWR, MWR with tooltips explaining each
2. **Calendar Year Returns Heatmap** — grid: rows = years, columns = months, cells colored green/red by return magnitude, total column on right
3. **Rolling Returns Chart** — line chart with rolling 30d, 90d, 365d return lines, shows consistency
4. **Period Returns Comparison Table** — 1D through ALL, portfolio vs benchmark side by side

**New API: `GET /api/analytics/[pid]/returns`**

```typescript
interface ReturnsResponse {
  summary: {
    simple: number;
    twr: number;
    mwr: number;
    period: string;
  };
  calendar: {
    year: number;
    months: (number | null)[];  // null = no data for that month
    total: number;
  }[];
  rolling: {
    dates: string[];
    rolling_30d: number[];
    rolling_90d: number[];
    rolling_365d: number[];
  };
  periods: {
    period: string;       // '1D', '1W', etc.
    portfolio: number;
    benchmark: number;
    excess: number;
  }[];
}
```

Cache: 10 minutes in Redis.

### B2: Risk Dashboard Pro

**Location:** `/portfolio/[id]/analytics` — risk tab or section

**Components:**

1. **Risk Score Gauge** — semicircle gauge 1-10, already calculated in snapshots
2. **Sharpe vs Sortino** — two gauge cards side by side
3. **Drawdown Chart** — inverted area chart (red), showing peak-to-trough declines over time
4. **Rolling Volatility** — line chart of 30-day rolling annualized volatility
5. **Beta Scatter Plot** — scatter of daily portfolio returns vs daily benchmark returns, regression line = beta
6. **VaR Card** — "With 95% confidence, max daily loss: $X"
7. **Risk Comparison Table** — portfolio vs benchmark: volatility, Sharpe, Sortino, max drawdown, beta

**New metrics — added to snapshot calculation:**

```sql
ALTER TABLE portfolio_snapshots ADD COLUMN calmar_ratio NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN var_95 NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN tracking_error NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN information_ratio NUMERIC;
```

| Metric | Formula |
|--------|---------|
| Calmar Ratio | CAGR / abs(Max Drawdown) |
| VaR 95% | 5th percentile of daily returns × portfolio value |
| Tracking Error | std_dev(portfolio_daily_return - benchmark_daily_return) |
| Information Ratio | mean(portfolio_return - benchmark_return) / tracking_error |

**New API: `GET /api/analytics/[pid]/risk`** (enhanced version of existing)

```typescript
interface RiskResponse {
  current: {
    risk_score: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    max_drawdown: number;
    max_drawdown_date: string;
    volatility: number;
    beta: number;
    alpha: number;
    calmar_ratio: number;
    var_95: number;
    tracking_error: number;
    information_ratio: number;
  };
  drawdown_series: {
    dates: string[];
    values: number[];      // negative percentages
  };
  rolling_volatility: {
    dates: string[];
    values: number[];
  };
  scatter_data: {
    portfolio_returns: number[];
    benchmark_returns: number[];
    beta: number;
    r_squared: number;
  };
  benchmark_comparison: {
    metric: string;
    portfolio: number;
    benchmark: number;
  }[];
}
```

### B3: Attribution Analysis

**Location:** `/portfolio/[id]/analytics` — attribution tab

**New service: `src/lib/services/attribution.ts`**

**BHB (Brinson-Hood-Beebower) model:**

```typescript
interface AttributionResult {
  period: string;
  portfolio_return: number;
  benchmark_return: number;
  excess_return: number;
  allocation_effect: number;    // impact of sector weight decisions
  selection_effect: number;     // impact of stock picking within sectors
  interaction_effect: number;   // combined effect
  currency_effect: number;      // FX impact for multi-currency portfolios
  sectors: {
    name: string;
    portfolio_weight: number;
    benchmark_weight: number;
    portfolio_return: number;
    benchmark_return: number;
    allocation_effect: number;
    selection_effect: number;
  }[];
}
```

**Calculation:**
- For each sector:
  - `allocation_effect = (w_p - w_b) × (R_b_sector - R_b_total)` — did overweighting this sector help?
  - `selection_effect = w_b × (R_p_sector - R_b_sector)` — within this sector, did you pick better stocks?
  - `interaction_effect = (w_p - w_b) × (R_p_sector - R_b_sector)` — combined impact
- Sum across sectors for total effects
- Currency effect: difference between local-currency and base-currency returns

**Visualization:** Waterfall chart — starts at benchmark return, adds/subtracts each effect to arrive at portfolio return.

**Data requirements:**
- Sector data from `company_data.sector` (already fetched)
- Benchmark sector weights — hardcoded for S&P 500 sectors (updated quarterly), or fetched from API
- Portfolio sector weights from position market values

**API: `GET /api/analytics/[pid]/attribution?period=1M`**
- Calculated on-demand (not nightly — computationally expensive, low traffic)
- Cached 1 hour in Redis

### B4: Dividend & Income Tracking

**Location:** New page `/portfolio/[id]/income` or tab within analytics

**New columns in `portfolio_snapshots`:**

```sql
ALTER TABLE portfolio_snapshots ADD COLUMN dividend_income NUMERIC DEFAULT 0;       -- backwards compat with existing get_portfolio_performance() function
ALTER TABLE portfolio_snapshots ADD COLUMN dividend_income_mtd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN dividend_income_ytd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN dividend_income_total NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN portfolio_yield NUMERIC;
```

**Calculation during nightly snapshot:**
1. Query `transactions` where `type = 'dividend'` for this portfolio
2. Sum by month-to-date, year-to-date, all-time
3. Calculate portfolio yield: `annual_dividend_income / total_market_value`

**Components:**

| Component | Data |
|-----------|------|
| Income Summary Cards | Total dividends: this month, this year, all-time |
| Income Timeline | Bar chart: dividends received per month over time |
| Dividend Calendar | Calendar view with ex-dates and payment dates for current holdings |
| Yield Analysis | Portfolio yield vs benchmark yield |
| Income Projection | Estimated next 12 months based on current holdings and historical dividend rates |
| DRIP Tracking | Flag on dividend transactions if reinvested |

**API: `GET /api/analytics/[pid]/income`**

```typescript
interface IncomeResponse {
  summary: {
    mtd: number;
    ytd: number;
    all_time: number;
    portfolio_yield: number;
    benchmark_yield: number;
  };
  monthly_history: {
    month: string;       // '2026-01', '2026-02', etc.
    amount: number;
  }[];
  upcoming: {
    symbol: string;
    ex_date: string;
    payment_date: string;
    amount_per_share: number;
    estimated_total: number;
  }[];
  projection_12m: number;
}
```

**Dividend data fetch:**
- During nightly cron: for each holding, check `market_events` for upcoming dividends
- If no event data, fetch from Finnhub dividend endpoint
- Store in `market_events` with `event_type = 'dividend'`

### B5: Concentration Risk & Smart Alerts

**New table:**

```sql
CREATE TABLE portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,           -- 'position_concentration', 'sector_concentration', 'low_diversification', 'high_correlation'
  severity TEXT NOT NULL,             -- 'warning', 'critical'
  message TEXT NOT NULL,
  details JSONB,                      -- { symbol: 'NVDA', weight: 0.42, threshold: 0.25 }
  is_dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ              -- re-evaluate next snapshot
);

CREATE INDEX idx_portfolio_alerts_active ON portfolio_alerts(portfolio_id) WHERE NOT is_dismissed;
```

**Alert rules (evaluated during nightly snapshot):**

| Rule | Trigger | Severity | Message Template |
|------|---------|----------|------------------|
| Single position > 25% | position market_value / portfolio total_value > 0.25 | warning | "{symbol} represents {pct}% of your portfolio" |
| Single position > 40% | Same > 0.40 | critical | "⚠️ {symbol} is {pct}% of your portfolio — high concentration risk" |
| Sector > 50% | sector total / portfolio total > 0.50 | warning | "{sector} sector is {pct}% of your portfolio" |
| Single asset type > 80% | asset_type total / portfolio total > 0.80 | warning | "{pct}% of your portfolio is in {type}" |
| Low diversification | HHI > 0.30 (diversification_score) | warning | "Portfolio diversification is low (score: {score})" |

**API: `GET /api/portfolio/[id]/alerts`**
- Returns active (non-dismissed) alerts for the portfolio
- `PATCH /api/portfolio/[id]/alerts/[alert_id]` — dismiss an alert

**UI:**
- Alert banner at top of portfolio detail page
- Dismissible cards with severity icon (⚠️ / 🔴)
- Link to relevant analytics view (e.g., "View allocation" for concentration alerts)

### B6: Social & Leaderboard Enhancements

**Verified returns:**
- A portfolio's returns are "verified" if `portfolio_snapshots` has no gaps > 3 days in the measured period
- Verified portfolios get a ✓ badge on leaderboard and profile
- Query: `SELECT COUNT(DISTINCT snapshot_date) FROM portfolio_snapshots WHERE portfolio_id = $1 AND snapshot_date BETWEEN $2 AND $3`
- Compare against business days in range; if coverage > 90%, mark as verified

**Performance badges (stored in profile or computed):**

| Badge | Condition | Icon |
|-------|-----------|------|
| Monthly Champion | #1 in any leaderboard category for a full month | 🏆 |
| Hot Streak | Portfolio positive for 5+ consecutive trading days | 🔥 |
| Beat the Market | Portfolio TWR > benchmark TWR for trailing 3 months | 📈 |
| Diamond Hands | Longest-held position > 6 months without selling | 💎 |
| Diversified | Diversification score > 0.7 (low HHI) | 🎯 |
| Income Builder | Received dividends 3+ months in a row | 💰 |

**Storage:** Computed during nightly snapshot, stored as JSONB array in `profiles` or a new `user_badges` table.

**Winners/Losers widget on `/discover`:**
- "Top 5 Winners Today" — portfolios with highest daily_change_pct (from today's vs yesterday's snapshot)
- "Top 5 Losers Today" — portfolios with lowest daily_change_pct
- Only public portfolios with verified returns

---

## Database Migration Summary

**New tables (4):**
- `cron_runs` — job execution monitoring
- `benchmark_prices` — daily benchmark index data
- `leaderboard_history` — daily leaderboard snapshots
- `portfolio_alerts` — concentration risk alerts

**Altered tables:**
- `portfolio_snapshots` — new columns: `twr`, `mwr`, `calmar_ratio`, `var_95`, `tracking_error`, `information_ratio`, `dividend_income`, `dividend_income_mtd`, `dividend_income_ytd`, `dividend_income_total`, `portfolio_yield`
- `profiles` — new column: `badges JSONB DEFAULT '[]'::jsonb` (for performance badges)

**New indexes:**
- `idx_cron_runs_job_date` on `cron_runs(job_name, started_at DESC)`
- `idx_benchmark_date` on `benchmark_prices(symbol, date DESC)`
- `idx_portfolio_alerts_active` on `portfolio_alerts(portfolio_id) WHERE NOT is_dismissed`

---

## New Services

| Service | Location | Purpose |
|---------|----------|---------|
| `returns.ts` | `src/lib/services/` | TWR, MWR, simple return calculations |
| `benchmarks.ts` | `src/lib/services/` | Benchmark data fetch, storage, comparison |
| `attribution.ts` | `src/lib/services/` | BHB attribution analysis |
| `concentration.ts` | `src/lib/services/` | Concentration risk evaluation and alert generation |
| `dividend-analytics.ts` | `src/lib/services/` | Income tracking, yield calculation, projections |

---

## New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/summary` | Aggregated P&L across all portfolios |
| GET | `/api/analytics/[pid]/returns` | TWR, MWR, calendar returns, rolling returns |
| GET | `/api/analytics/[pid]/attribution` | BHB attribution analysis |
| GET | `/api/analytics/[pid]/income` | Dividend/income analytics |
| GET | `/api/portfolio/[id]/alerts` | Active concentration alerts |
| PATCH | `/api/portfolio/[id]/alerts/[aid]` | Dismiss an alert |
| GET | `/api/discover/leaderboard/history` | Historical leaderboard rankings |
| GET | `/api/discover/winners` | Today's top winners/losers |
| POST | `/api/cron/snapshots/backfill` | Backfill missing snapshots |
| GET | `/api/cron/status` | Cron job health status |

---

## Enhanced Existing Endpoints

| Endpoint | Enhancement |
|----------|-------------|
| `GET /api/portfolio/[id]` | Include position P&L, market value, daily change, sparkline |
| `GET /api/portfolio/history` | Use snapshots as primary source, benchmark overlay |
| `GET /api/analytics/[pid]/allocation` | Use market value instead of cost basis; add sector/geography/market cap views |
| `GET /api/analytics/[pid]/risk` | Add calmar, VaR, tracking error, information ratio; drawdown series; scatter data |
| `GET /api/cron/snapshots` | Add cron_runs logging, retry logic, benchmark fetch (NOTE: existing endpoint is GET, not POST) |
| `GET /api/discover/leaderboard` | Support period toggle, include verified badge |

---

## Execution Order

The phases are designed so each layer enables the next:

**Phase C (features) depends on Phase A (fundamentals):**
- C1 (Dashboard P&L) needs A1 (reliable snapshots) for daily change
- C2 (Historical chart) needs A5 (price history) + A3 (benchmark data)
- C3 (Leaderboard history) needs A1 (reliable snapshots) to have data to rank
- C4 (Position P&L) needs A4 (market value allocation) for correct values

**Phase B (analytics pro) depends on A + C:**
- B1 (Returns) needs A2 (TWR/MWR calculations) + A1 (snapshots)
- B2 (Risk) needs A3 (benchmark data) for beta/tracking error + A5 (price history)
- B3 (Attribution) needs A3 (benchmark) + A4 (sector allocation)
- B4 (Income) needs A1 (snapshots) for income storage
- B5 (Concentration) needs A4 (market value allocation)
- B6 (Social) needs A1 (snapshots) for verified returns + C3 (leaderboard history)

**Actual execution order: A → C → B** (fundamentals enable features enable pro analytics):
1. A1 (reliable snapshots) → A5 (price history) → A3 (benchmark pipeline) → A4 (fix allocation) → A2 (TWR/MWR)
2. C4 (position P&L) → C1 (dashboard P&L) → C2 (historical chart) → C3 (leaderboard history)
3. B2 (risk pro) → B1 (returns dashboard) → B4 (income) → B5 (concentration) → B3 (attribution) → B6 (social)

---

## Out of Scope (for now)

- VPS migration (separate spec exists)
- Real-time WebSocket price streaming
- AI advisor features
- Mobile app / React Native
- Tax reporting (FIFO/LIFO/specific lot cost basis)
- ETF overlap analysis
- Portfolio rebalancing tools
- Multi-account aggregation (net worth tracker)
- Monte Carlo retirement projections

These are all valid future features but would make this spec too large. Each can be a separate spec when the time comes.

---

## Prerequisites (pre-existing issues to fix first)

Migration 006 references columns that don't exist in the schema:
- `deleted_at` on `portfolio_snapshots` (referenced in indexes/functions but never created)
- `deleted_at` on `positions` (same issue)
- `is_active` on `current_prices` and `price_history` (same issue)
- `dividend_income` on `portfolio_snapshots` (referenced in `get_portfolio_performance()` but never created)

**The new migration (007) must add these missing columns BEFORE the 006 functions can work.** This is a pre-existing bug, not introduced by this spec.

Additionally, verify `leaderboard_cache` actual schema in production vs what migration 005 defines vs how `snapshots.ts` writes to it. The code may insert individual rows while the table expects JSONB blob. Align `leaderboard_history` archival to match reality.

## RLS Policies for New Tables

```sql
-- cron_runs: service_role only (no user access)
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON cron_runs FOR ALL USING (auth.role() = 'service_role');

-- benchmark_prices: read for all authenticated users
ALTER TABLE benchmark_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON benchmark_prices FOR SELECT USING (auth.role() = 'authenticated');

-- leaderboard_history: read for all authenticated users
ALTER TABLE leaderboard_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON leaderboard_history FOR SELECT USING (auth.role() = 'authenticated');

-- portfolio_alerts: owner only
ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access" ON portfolio_alerts FOR ALL
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
```

## Technical Constraints

- **Vercel Pro required:** Cron needs `maxDuration=300` (existing code already sets this). Free tier 10s timeout is insufficient.
- **Supabase free tier:** 500MB database, 50K MAU auth, limited edge function invocations
- **API rate limits:** Twelve Data 8 req/min, Finnhub 60 req/min, Yahoo Finance unofficial and unstable
- **Redis (Upstash):** Free tier 10K commands/day — with new caching, estimated ~8K-15K daily with moderate usage. **Recommend upgrading to Pay-as-you-go ($0.2/100K commands)** to avoid hitting limits.
- **Budget:** $5-15 USD/month total infrastructure
- **Data source priority:** Always Twelve Data → Finnhub → Yahoo Finance (Yahoo as last resort only)

These constraints mean:
- Batch processing must be efficient (small batches, delays between API calls)
- Pre-compute as much as possible nightly rather than on-demand
- Cache aggressively but monitor Redis usage
- Attribution (B3) scoped to S&P 500 benchmark only initially (sector weights available). IPC sector weights require manual data entry or paid API.

---

*Spec created: 2026-04-04*
*Authors: Claude (architect) + Angello (product owner)*
