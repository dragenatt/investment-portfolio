# Investment Portfolio Platform — Design Spec

## Overview

Multi-user investment portfolio platform with startup-quality UX. Users register, create portfolios, track real positions across multiple asset types, and get real-time analytics. Style: Robinhood/modern — clean, minimal, light-first with dark mode toggle.

**Target:** Functional and deployed on Vercel today.

## Architecture

Hybrid: Vercel + Cloudflare + Supabase.

- **Vercel (Next.js 15)** — app frontend, auth, API routes for CRUD
- **Cloudflare Workers** — price fetching, caching, heavy analytics calculations
- **Supabase** — PostgreSQL (source of truth), auth, realtime, storage

### Data Flow

1. Users interact with Next.js app on Vercel
2. Next.js reads prices from Supabase (populated by Workers)
3. Cloudflare `price-engine` Worker fetches from external APIs on cron schedules
4. Worker writes to KV cache (fast reads) and Supabase (persistent storage)
5. Supabase Realtime pushes price updates to connected clients (future phase)

## Supported Asset Types

Stocks (BMV + NYSE/NASDAQ), ETFs, Crypto, CETES/Bonds, Forex, Commodities.

## Multi-Currency

User selects base currency (MXN, USD, EUR). All values convert automatically using Banxico exchange rates cached in KV.

## Data Model

```sql
-- Supabase Auth handles users table

profiles (
  user_id UUID PK REFERENCES auth.users,
  display_name TEXT,
  avatar_url TEXT,
  base_currency TEXT DEFAULT 'MXN',
  theme TEXT DEFAULT 'light',
  created_at TIMESTAMPTZ DEFAULT now()
)

portfolios (
  id UUID PK DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_currency TEXT DEFAULT 'MXN',
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ -- soft delete
)

positions (
  id UUID PK DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES portfolios NOT NULL,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('stock','etf','crypto','bond','forex','commodity')),
  quantity NUMERIC NOT NULL,
  avg_cost NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT now()
)

transactions (
  id UUID PK DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy','sell','dividend','split')),
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  fees NUMERIC DEFAULT 0,
  currency TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
)

watchlists (
  id UUID PK DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
)

watchlist_items (
  id UUID PK DEFAULT gen_random_uuid(),
  watchlist_id UUID REFERENCES watchlists NOT NULL,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now()
)

alerts (
  id UUID PK DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above','below','pct_change')),
  target_value NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- Shared tables (not per-user)

current_prices (
  symbol TEXT PK,
  price NUMERIC NOT NULL,
  change_pct NUMERIC,
  volume BIGINT,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
)

price_history (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  PRIMARY KEY (symbol, date)
)

failed_fetches (
  id UUID PK DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INT DEFAULT 1,
  last_attempt TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false
)
```

## Pages and Navigation

```
/ → Landing page (marketing, CTA)
/login
/register

/dashboard → Main dashboard post-login
  - KPIs: total value, daily/total return, position count
  - Performance chart (1D/1W/1M/3M/1Y/MAX toggle)
  - Allocation donut chart by asset type
  - Top movers (user's positions, biggest daily changes)

/portfolio
  /portfolio/[id] → Portfolio detail
    - Positions list with live P&L
    - Composition chart
    - Add transaction button
  /portfolio/[id]/analytics → Advanced analytics
    - Performance vs benchmarks
    - Distribution by sector/geography/type
    - Risk metrics (volatility, Sharpe, drawdown)
    - Correlations between positions
  /portfolio/new → Create portfolio

/market
  - Asset search with autocomplete
  /market/[symbol] → Asset detail
    - Price, chart, volume
    - Fundamentals (if available)
    - "Add to portfolio" / "Add to watchlist" buttons
  - Trending / Most watched

/watchlist → Custom watchlists with live prices

/settings
  - Profile (name, avatar, base currency)
  - Theme (dark/light)
  - Configured alerts
```

Navigation: collapsible sidebar on desktop, bottom tab bar on mobile.

## Cloudflare Workers

Single `price-engine` worker with multiple cron triggers:

```
price-engine worker:
  Cron */5  → fetchMarketPrices(hot_symbols, open_markets_only)
  Cron */30 → fetchMarketPrices(warm_symbols, open_markets_only)
  Cron */5 24/7 → fetchCrypto(hot_crypto)
  Cron 0 */12 → fetchBanxico()
  Cron 0 22 weekdays → buildHistory() + compressOld()

Symbol tiers:
  Hot  (5 min)  → symbols in open positions
  Warm (30 min) → symbols in watchlists
  Cold (1x/day) → everything else

Exchange-aware scheduling:
  NYSE/NASDAQ: 8:30-15:00 CT
  BMV: 7:30-14:00 CT
  Crypto: 24/7
  Forex: Mon-Fri 24h

Shared modules:
  SmartQueue    → prioritizes by tier
  RateLimiter   → per-API budgets stored in KV
  FallbackChain → Yahoo → AlphaVantage → skip
  MarketCalendar → knows which markets are open

Failed fetches → dead_letter table → retry next cycle
```

### API Sources

| Source | Assets | Rate Limit | Role |
|--------|--------|-----------|------|
| Yahoo Finance | Stocks, ETFs, Forex, Commodities | Unofficial, ~2000/hr | Primary |
| Alpha Vantage | Stocks, Forex, Crypto | 25/day (free) | Fallback |
| CoinGecko | Crypto | 30/min (free) | Primary for crypto |
| Banxico API | MXN rates, CETES, Bonds | Generous | Primary for MX data |

### Cache Strategy (3 layers)

1. **Cloudflare KV** — TTL 5s (hot) to 5min (warm). First check on every request.
2. **Supabase current_prices** — persistent, updated by worker. Fallback if KV miss.
3. **External API** — only called on cache miss or cron trigger.

Reduces external API calls by 90%+.

## API Routes (Next.js)

```
/api/auth/* → Supabase Auth helpers

/api/portfolio
  GET    /                → list user's portfolios
  POST   /                → create portfolio
  GET    /[id]            → detail + positions + P&L
  PATCH  /[id]            → edit name/description
  DELETE /[id]            → soft delete

/api/transaction
  POST   /                → record buy/sell/dividend
  GET    /?pid=X          → transaction history
  DELETE /[id]            → delete + recalculate position

/api/market
  GET    /search?q=X      → search symbols (proxy to Yahoo)
  GET    /[symbol]        → current price + info (from KV/Supabase)
  GET    /[symbol]/history?range=1M → price history

/api/watchlist
  GET    /                → list watchlists
  POST   /                → create watchlist
  POST   /[id]/add        → add symbol
  DELETE /[id]/[symbol]   → remove symbol

/api/analytics
  GET    /[pid]/performance?range=1Y → historical performance
  GET    /[pid]/allocation           → distribution by type/sector/geo
  GET    /[pid]/risk                 → proxy to Cloudflare Worker
  GET    /[pid]/benchmark?vs=SPY,IPC → proxy to Cloudflare Worker

/api/alerts
  GET    /                → user's alerts
  POST   /                → create alert
  PATCH  /[id]            → edit/toggle
  DELETE /[id]            → delete

/api/user
  GET    /profile         → profile + preferences
  PATCH  /profile         → update profile
  PATCH  /preferences     → base currency, theme, language

/api/export (phase 2)
  GET    /[pid]/csv       → export positions to CSV
  GET    /[pid]/pdf       → PDF report (via Worker)
  GET    /[pid]/tax?year  → tax report
```

Rate limiting per endpoint:
- `/api/market/search` → 30 req/min
- `/api/transaction` → 60 req/min
- `/api/*` (general) → 120 req/min per user

Response format: `{ data, error, meta: { total, page } }`
Pagination: cursor-based for transactions and history.

## Frontend Components

### Design System
- **Framework:** Tailwind CSS + shadcn/ui
- **Theme:** Light default, dark toggle. System preference respected.
- **Colors:** Green (#16a34a) gain, Red (#dc2626) loss, Blue (#2563eb) primary, Gray (#64748b) secondary
- **Typography:** Inter (UI) + JetBrains Mono (numbers/prices)
- **Responsive:** Mobile-first, breakpoints sm/md/lg/xl

### Core Components
- **PriceDisplay** — price with dynamic color + ↑↓ arrow + NumberFlow rolling animation on change
- **PortfolioChart** — Recharts line chart, period toggles (1D-MAX), hover tooltip, SWR revalidation every 30s
- **AllocationDonut** — interactive donut chart by type/sector/geo. Click slice → filter positions table
- **PositionsTable** — sortable columns (Symbol, Name, Price, Change, Qty, Cost, P&L, %). Transforms to stacked cards on mobile
- **TransactionModal** — symbol autocomplete, cost preview, optimistic UI (closes and updates immediately)
- **SymbolSearch** — Cmd+K global search, debounced 300ms, results show symbol/name/type/exchange/price
- **CurrencyToggle** — header switch, converts all values instantly using cached Banxico rates

### UI Infrastructure
- **SkeletonLoaders** — animated placeholders for Card, Chart, Table on first load
- **ErrorBoundary** — per-component error catching with retry button, never crashes full page
- **KeyboardShortcuts** — Cmd+K (search), Cmd+N (new transaction), Cmd+1/2/3 (switch portfolios), Esc (close modal), ←→ (chart period)
- **ResponsiveSwitch** — table↔cards based on viewport

### Data Strategy
- **SWR** for all data fetching — stale-while-revalidate, zero loading spinners after first visit
- **Optimistic UI** for mutations — TransactionModal closes immediately, table updates before server confirms
- **Error recovery** — if optimistic update fails, revert UI and show toast notification

## Security (7 layers)

### 1. Next.js Middleware (middleware.ts)
- Public routes: `/`, `/login`, `/register` → pass through
- All `/dashboard`, `/portfolio`, `/api/*` → validate JWT
- Invalid/expired JWT → redirect `/login`
- Auto-refresh token if JWT near expiry

### 2. CSRF Protection
```typescript
if (isMutationRequest(req)) {
  const origin = req.headers.get('origin')
  if (origin !== process.env.NEXT_PUBLIC_APP_URL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
}
```

### 3. Zod Input Validation
Every API route validates input with Zod schemas. Example:
```typescript
const TransactionSchema = z.object({
  portfolio_id: z.string().uuid(),
  symbol: z.string().max(20).regex(/^[A-Z0-9.-]+$/),
  type: z.enum(['buy', 'sell', 'dividend', 'split']),
  quantity: z.number().positive().max(999_999_999),
  price: z.number().positive().max(999_999_999),
  fees: z.number().min(0).default(0),
  currency: z.enum(['MXN', 'USD', 'EUR']),
  executed_at: z.string().datetime(),
  notes: z.string().max(500).optional()
})
```

### 4. Rate Limiting
KV-based counter per user per endpoint. Limits defined per route (see API Routes section).

### 5. Supabase RLS
Every user-owned table: `WHERE user_id = auth.uid()` (or joined through parent).
Price tables: `SELECT` for authenticated, `INSERT/UPDATE` for service_role only.

### 6. Service Role Isolation
Workers use `SUPABASE_SERVICE_ROLE_KEY` — only writes to price tables, never user tables.

### 7. Secrets Rotation
API keys rotated every 90 days. Stored in Vercel env vars and Cloudflare Worker secrets.

## Optimizations Included (Phase 1)

1. **3-layer cache** (KV → Supabase → API) — 90%+ reduction in external calls
2. **Optimistic UI + SWR** — zero loading spinners, instant interactions
3. **Row Level Security** — database-level user isolation
4. **Dark/Light mode** — Tailwind dark: classes, system preference detection

## Deferred to Phase 2+

- WebSockets / Supabase Realtime for live price push
- Analytics Worker for heavy calculations (Sharpe, Monte Carlo)
- PWA + push notifications
- Export & reporting (PDF, CSV, tax reports)
- OAuth (Google/GitHub) + 2FA
- Email verification + password recovery

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS, shadcn/ui |
| Charts | Recharts |
| Data fetching | SWR |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL |
| Realtime | Supabase Realtime (phase 2) |
| Price engine | Cloudflare Worker |
| Cache | Cloudflare KV |
| Deployment | Vercel |
| Validation | Zod |
| Animations | NumberFlow |

## Deploy Target

Vercel (frontend) + Cloudflare Workers (price engine) + Supabase (database).
All free tier compatible for initial launch.
