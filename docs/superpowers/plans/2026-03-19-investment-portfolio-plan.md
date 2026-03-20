# Investment Portfolio Platform — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a multi-user investment portfolio platform with real-time market data, analytics, and startup-quality UX.

**Architecture:** Next.js 15 monolith on Vercel (frontend + API routes + auth), Cloudflare Worker for price fetching/caching, Supabase for PostgreSQL database + auth. Three-layer cache: KV → Supabase → external APIs.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS, shadcn/ui, Recharts, SWR, Zod, Supabase (auth + DB), Cloudflare Workers + KV, Upstash Redis (rate limiting), NumberFlow.

**Spec:** `docs/superpowers/specs/2026-03-19-investment-portfolio-design.md`

---

## File Structure

```
investment-portfolio/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout: fonts, theme provider, sidebar
│   │   ├── page.tsx                      # Landing page (/)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx            # Login page
│   │   │   └── register/page.tsx         # Register page
│   │   ├── (app)/                        # Authenticated layout group
│   │   │   ├── layout.tsx                # App shell: sidebar + header + currency toggle
│   │   │   ├── dashboard/page.tsx        # Main dashboard
│   │   │   ├── portfolio/
│   │   │   │   ├── page.tsx              # Portfolio list
│   │   │   │   ├── new/page.tsx          # Create portfolio
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx          # Portfolio detail
│   │   │   │       └── analytics/page.tsx # Analytics page
│   │   │   ├── market/
│   │   │   │   ├── page.tsx              # Market search + most held
│   │   │   │   └── [symbol]/page.tsx     # Asset detail
│   │   │   ├── watchlist/page.tsx        # Watchlists
│   │   │   └── settings/page.tsx         # Settings
│   │   └── api/
│   │       ├── portfolio/
│   │       │   ├── route.ts              # GET (list), POST (create)
│   │       │   └── [id]/route.ts         # GET (detail), PATCH, DELETE
│   │       ├── transaction/
│   │       │   ├── route.ts              # POST (create), GET (list)
│   │       │   └── [id]/route.ts         # DELETE
│   │       ├── market/
│   │       │   ├── search/route.ts       # GET search
│   │       │   └── [symbol]/
│   │       │       ├── route.ts          # GET price
│   │       │       └── history/route.ts  # GET history
│   │       ├── watchlist/
│   │       │   ├── route.ts              # GET, POST
│   │       │   └── [id]/
│   │       │       ├── add/route.ts      # POST add symbol
│   │       │       └── [symbol]/route.ts # DELETE symbol
│   │       ├── analytics/[pid]/
│   │       │   ├── performance/route.ts  # GET performance
│   │       │   ├── allocation/route.ts   # GET allocation
│   │       │   ├── risk/route.ts         # GET risk metrics
│   │       │   └── benchmark/route.ts    # GET benchmark comparison
│   │       ├── alerts/
│   │       │   ├── route.ts              # GET, POST
│   │       │   └── [id]/route.ts         # PATCH, DELETE
│   │       └── user/
│   │           ├── profile/route.ts      # GET, PATCH
│   │           └── preferences/route.ts  # PATCH
│   ├── components/
│   │   ├── ui/                           # shadcn/ui components (auto-generated)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx               # Collapsible sidebar navigation
│   │   │   ├── header.tsx                # Top bar: search, currency toggle, user menu
│   │   │   ├── mobile-nav.tsx            # Bottom tab bar for mobile
│   │   │   └── theme-toggle.tsx          # Dark/light mode switch
│   │   ├── portfolio/
│   │   │   ├── portfolio-card.tsx        # Portfolio summary card
│   │   │   ├── positions-table.tsx       # Sortable positions table (desktop)
│   │   │   ├── position-card.tsx         # Position card (mobile)
│   │   │   └── transaction-modal.tsx     # Add transaction dialog
│   │   ├── market/
│   │   │   ├── symbol-search.tsx         # Cmd+K global search
│   │   │   ├── price-display.tsx         # Price with color + NumberFlow
│   │   │   └── price-chart.tsx           # Recharts line chart with period toggles
│   │   ├── dashboard/
│   │   │   ├── kpi-cards.tsx             # Value, return, positions KPI cards
│   │   │   ├── portfolio-chart.tsx       # Performance line chart
│   │   │   ├── allocation-donut.tsx      # Asset allocation donut
│   │   │   └── top-movers.tsx            # Top gaining/losing positions
│   │   ├── analytics/
│   │   │   ├── performance-chart.tsx     # Performance vs time
│   │   │   ├── benchmark-chart.tsx       # Portfolio vs benchmarks
│   │   │   ├── risk-metrics.tsx          # Volatility, Sharpe, drawdown cards
│   │   │   └── correlation-matrix.tsx    # Position correlations heatmap
│   │   └── shared/
│   │       ├── skeleton-card.tsx         # Skeleton loader for cards
│   │       ├── skeleton-chart.tsx        # Skeleton loader for charts
│   │       ├── skeleton-table.tsx        # Skeleton loader for tables
│   │       ├── error-boundary.tsx        # Error boundary with retry
│   │       ├── currency-toggle.tsx       # Currency switcher
│   │       └── keyboard-shortcuts.tsx    # Global keyboard shortcut handler
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                # Browser Supabase client
│   │   │   ├── server.ts                # Server Supabase client
│   │   │   ├── middleware.ts             # Supabase auth middleware helper
│   │   │   └── types.ts                 # Generated DB types
│   │   ├── api/
│   │   │   ├── response.ts              # Standardized { data, error, meta } helpers
│   │   │   ├── validate.ts              # Zod validation wrapper
│   │   │   └── rate-limit.ts            # Upstash rate limiting
│   │   ├── schemas/
│   │   │   ├── portfolio.ts             # Portfolio Zod schemas
│   │   │   ├── transaction.ts           # Transaction Zod schemas
│   │   │   ├── watchlist.ts             # Watchlist Zod schemas
│   │   │   ├── alert.ts                 # Alert Zod schemas
│   │   │   └── user.ts                  # User/profile Zod schemas
│   │   ├── hooks/
│   │   │   ├── use-portfolios.ts        # SWR hook for portfolios
│   │   │   ├── use-positions.ts         # SWR hook for positions
│   │   │   ├── use-market.ts            # SWR hook for market data
│   │   │   ├── use-watchlist.ts         # SWR hook for watchlists
│   │   │   ├── use-currency.ts          # Currency conversion context + hook
│   │   │   └── use-keyboard.ts          # Keyboard shortcut hook
│   │   ├── services/
│   │   │   ├── portfolio.ts             # Portfolio business logic (server-side)
│   │   │   ├── transaction.ts           # Transaction + position recalculation logic
│   │   │   ├── market.ts               # Yahoo Finance / price proxy logic
│   │   │   └── analytics.ts            # Risk, allocation, benchmark calculations
│   │   └── utils/
│   │       ├── currency.ts              # Currency formatting + conversion
│   │       ├── date.ts                  # Date formatting helpers
│   │       └── numbers.ts              # Number formatting (compact, percentage)
│   ├── middleware.ts                     # Next.js middleware: auth + CSRF
│   └── providers/
│       ├── theme-provider.tsx           # next-themes provider
│       └── currency-provider.tsx        # Currency context provider
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql       # Full schema + RLS + indexes
├── worker/
│   ├── src/
│   │   └── index.ts                     # Worker entry: cron router + all fetchers (Phase 1 — single file)
│   ├── wrangler.toml                    # Cloudflare Worker config
│   ├── tsconfig.json
│   └── package.json
├── tests/
│   ├── lib/
│   │   ├── transaction.test.ts          # Position recalculation tests
│   │   ├── currency.test.ts             # Currency conversion tests
│   │   └── analytics.test.ts            # Risk metrics calculation tests
│   └── api/
│       ├── portfolio.test.ts            # Portfolio API route tests
│       └── transaction.test.ts          # Transaction API route tests
├── .env.local.example                   # Template for env vars
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── vitest.config.ts
```

---

## Chunk 1: Foundation — Scaffolding, Database, Auth

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `.env.local.example`
- Create: `src/app/layout.tsx`

- [ ] **Step 1: Create Next.js 15 project**

```bash
cd /c/Users/ponye/Projects/investment-portfolio
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --yes
```

- [ ] **Step 2: Install core dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr swr zod recharts @number-flow/react next-themes
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init -y -d
```

- [ ] **Step 4: Add shadcn components we'll need**

```bash
npx shadcn@latest add button card dialog dropdown-menu input label select separator sheet skeleton table tabs toast sonner avatar badge command popover
```

- [ ] **Step 5: Install fonts**

Add Inter and JetBrains Mono via `next/font` in `src/app/layout.tsx`:

```tsx
import { Inter, JetBrains_Mono } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
```

- [ ] **Step 6: Create .env.local.example**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API Keys (for market/search proxy — optional, worker handles most fetching)
ALPHA_VANTAGE_API_KEY=
```

- [ ] **Step 7: Configure vitest**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

Create `tests/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 8: Add test script to package.json**

Add to `scripts`: `"test": "vitest", "test:run": "vitest run"`

- [ ] **Step 9: Verify the app runs**

```bash
npm run dev
```
Expected: Next.js dev server starts on localhost:3000.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 project with Tailwind, shadcn/ui, Supabase deps"
```

---

### Task 2: Supabase Schema + RLS

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/001_initial_schema.sql

-- Profiles
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  base_currency TEXT NOT NULL DEFAULT 'MXN',
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Portfolios
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_currency TEXT NOT NULL DEFAULT 'MXN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Positions
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('stock','etf','crypto','bond','forex','commodity')),
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX idx_positions_portfolio_id ON positions(portfolio_id);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES positions ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy','sell','dividend','split')),
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  fees NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_position_id ON transactions(position_id);

-- Watchlists
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES watchlists ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_items_watchlist_id ON watchlist_items(watchlist_id);

-- Alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above','below','pct_change_daily')),
  target_value NUMERIC NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_symbol ON alerts(symbol, is_active);

-- Current prices (shared)
CREATE TABLE current_prices (
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'US',
  price NUMERIC NOT NULL,
  change_pct NUMERIC,
  volume BIGINT,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (symbol, exchange)
);

-- Price history (shared)
CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'US',
  date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  PRIMARY KEY (symbol, exchange, date)
);

-- Failed fetches (worker debugging)
CREATE TABLE failed_fetches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT false
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE current_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_fetches ENABLE ROW LEVEL SECURITY;

-- Profiles: users see only their own
CREATE POLICY profiles_select ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (user_id = auth.uid());

-- Portfolios: users see only their own (excluding soft-deleted)
CREATE POLICY portfolios_select ON portfolios FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY portfolios_insert ON portfolios FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY portfolios_update ON portfolios FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY portfolios_delete ON portfolios FOR DELETE USING (user_id = auth.uid());

-- Positions: through portfolio ownership
CREATE POLICY positions_select ON positions FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_insert ON positions FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_update ON positions FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_delete ON positions FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- Transactions: through position → portfolio ownership
CREATE POLICY transactions_select ON transactions FOR SELECT
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));
CREATE POLICY transactions_delete ON transactions FOR DELETE
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));

-- Watchlists
CREATE POLICY watchlists_all ON watchlists FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY watchlist_items_all ON watchlist_items FOR ALL
  USING (watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid()))
  WITH CHECK (watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid()));

-- Alerts
CREATE POLICY alerts_all ON alerts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Price tables: read-only for authenticated, write for service_role
CREATE POLICY prices_select ON current_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY history_select ON price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY failed_fetches_service ON failed_fetches FOR ALL TO service_role USING (true);
```

- [ ] **Step 2: Apply migration to Supabase**

Run the SQL in the Supabase dashboard SQL Editor, or via Supabase CLI:
```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema with RLS policies and indexes"
```

---

### Task 3: Supabase Client Setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Create browser client**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create server client**

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — ignore
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Create middleware helper**

```typescript
// src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Public routes that don't require auth
  const publicPaths = ['/', '/login', '/register']
  const isPublicPath = publicPaths.some(p => request.nextUrl.pathname === p)
  const isApiAuth = request.nextUrl.pathname.startsWith('/api/auth')

  if (!user && !isPublicPath && !isApiAuth) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // CSRF check for mutations
  if (user && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('origin')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (origin && appUrl && origin !== appUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  return supabaseResponse
}
```

- [ ] **Step 4: Create Next.js middleware**

```typescript
// src/middleware.ts
import { updateSession } from '@/lib/supabase/middleware'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/ src/middleware.ts
git commit -m "feat: add Supabase client setup with auth middleware and CSRF protection"
```

---

### Task 4: Auth Pages (Login + Register)

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Create login page**

```tsx
// src/app/(auth)/login/page.tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Iniciar Sesión</CardTitle>
          <CardDescription>Ingresa a tu portafolio de inversión</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            ¿No tienes cuenta? <Link href="/register" className="text-primary hover:underline">Regístrate</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create register page**

```tsx
// src/app/(auth)/register/page.tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Crear Cuenta</CardTitle>
          <CardDescription>Empieza a trackear tus inversiones</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={displayName} onChange={e => setDisplayName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creando cuenta...' : 'Crear Cuenta'}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            ¿Ya tienes cuenta? <Link href="/login" className="text-primary hover:underline">Inicia sesión</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verify auth flow works**

```bash
npm run dev
```
Navigate to `/register`, create a test account, verify redirect to `/dashboard`.
Navigate to `/login`, log in with test account, verify redirect to `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/
git commit -m "feat: add login and register pages with Supabase auth"
```

---

### Task 5: Theme Provider + Root Layout

**Files:**
- Create: `src/providers/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create theme provider**

```tsx
// src/providers/theme-provider.tsx
'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { type ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  )
}
```

- [ ] **Step 2: Update root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from '@/providers/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'InvestTracker — Tu Portafolio de Inversión',
  description: 'Plataforma profesional para trackear y analizar tus inversiones en tiempo real.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/ src/app/layout.tsx
git commit -m "feat: add theme provider with dark/light mode and root layout with fonts"
```

---

### Task 6: API Helpers — Response, Validation, Rate Limiting

**Files:**
- Create: `src/lib/api/response.ts`
- Create: `src/lib/api/validate.ts`
- Create: `src/lib/api/rate-limit.ts`

- [ ] **Step 1: Create standardized response helper**

```typescript
// src/lib/api/response.ts
import { NextResponse } from 'next/server'

export type ApiResponse<T = unknown> = {
  data: T | null
  error: string | null
  meta?: { total?: number; cursor?: string }
}

export function success<T>(data: T, meta?: ApiResponse['meta'], status = 200) {
  return NextResponse.json({ data, error: null, meta } satisfies ApiResponse<T>, { status })
}

export function error(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message } satisfies ApiResponse, { status })
}
```

- [ ] **Step 2: Create Zod validation wrapper**

```typescript
// src/lib/api/validate.ts
import { type ZodSchema, ZodError } from 'zod'
import { error } from './response'

export async function validate<T>(schema: ZodSchema<T>, data: unknown): Promise<{ data: T } | { error: ReturnType<typeof error> }> {
  try {
    const parsed = schema.parse(data)
    return { data: parsed }
  } catch (e) {
    if (e instanceof ZodError) {
      const messages = e.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      return { error: error(messages, 400) }
    }
    return { error: error('Invalid input', 400) }
  }
}
```

- [ ] **Step 3: Create rate limiter**

```bash
npm install @upstash/ratelimit @upstash/redis
```

```typescript
// src/lib/api/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const limiters = {
  search: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), prefix: 'rl:search' }),
  transaction: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'rl:transaction' }),
  general: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 m'), prefix: 'rl:general' }),
}

export async function rateLimit(userId: string, tier: keyof typeof limiters = 'general') {
  const { success } = await limiters[tier].limit(userId)
  return success
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/
git commit -m "feat: add API helpers — standardized responses, Zod validation, Upstash rate limiting"
```

---

### Task 7: Zod Schemas

**Files:**
- Create: `src/lib/schemas/portfolio.ts`
- Create: `src/lib/schemas/transaction.ts`
- Create: `src/lib/schemas/watchlist.ts`
- Create: `src/lib/schemas/alert.ts`
- Create: `src/lib/schemas/user.ts`

- [ ] **Step 1: Create all schemas**

```typescript
// src/lib/schemas/portfolio.ts
import { z } from 'zod'

export const CreatePortfolioSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_currency: z.enum(['MXN', 'USD', 'EUR']).default('MXN'),
})

export const UpdatePortfolioSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})
```

```typescript
// src/lib/schemas/transaction.ts
import { z } from 'zod'

export const CreateTransactionSchema = z.object({
  portfolio_id: z.string().uuid(),
  symbol: z.string().max(20).regex(/^[A-Z0-9.:-]+$/),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity']),
  type: z.enum(['buy', 'sell', 'dividend', 'split']),
  quantity: z.number().positive().max(999_999_999),
  price: z.number().positive().max(999_999_999),
  fees: z.number().min(0).default(0),
  currency: z.enum(['MXN', 'USD', 'EUR']),
  executed_at: z.string().datetime(),
  notes: z.string().max(500).optional(),
})
```

```typescript
// src/lib/schemas/watchlist.ts
import { z } from 'zod'

export const CreateWatchlistSchema = z.object({
  name: z.string().min(1).max(100),
})

export const AddWatchlistItemSchema = z.object({
  symbol: z.string().max(20).regex(/^[A-Z0-9.:-]+$/),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity']),
})
```

```typescript
// src/lib/schemas/alert.ts
import { z } from 'zod'

export const CreateAlertSchema = z.object({
  symbol: z.string().max(20).regex(/^[A-Z0-9.:-]+$/),
  condition: z.enum(['above', 'below', 'pct_change_daily']),
  target_value: z.number(),
})

export const UpdateAlertSchema = z.object({
  condition: z.enum(['above', 'below', 'pct_change_daily']).optional(),
  target_value: z.number().optional(),
  is_active: z.boolean().optional(),
})
```

```typescript
// src/lib/schemas/user.ts
import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional(),
})

export const UpdatePreferencesSchema = z.object({
  base_currency: z.enum(['MXN', 'USD', 'EUR']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemas/
git commit -m "feat: add Zod validation schemas for all API entities"
```

---

### Task 8: Utility Functions

**Files:**
- Create: `src/lib/utils/currency.ts`
- Create: `src/lib/utils/date.ts`
- Create: `src/lib/utils/numbers.ts`

- [ ] **Step 1: Write failing test for currency formatting**

```typescript
// tests/lib/currency.test.ts
import { describe, it, expect } from 'vitest'
import { formatCurrency, convertCurrency } from '@/lib/utils/currency'

describe('formatCurrency', () => {
  it('formats MXN correctly', () => {
    expect(formatCurrency(1234.56, 'MXN')).toBe('$1,234.56 MXN')
  })
  it('formats USD correctly', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56 USD')
  })
  it('formats EUR correctly', () => {
    expect(formatCurrency(1234.56, 'EUR')).toBe('€1,234.56 EUR')
  })
})

describe('convertCurrency', () => {
  it('converts USD to MXN', () => {
    const rates = { USD: 1, MXN: 17.5, EUR: 0.92 }
    expect(convertCurrency(100, 'USD', 'MXN', rates)).toBeCloseTo(1750)
  })
  it('returns same amount for same currency', () => {
    const rates = { USD: 1, MXN: 17.5, EUR: 0.92 }
    expect(convertCurrency(100, 'USD', 'USD', rates)).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/currency.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement currency utils**

```typescript
// src/lib/utils/currency.ts
const symbols: Record<string, string> = { MXN: '$', USD: '$', EUR: '€' }

export function formatCurrency(amount: number, currency: string): string {
  const symbol = symbols[currency] || '$'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
  const sign = amount < 0 ? '-' : ''
  return `${sign}${symbol}${formatted} ${currency}`
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  if (from === to) return amount
  const inUsd = amount / rates[from]
  return inUsd * rates[to]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/currency.test.ts
```
Expected: PASS

- [ ] **Step 5: Create date and number utils (no tests needed — simple formatters)**

```typescript
// src/lib/utils/date.ts
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date))
}

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'hace un momento'
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`
  return `hace ${Math.floor(seconds / 86400)}d`
}
```

```typescript
// src/lib/utils/numbers.ts
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/ tests/lib/
git commit -m "feat: add currency, date, and number utility functions with tests"
```

---

## Chunk 2: Core Features — Portfolio, Transactions, Market

### Task 9: Transaction Service (Business Logic)

**Files:**
- Create: `src/lib/services/transaction.ts`
- Create: `tests/lib/transaction.test.ts`

- [ ] **Step 1: Write failing tests for position recalculation**

```typescript
// tests/lib/transaction.test.ts
import { describe, it, expect } from 'vitest'
import { recalculatePosition } from '@/lib/services/transaction'

describe('recalculatePosition', () => {
  it('calculates avg cost for single buy', () => {
    const txns = [{ type: 'buy' as const, quantity: 10, price: 100, fees: 0 }]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(10)
    expect(result.avg_cost).toBe(100)
  })

  it('calculates weighted avg cost for multiple buys', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'buy' as const, quantity: 5, price: 200, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(15)
    expect(result.avg_cost).toBeCloseTo(133.33, 1)
  })

  it('handles sell — reduces quantity, keeps avg cost', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'sell' as const, quantity: 3, price: 150, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(7)
    expect(result.avg_cost).toBe(100)
  })

  it('handles split — doubles quantity, halves avg cost', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'split' as const, quantity: 2, price: 0, fees: 0 }, // 2:1 split
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(20)
    expect(result.avg_cost).toBe(50)
  })

  it('handles dividend — no change to position', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'dividend' as const, quantity: 0, price: 5, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(10)
    expect(result.avg_cost).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/transaction.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement recalculatePosition**

```typescript
// src/lib/services/transaction.ts
type TransactionInput = {
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
}

export function recalculatePosition(transactions: TransactionInput[]): {
  quantity: number
  avg_cost: number
} {
  let quantity = 0
  let totalCost = 0

  for (const txn of transactions) {
    switch (txn.type) {
      case 'buy':
        totalCost = (quantity * (quantity > 0 ? totalCost / quantity : 0)) + (txn.quantity * txn.price)
        quantity += txn.quantity
        break
      case 'sell':
        quantity -= txn.quantity
        // avg_cost stays the same, totalCost adjusts proportionally
        break
      case 'split':
        // quantity field = split ratio (e.g., 2 for 2:1 split)
        quantity *= txn.quantity
        // totalCost stays the same (same total investment, more shares)
        break
      case 'dividend':
        // Record-keeping only — no effect on position
        break
    }
  }

  const avg_cost = quantity > 0 ? totalCost / quantity : 0
  return { quantity: Math.max(0, quantity), avg_cost }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/transaction.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/transaction.ts tests/lib/transaction.test.ts
git commit -m "feat: add position recalculation logic with weighted average cost"
```

---

### Task 10: Portfolio API Routes

**Files:**
- Create: `src/lib/services/portfolio.ts`
- Create: `src/app/api/portfolio/route.ts`
- Create: `src/app/api/portfolio/[id]/route.ts`

- [ ] **Step 1: Create portfolio service**

```typescript
// src/lib/services/portfolio.ts
import { type SupabaseClient } from '@supabase/supabase-js'

export async function getUserPortfolios(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency
      )
    `)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return { data, error }
}

export async function getPortfolioDetail(supabase: SupabaseClient, portfolioId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency, opened_at,
        transactions (id, type, quantity, price, fees, currency, executed_at, notes, created_at)
      )
    `)
    .eq('id', portfolioId)
    .is('deleted_at', null)
    .single()

  return { data, error }
}
```

- [ ] **Step 2: Create portfolio list + create route**

```typescript
// src/app/api/portfolio/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreatePortfolioSchema } from '@/lib/schemas/portfolio'
import { getUserPortfolios } from '@/lib/services/portfolio'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await getUserPortfolios(supabase, user.id)
  if (dbError) return error(dbError.message, 500)

  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreatePortfolioSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
```

- [ ] **Step 3: Create portfolio detail route**

```typescript
// src/app/api/portfolio/[id]/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdatePortfolioSchema } from '@/lib/schemas/portfolio'
import { getPortfolioDetail } from '@/lib/services/portfolio'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await getPortfolioDetail(supabase, id)
  if (dbError) return error(dbError.message, dbError.code === 'PGRST116' ? 404 : 500)

  return success(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdatePortfolioSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .update(result.data)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('portfolios')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/portfolio.ts src/app/api/portfolio/
git commit -m "feat: add portfolio CRUD API routes with validation"
```

---

### Task 11: Transaction API Routes

**Files:**
- Create: `src/app/api/transaction/route.ts`
- Create: `src/app/api/transaction/[id]/route.ts`

- [ ] **Step 1: Create transaction routes**

```typescript
// src/app/api/transaction/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateTransactionSchema } from '@/lib/schemas/transaction'
import { recalculatePosition } from '@/lib/services/transaction'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const pid = url.searchParams.get('pid')
  if (!pid) return error('portfolio_id (pid) required', 400)

  const { data, error: dbError } = await supabase
    .from('transactions')
    .select('*, position:positions!inner(portfolio_id, symbol)')
    .eq('position.portfolio_id', pid)
    .order('executed_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreateTransactionSchema, body)
  if ('error' in result) return result.error

  const txn = result.data

  // Verify portfolio ownership (RLS handles this too, but we need the portfolio_id check)
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', txn.portfolio_id)
    .single()
  if (!portfolio) return error('Portfolio not found', 404)

  // Find or create position
  let { data: position } = await supabase
    .from('positions')
    .select('id, quantity')
    .eq('portfolio_id', txn.portfolio_id)
    .eq('symbol', txn.symbol)
    .single()

  if (!position) {
    if (txn.type !== 'buy') return error('Cannot sell/split/dividend without existing position', 400)
    const { data: newPos, error: posErr } = await supabase
      .from('positions')
      .insert({
        portfolio_id: txn.portfolio_id,
        symbol: txn.symbol,
        asset_type: txn.asset_type,
        quantity: 0,
        avg_cost: 0,
        currency: txn.currency,
      })
      .select()
      .single()
    if (posErr) return error(posErr.message, 500)
    position = newPos
  }

  // Validate sell quantity
  if (txn.type === 'sell' && txn.quantity > position.quantity) {
    return error(`Cannot sell ${txn.quantity} — only ${position.quantity} held`, 400)
  }

  // Insert transaction
  const { data: savedTxn, error: txnErr } = await supabase
    .from('transactions')
    .insert({
      position_id: position.id,
      type: txn.type,
      quantity: txn.quantity,
      price: txn.price,
      fees: txn.fees,
      currency: txn.currency,
      executed_at: txn.executed_at,
      notes: txn.notes,
    })
    .select()
    .single()
  if (txnErr) return error(txnErr.message, 500)

  // Recalculate position from all transactions
  const { data: allTxns } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', position.id)
    .order('executed_at', { ascending: true })

  if (allTxns) {
    const recalc = recalculatePosition(allTxns as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>)
    await supabase
      .from('positions')
      .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
      .eq('id', position.id)
  }

  return success(savedTxn, undefined, 201)
}
```

- [ ] **Step 2: Create transaction delete route**

```typescript
// src/app/api/transaction/[id]/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { recalculatePosition } from '@/lib/services/transaction'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get transaction to find position_id before deleting
  const { data: txn } = await supabase
    .from('transactions')
    .select('position_id')
    .eq('id', id)
    .single()
  if (!txn) return error('Transaction not found', 404)

  // Delete transaction
  const { error: delErr } = await supabase.from('transactions').delete().eq('id', id)
  if (delErr) return error(delErr.message, 500)

  // Recalculate position from remaining transactions
  const { data: remaining } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', txn.position_id)
    .order('executed_at', { ascending: true })

  const recalc = recalculatePosition((remaining || []) as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>)
  await supabase
    .from('positions')
    .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
    .eq('id', txn.position_id)

  return success({ deleted: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/transaction/
git commit -m "feat: add transaction API routes with position recalculation"
```

---

### Task 12: Market API Routes

**Files:**
- Create: `src/lib/services/market.ts`
- Create: `src/app/api/market/search/route.ts`
- Create: `src/app/api/market/[symbol]/route.ts`
- Create: `src/app/api/market/[symbol]/history/route.ts`

- [ ] **Step 1: Create market service (Yahoo Finance proxy)**

```typescript
// src/lib/services/market.ts
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v1/finance'

export async function searchSymbols(query: string) {
  const res = await fetch(
    `${YAHOO_BASE}/search?q=${encodeURIComponent(query)}&quotesCount=10&lang=en-US`,
    { next: { revalidate: 60 } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.quotes || []).map((q: Record<string, unknown>) => ({
    symbol: q.symbol,
    name: q.shortname || q.longname,
    type: q.quoteType,
    exchange: q.exchange,
    exchDisp: q.exchDisp,
  }))
}

export async function getQuote(symbol: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { next: { revalidate: 30 } }
  )
  if (!res.ok) return null
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  const meta = result.meta
  return {
    symbol: meta.symbol,
    price: meta.regularMarketPrice,
    previousClose: meta.previousClose,
    change: meta.regularMarketPrice - meta.previousClose,
    changePct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
    currency: meta.currency,
    exchange: meta.exchangeName,
    marketState: meta.marketState,
  }
}

export async function getHistory(symbol: string, range: string = '1mo') {
  const intervalMap: Record<string, string> = {
    '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
    '6mo': '1d', '1y': '1wk', '5y': '1mo', 'max': '1mo',
  }
  const interval = intervalMap[range] || '1d'

  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
    { next: { revalidate: 300 } }
  )
  if (!res.ok) return []
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return []

  const timestamps = result.timestamp || []
  const quotes = result.indicators?.quote?.[0] || {}

  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString(),
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    volume: quotes.volume?.[i],
  })).filter((p: { close: number | null }) => p.close !== null)
}
```

- [ ] **Step 2: Create search route**

```typescript
// src/app/api/market/search/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { searchSymbols } from '@/lib/services/market'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'search')
  if (!allowed) return error('Rate limit exceeded', 429)

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  if (!q || q.length < 1) return error('Query required', 400)

  const results = await searchSymbols(q)
  return success(results)
}
```

- [ ] **Step 3: Create symbol detail + history routes**

```typescript
// src/app/api/market/[symbol]/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Try Supabase cache first
  const { data: cached } = await supabase
    .from('current_prices')
    .select('*')
    .eq('symbol', symbol)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (cached) return success(cached)

  // Fallback to Yahoo Finance
  const quote = await getQuote(symbol)
  if (!quote) return error('Symbol not found', 404)

  return success(quote)
}
```

```typescript
// src/app/api/market/[symbol]/history/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') || '1mo'

  const history = await getHistory(symbol, range)
  return success(history)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/market.ts src/app/api/market/
git commit -m "feat: add market API routes — search, quote, and history via Yahoo Finance"
```

---

### Task 13: Watchlist, Alert, and User API Routes

**Files:**
- Create: `src/app/api/watchlist/route.ts`, `src/app/api/watchlist/[id]/add/route.ts`, `src/app/api/watchlist/[id]/[symbol]/route.ts`
- Create: `src/app/api/alerts/route.ts`, `src/app/api/alerts/[id]/route.ts`
- Create: `src/app/api/user/profile/route.ts`, `src/app/api/user/preferences/route.ts`

- [ ] **Step 1: Create watchlist routes**

```typescript
// src/app/api/watchlist/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateWatchlistSchema } from '@/lib/schemas/watchlist'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .select('*, watchlist_items(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreateWatchlistSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
```

```typescript
// src/app/api/watchlist/[id]/add/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { AddWatchlistItemSchema } from '@/lib/schemas/watchlist'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(AddWatchlistItemSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('watchlist_items')
    .insert({ ...result.data, watchlist_id: id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
```

```typescript
// src/app/api/watchlist/[id]/[symbol]/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', id)
    .eq('symbol', decodeURIComponent(symbol))

  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
```

- [ ] **Step 2: Create alert routes**

```typescript
// src/app/api/alerts/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateAlertSchema } from '@/lib/schemas/alert'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreateAlertSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('alerts')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
```

```typescript
// src/app/api/alerts/[id]/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdateAlertSchema } from '@/lib/schemas/alert'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdateAlertSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('alerts')
    .update(result.data)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase.from('alerts').delete().eq('id', id)
  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
```

- [ ] **Step 3: Create user profile/preferences routes**

```typescript
// src/app/api/user/profile/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdateProfileSchema } from '@/lib/schemas/user'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (dbError) return error(dbError.message, 500)
  return success({ ...data, email: user.email })
}

export async function PATCH(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdateProfileSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('profiles')
    .update(result.data)
    .eq('user_id', user.id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
```

```typescript
// src/app/api/user/preferences/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdatePreferencesSchema } from '@/lib/schemas/user'

export async function PATCH(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdatePreferencesSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('profiles')
    .update(result.data)
    .eq('user_id', user.id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/watchlist/ src/app/api/alerts/ src/app/api/user/
git commit -m "feat: add watchlist, alert, and user API routes"
```

---

### Task 14: SWR Hooks

**Files:**
- Create: `src/lib/hooks/use-portfolios.ts`
- Create: `src/lib/hooks/use-positions.ts`
- Create: `src/lib/hooks/use-market.ts`
- Create: `src/lib/hooks/use-watchlist.ts`
- Create: `src/lib/hooks/use-currency.ts`

- [ ] **Step 1: Create all SWR hooks**

```typescript
// src/lib/hooks/use-portfolios.ts
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function usePortfolios() {
  return useSWR('/api/portfolio', fetcher)
}

export function usePortfolio(id: string | null) {
  return useSWR(id ? `/api/portfolio/${id}` : null, fetcher)
}
```

```typescript
// src/lib/hooks/use-positions.ts
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useTransactions(portfolioId: string | null) {
  return useSWR(portfolioId ? `/api/transaction?pid=${portfolioId}` : null, fetcher)
}
```

```typescript
// src/lib/hooks/use-market.ts
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useMarketSearch(query: string) {
  return useSWR(
    query.length >= 1 ? `/api/market/search?q=${encodeURIComponent(query)}` : null,
    fetcher,
    { dedupingInterval: 300 }
  )
}

export function useQuote(symbol: string | null) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 30000 }
  )
}

export function usePriceHistory(symbol: string | null, range: string = '1mo') {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/history?range=${range}` : null,
    fetcher
  )
}
```

```typescript
// src/lib/hooks/use-watchlist.ts
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useWatchlists() {
  return useSWR('/api/watchlist', fetcher)
}
```

```typescript
// src/lib/hooks/use-currency.ts
'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { convertCurrency, formatCurrency } from '@/lib/utils/currency'

type CurrencyContextType = {
  currency: string
  setCurrency: (c: string) => void
  format: (amount: number, from?: string) => string
  convert: (amount: number, from: string) => number
  rates: Record<string, number>
}

const CurrencyContext = createContext<CurrencyContextType | null>(null)

// Default rates — updated by Banxico worker
const DEFAULT_RATES: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }

export function CurrencyProvider({ children, initialCurrency = 'MXN' }: { children: ReactNode; initialCurrency?: string }) {
  const [currency, setCurrency] = useState(initialCurrency)
  const [rates] = useState(DEFAULT_RATES)

  const convert = (amount: number, from: string) => convertCurrency(amount, from, currency, rates)
  const format = (amount: number, from?: string) => {
    const converted = from ? convert(amount, from) : amount
    return formatCurrency(converted, currency)
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, convert, rates }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/hooks/
git commit -m "feat: add SWR hooks for portfolios, market, watchlists, and currency context"
```

---

## Chunk 3: Frontend — Layout, Dashboard, Portfolio Pages

### Task 15: App Shell — Sidebar + Header

**Files:**
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/header.tsx`
- Create: `src/components/layout/mobile-nav.tsx`
- Create: `src/components/layout/theme-toggle.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/providers/currency-provider.tsx`

- [ ] **Step 1: Create theme toggle**

```tsx
// src/components/layout/theme-toggle.tsx
'use client'

import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
```

- [ ] **Step 2: Create sidebar**

```tsx
// src/components/layout/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portafolios', icon: Briefcase },
  { href: '/market', label: 'Mercado', icon: TrendingUp },
  { href: '/watchlist', label: 'Watchlists', icon: Eye },
  { href: '/settings', label: 'Ajustes', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside className={cn(
      'hidden md:flex flex-col border-r bg-background transition-all duration-300',
      collapsed ? 'w-16' : 'w-60'
    )}>
      <div className="flex items-center justify-between p-4 border-b">
        {!collapsed && <span className="font-bold text-lg">InvestTracker</span>}
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname.startsWith(item.href)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 3: Create header**

```tsx
// src/components/layout/header.tsx
'use client'

import { ThemeToggle } from './theme-toggle'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Header() {
  const router = useRouter()
  const supabase = createClient()
  const { currency, setCurrency } = useCurrency()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="flex items-center justify-between px-4 h-14 border-b bg-background">
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => {/* SymbolSearch */}}>
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Buscar...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-xs text-muted-foreground">⌘K</kbd>
      </Button>

      <div className="flex items-center gap-2">
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MXN">MXN</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Avatar className="h-8 w-8">
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create mobile nav**

```tsx
// src/components/layout/mobile-nav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Settings } from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portafolio', icon: Briefcase },
  { href: '/market', label: 'Mercado', icon: TrendingUp },
  { href: '/watchlist', label: 'Watch', icon: Eye },
  { href: '/settings', label: 'Ajustes', icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background z-50">
      <div className="flex justify-around py-2">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center gap-1 px-2 py-1 text-xs',
              pathname.startsWith(item.href) ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 5: Create currency provider wrapper**

```tsx
// src/providers/currency-provider.tsx
'use client'

import { CurrencyProvider as CP } from '@/lib/hooks/use-currency'

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  return <CP initialCurrency="MXN">{children}</CP>
}
```

- [ ] **Step 6: Create app layout**

```tsx
// src/app/(app)/layout.tsx
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileNav } from '@/components/layout/mobile-nav'
import { CurrencyProvider } from '@/providers/currency-provider'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CurrencyProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
            {children}
          </main>
        </div>
        <MobileNav />
      </div>
    </CurrencyProvider>
  )
}
```

- [ ] **Step 7: Install lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 8: Verify layout renders**

```bash
npm run dev
```
Navigate to `/dashboard` — should see sidebar, header, empty content.

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/ src/app/\(app\)/ src/providers/currency-provider.tsx
git commit -m "feat: add app shell with collapsible sidebar, header, mobile nav, and currency provider"
```

---

### Task 16: Shared UI Components — Skeletons, ErrorBoundary, PriceDisplay

**Files:**
- Create: `src/components/shared/skeleton-card.tsx`
- Create: `src/components/shared/skeleton-chart.tsx`
- Create: `src/components/shared/skeleton-table.tsx`
- Create: `src/components/shared/error-boundary.tsx`
- Create: `src/components/market/price-display.tsx`

- [ ] **Step 1: Create skeleton components**

```tsx
// src/components/shared/skeleton-card.tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32 mb-1" />
        <Skeleton className="h-4 w-16" />
      </CardContent>
    </Card>
  )
}
```

```tsx
// src/components/shared/skeleton-chart.tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function SkeletonChart() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </CardContent>
    </Card>
  )
}
```

```tsx
// src/components/shared/skeleton-table.tsx
import { Skeleton } from '@/components/ui/skeleton'

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-4 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {[1, 2, 3, 4, 5].map(j => <Skeleton key={j} className="h-8 flex-1" />)}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create error boundary**

```tsx
// src/components/shared/error-boundary.tsx
'use client'

import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Algo salió mal</p>
          <Button size="sm" variant="outline" onClick={() => this.setState({ hasError: false })}>
            Reintentar
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 3: Create PriceDisplay component**

```tsx
// src/components/market/price-display.tsx
'use client'

import { cn } from '@/lib/utils'
import { formatNumber, formatPercent } from '@/lib/utils/numbers'
import { ArrowUp, ArrowDown } from 'lucide-react'

type Props = {
  price: number
  change?: number
  changePct?: number
  currency?: string
  size?: 'sm' | 'md' | 'lg'
}

export function PriceDisplay({ price, change, changePct, currency = 'USD', size = 'md' }: Props) {
  const isPositive = (change ?? 0) >= 0
  const colorClass = isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'

  const sizes = {
    sm: { price: 'text-sm font-mono', change: 'text-xs' },
    md: { price: 'text-lg font-mono font-semibold', change: 'text-sm' },
    lg: { price: 'text-3xl font-mono font-bold', change: 'text-base' },
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className={sizes[size].price}>
        {currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$'}{formatNumber(price)}
      </span>
      {change !== undefined && changePct !== undefined && (
        <span className={cn(sizes[size].change, colorClass, 'flex items-center gap-0.5')}>
          {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {formatPercent(changePct)}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/ src/components/market/price-display.tsx
git commit -m "feat: add skeleton loaders, error boundary, and PriceDisplay component"
```

---

### Task 17: Dashboard Page

**Files:**
- Create: `src/components/dashboard/kpi-cards.tsx`
- Create: `src/components/dashboard/portfolio-chart.tsx`
- Create: `src/components/dashboard/allocation-donut.tsx`
- Create: `src/components/dashboard/top-movers.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create KPI cards**

```tsx
// src/components/dashboard/kpi-cards.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatPercent } from '@/lib/utils/numbers'
import { TrendingUp, DollarSign, Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  currency: string
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, currency }: Props) {
  const { format } = useCurrency()
  const isPositive = totalReturn >= 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">{format(totalValue, currency)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Rendimiento Total</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={cn('text-2xl font-bold font-mono', isPositive ? 'text-green-600' : 'text-red-600')}>
            {format(totalReturn, currency)}
          </div>
          <p className={cn('text-xs', isPositive ? 'text-green-600' : 'text-red-600')}>
            {formatPercent(totalReturnPct)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Posiciones</CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">{positionCount}</div>
          <p className="text-xs text-muted-foreground">activos en portafolio</p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create portfolio chart**

```tsx
// src/components/dashboard/portfolio-chart.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { useState } from 'react'

type DataPoint = { date: string; value: number }

const periods = ['1D', '1W', '1M', '3M', '1Y', 'MAX'] as const

export function PortfolioChart({ data }: { data: DataPoint[] }) {
  const [period, setPeriod] = useState<string>('1M')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Rendimiento</CardTitle>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList className="h-8">
            {periods.map(p => (
              <TabsTrigger key={p} value={p} className="text-xs px-2 h-6">{p}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={60} />
            <Tooltip />
            <Area type="monotone" dataKey="value" stroke="#2563eb" fill="url(#colorValue)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create allocation donut**

```tsx
// src/components/dashboard/allocation-donut.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4']

type AllocationData = { name: string; value: number }

export function AllocationDonut({ data }: { data: AllocationData[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Distribución</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {data.map((item, i) => (
            <div key={item.name} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Create top movers**

```tsx
// src/components/dashboard/top-movers.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PriceDisplay } from '@/components/market/price-display'
import { cn } from '@/lib/utils'

type Mover = { symbol: string; name: string; price: number; changePct: number; currency: string }

export function TopMovers({ movers }: { movers: Mover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Top Movers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {movers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Agrega posiciones para ver tus top movers</p>
        )}
        {movers.map(m => (
          <div key={m.symbol} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{m.symbol}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[120px]">{m.name}</p>
            </div>
            <PriceDisplay price={m.price} changePct={m.changePct} currency={m.currency} size="sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Create dashboard page**

```tsx
// src/app/(app)/dashboard/page.tsx
'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { PortfolioChart } from '@/components/dashboard/portfolio-chart'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { TopMovers } from '@/components/dashboard/top-movers'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { useMemo } from 'react'

export default function DashboardPage() {
  const { data: portfolios, isLoading } = usePortfolios()

  const stats = useMemo(() => {
    if (!portfolios) return null

    let totalValue = 0
    let totalCost = 0
    let positionCount = 0
    const allocationMap: Record<string, number> = {}

    for (const portfolio of portfolios) {
      for (const pos of portfolio.positions || []) {
        if (pos.quantity > 0) {
          const value = pos.quantity * pos.avg_cost // Will be replaced with live price
          totalValue += value
          totalCost += pos.quantity * pos.avg_cost
          positionCount++
          allocationMap[pos.asset_type] = (allocationMap[pos.asset_type] || 0) + value
        }
      }
    }

    const totalReturn = totalValue - totalCost
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

    const allocation = Object.entries(allocationMap).map(([name, value]) => ({ name, value }))

    return { totalValue, totalReturn, totalReturnPct, positionCount, allocation }
  }, [portfolios])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <ErrorBoundary>
        <KpiCards
          totalValue={stats?.totalValue ?? 0}
          totalReturn={stats?.totalReturn ?? 0}
          totalReturnPct={stats?.totalReturnPct ?? 0}
          positionCount={stats?.positionCount ?? 0}
          currency="USD"
        />
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PortfolioChart data={[]} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AllocationDonut data={stats?.allocation ?? []} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <TopMovers movers={[]} />
      </ErrorBoundary>
    </div>
  )
}
```

- [ ] **Step 6: Verify dashboard renders**

```bash
npm run dev
```
Navigate to `/dashboard` — should see KPI cards (zeros), empty chart, empty donut.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/ src/app/\(app\)/dashboard/
git commit -m "feat: add dashboard page with KPI cards, portfolio chart, allocation donut, and top movers"
```

---

### Task 18: Portfolio Pages (List + Detail + New)

**Files:**
- Create: `src/components/portfolio/portfolio-card.tsx`
- Create: `src/components/portfolio/positions-table.tsx`
- Create: `src/components/portfolio/position-card.tsx`
- Create: `src/components/portfolio/transaction-modal.tsx`
- Create: `src/app/(app)/portfolio/page.tsx`
- Create: `src/app/(app)/portfolio/new/page.tsx`
- Create: `src/app/(app)/portfolio/[id]/page.tsx`

This task creates all 3 portfolio pages + the transaction modal. Each component follows the spec's UX guidelines (optimistic UI, mobile cards, etc.).

- [ ] **Step 1: Create portfolio card component**

```tsx
// src/components/portfolio/portfolio-card.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/lib/hooks/use-currency'
import Link from 'next/link'

type Props = {
  id: string
  name: string
  description?: string
  positions: Array<{ quantity: number; avg_cost: number; asset_type: string }>
}

export function PortfolioCard({ id, name, description, positions }: Props) {
  const { format } = useCurrency()
  const activePositions = positions.filter(p => p.quantity > 0)
  const totalValue = activePositions.reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)

  return (
    <Link href={`/portfolio/${id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{name}</CardTitle>
            <Badge variant="secondary">{activePositions.length} posiciones</Badge>
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold font-mono">{format(totalValue, 'USD')}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2: Create positions table**

```tsx
// src/components/portfolio/positions-table.tsx
'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { PriceDisplay } from '@/components/market/price-display'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatNumber } from '@/lib/utils/numbers'
import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Position = {
  id: string
  symbol: string
  asset_type: string
  quantity: number
  avg_cost: number
  currency: string
}

type SortKey = 'symbol' | 'quantity' | 'avg_cost' | 'value'

export function PositionsTable({ positions }: { positions: Position[] }) {
  const { format } = useCurrency()
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...positions].filter(p => p.quantity > 0).sort((a, b) => {
    const getValue = (p: Position) => {
      switch (sortKey) {
        case 'symbol': return p.symbol
        case 'quantity': return p.quantity
        case 'avg_cost': return p.avg_cost
        case 'value': return p.quantity * p.avg_cost
      }
    }
    const va = getValue(a)
    const vb = getValue(b)
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortHeader = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => toggleSort(k)}>
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader k="symbol">Símbolo</SortHeader></TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right"><SortHeader k="quantity">Cantidad</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="avg_cost">Costo Prom.</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="value">Valor</SortHeader></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(pos => (
              <TableRow key={pos.id}>
                <TableCell className="font-medium font-mono">{pos.symbol}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{pos.asset_type}</Badge></TableCell>
                <TableCell className="text-right font-mono">{formatNumber(pos.quantity, 4)}</TableCell>
                <TableCell className="text-right font-mono">{format(pos.avg_cost, pos.currency)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{format(pos.quantity * pos.avg_cost, pos.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sorted.map(pos => (
          <div key={pos.id} className="border rounded-lg p-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium font-mono">{pos.symbol}</p>
                <Badge variant="outline" className="text-xs mt-1">{pos.asset_type}</Badge>
              </div>
              <div className="text-right">
                <p className="font-mono font-medium">{format(pos.quantity * pos.avg_cost, pos.currency)}</p>
                <p className="text-xs text-muted-foreground">{formatNumber(pos.quantity, 4)} @ {format(pos.avg_cost, pos.currency)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

```

- [ ] **Step 3: Create transaction modal**

```tsx
// src/components/portfolio/transaction-modal.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatNumber } from '@/lib/utils/numbers'

type Props = { portfolioId: string }

export function TransactionModal({ portfolioId }: Props) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [type, setType] = useState<string>('buy')
  const [assetType, setAssetType] = useState<string>('stock')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('0')
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(false)
  const { mutate } = useSWRConfig()
  const { data: searchResults } = useMarketSearch(searchQuery)
  const { format } = useCurrency()

  const totalCost = (parseFloat(quantity) || 0) * (parseFloat(price) || 0) + (parseFloat(fees) || 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const res = await fetch('/api/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        symbol: symbol.toUpperCase(),
        asset_type: assetType,
        type,
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        fees: parseFloat(fees) || 0,
        currency,
        executed_at: new Date().toISOString(),
      }),
    })

    const data = await res.json()

    if (data.error) {
      toast.error(data.error)
      setLoading(false)
      return
    }

    toast.success('Transacción registrada')
    mutate(`/api/portfolio/${portfolioId}`)
    setOpen(false)
    setSymbol('')
    setQuantity('')
    setPrice('')
    setFees('0')
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Transacción</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Transacción</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Compra</SelectItem>
                  <SelectItem value="sell">Venta</SelectItem>
                  <SelectItem value="dividend">Dividendo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de activo</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Acción</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="bond">Bono/CETE</SelectItem>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="commodity">Commodity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Símbolo</Label>
            <Input
              value={symbol}
              onChange={e => { setSymbol(e.target.value); setSearchQuery(e.target.value) }}
              placeholder="AAPL, BTC-USD, AMXL.MX..."
              required
            />
            {searchResults && searchResults.length > 0 && searchQuery.length > 0 && symbol !== searchQuery && (
              <div className="border rounded-md mt-1 max-h-32 overflow-y-auto">
                {searchResults.slice(0, 5).map((r: { symbol: string; name: string; exchDisp: string }) => (
                  <button
                    key={r.symbol}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex justify-between"
                    onClick={() => { setSymbol(r.symbol); setSearchQuery('') }}
                  >
                    <span className="font-mono">{r.symbol}</span>
                    <span className="text-muted-foreground truncate ml-2">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0.0001" />
            </div>
            <div className="space-y-2">
              <Label>Precio</Label>
              <Input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} required min="0.01" />
            </div>
            <div className="space-y-2">
              <Label>Comisión</Label>
              <Input type="number" step="any" value={fees} onChange={e => setFees(e.target.value)} min="0" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              Total: <span className="font-mono font-medium text-foreground">{format(totalCost, currency)}</span>
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Registrar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Create portfolio list page**

```tsx
// src/app/(app)/portfolio/page.tsx
'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { PortfolioCard } from '@/components/portfolio/portfolio-card'
import { Button } from '@/components/ui/button'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default function PortfolioListPage() {
  const { data: portfolios, isLoading } = usePortfolios()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portafolios</h1>
        <Link href="/portfolio/new">
          <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo Portafolio</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : portfolios?.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No tienes portafolios aún</p>
          <Link href="/portfolio/new">
            <Button>Crear mi primer portafolio</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios?.map((p: Record<string, unknown>) => (
            <PortfolioCard key={p.id as string} id={p.id as string} name={p.name as string} description={p.description as string} positions={p.positions as []} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create new portfolio page**

```tsx
// src/app/(app)/portfolio/new/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

export default function NewPortfolioPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('MXN')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { mutate } = useSWRConfig()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const res = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, base_currency: currency }),
    })
    const data = await res.json()

    if (data.error) { toast.error(data.error); setLoading(false); return }

    toast.success('Portafolio creado')
    mutate('/api/portfolio')
    router.push(`/portfolio/${data.data.id}`)
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Nuevo Portafolio</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Mi portafolio principal" required />
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Inversiones a largo plazo" />
            </div>
            <div className="space-y-2">
              <Label>Moneda base</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN - Peso Mexicano</SelectItem>
                  <SelectItem value="USD">USD - Dólar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creando...' : 'Crear Portafolio'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Create portfolio detail page**

```tsx
// src/app/(app)/portfolio/[id]/page.tsx
'use client'

import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { PositionsTable } from '@/components/portfolio/positions-table'
import { TransactionModal } from '@/components/portfolio/transaction-modal'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { Button } from '@/components/ui/button'
import { use, useMemo } from 'react'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'

export default function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: portfolio, isLoading } = usePortfolio(id)

  const allocation = useMemo(() => {
    if (!portfolio?.positions) return []
    const map: Record<string, number> = {}
    for (const pos of portfolio.positions) {
      if (pos.quantity > 0) {
        map[pos.asset_type] = (map[pos.asset_type] || 0) + pos.quantity * pos.avg_cost
      }
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [portfolio])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonTable />
      </div>
    )
  }

  if (!portfolio) return <p className="text-muted-foreground">Portafolio no encontrado</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{portfolio.name}</h1>
          {portfolio.description && <p className="text-muted-foreground">{portfolio.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link href={`/portfolio/${id}/analytics`}>
            <Button variant="outline" size="sm"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</Button>
          </Link>
          <TransactionModal portfolioId={id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PositionsTable positions={portfolio.positions || []} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AllocationDonut data={allocation} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify portfolio flow works**

```bash
npm run dev
```
Navigate to `/portfolio/new` → create portfolio → see it in `/portfolio` → click into detail → add a transaction.

- [ ] **Step 8: Commit**

```bash
git add src/components/portfolio/ src/app/\(app\)/portfolio/
git commit -m "feat: add portfolio pages — list, create, detail with positions table and transaction modal"
```

---

### Task 19: Market + Watchlist + Settings Pages

**Files:**
- Create: `src/app/(app)/market/page.tsx`
- Create: `src/app/(app)/market/[symbol]/page.tsx`
- Create: `src/components/market/price-chart.tsx`
- Create: `src/app/(app)/watchlist/page.tsx`
- Create: `src/app/(app)/settings/page.tsx`

These are the remaining pages. Each follows the same pattern: SWR hook + component + page.

- [ ] **Step 1: Create price chart component**

```tsx
// src/components/market/price-chart.tsx
'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePriceHistory } from '@/lib/hooks/use-market'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useState } from 'react'

const rangeMap: Record<string, string> = {
  '1D': '1d', '5D': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', 'MAX': 'max',
}

export function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState('1M')
  const { data, isLoading } = usePriceHistory(symbol, rangeMap[range])

  if (isLoading) return <SkeletonChart />

  const chartData = (data || []).map((d: { date: string; close: number }) => ({
    date: new Date(d.date).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
    price: d.close,
  }))

  const isPositive = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price
  const color = isPositive ? '#16a34a' : '#dc2626'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Precio</CardTitle>
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="h-8">
            {Object.keys(rangeMap).map(r => (
              <TabsTrigger key={r} value={r} className="text-xs px-2 h-6">{r}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`color-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.1} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60} domain={['auto', 'auto']} />
            <Tooltip />
            <Area type="monotone" dataKey="price" stroke={color} fill={`url(#color-${symbol})`} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Create market page**

```tsx
// src/app/(app)/market/page.tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { Badge } from '@/components/ui/badge'
import { Search } from 'lucide-react'
import Link from 'next/link'

export default function MarketPage() {
  const [query, setQuery] = useState('')
  const { data: results, isLoading } = useMarketSearch(query)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mercado</h1>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar acciones, ETFs, crypto..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r: { symbol: string; name: string; type: string; exchDisp: string }) => (
            <Link key={r.symbol} href={`/market/${encodeURIComponent(r.symbol)}`}>
              <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted transition-colors">
                <div>
                  <span className="font-mono font-medium">{r.symbol}</span>
                  <p className="text-sm text-muted-foreground">{r.name}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">{r.type}</Badge>
                  <Badge variant="secondary">{r.exchDisp}</Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {query && results?.length === 0 && !isLoading && (
        <p className="text-muted-foreground text-center py-8">No se encontraron resultados para "{query}"</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create market symbol detail page**

```tsx
// src/app/(app)/market/[symbol]/page.tsx
'use client'

import { use } from 'react'
import { useQuote } from '@/lib/hooks/use-market'
import { PriceDisplay } from '@/components/market/price-display'
import { PriceChart } from '@/components/market/price-chart'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'

export default function SymbolDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params)
  const decodedSymbol = decodeURIComponent(symbol)
  const { data: quote, isLoading } = useQuote(decodedSymbol)

  if (isLoading) return <SkeletonCard />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-mono">{decodedSymbol}</h1>
        {quote && (
          <PriceDisplay
            price={quote.price}
            change={quote.change}
            changePct={quote.changePct}
            currency={quote.currency}
            size="lg"
          />
        )}
      </div>

      <ErrorBoundary>
        <PriceChart symbol={decodedSymbol} />
      </ErrorBoundary>
    </div>
  )
}
```

- [ ] **Step 4: Create watchlist page**

```tsx
// src/app/(app)/watchlist/page.tsx
'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'

export default function WatchlistPage() {
  const { data: watchlists, isLoading } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!newName) return
    setCreating(true)
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist creada'); mutate('/api/watchlist') }
    setNewName('')
    setCreating(false)
  }

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input className="w-48" placeholder="Nueva watchlist..." value={newName} onChange={e => setNewName(e.target.value)} />
          <Button size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {watchlists?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No tienes watchlists. Crea una para empezar a seguir activos.</p>
      )}

      {watchlists?.map((wl: { id: string; name: string; watchlist_items: Array<{ id: string; symbol: string; asset_type: string }> }) => (
        <Card key={wl.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{wl.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {wl.watchlist_items?.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin activos. Busca en el mercado y agrega activos a esta watchlist.</p>
            ) : (
              <div className="space-y-2">
                {wl.watchlist_items?.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-1">
                    <span className="font-mono text-sm">{item.symbol}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await fetch(`/api/watchlist/${wl.id}/${encodeURIComponent(item.symbol)}`, { method: 'DELETE' })
                        mutate('/api/watchlist')
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create settings page**

```tsx
// src/app/(app)/settings/page.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export default function SettingsPage() {
  const { data: profile, mutate } = useSWR('/api/user/profile', fetcher)
  const { theme, setTheme } = useTheme()
  const [displayName, setDisplayName] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('MXN')

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '')
      setBaseCurrency(profile.base_currency || 'MXN')
    }
  }, [profile])

  async function saveProfile() {
    await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    })
    toast.success('Perfil actualizado')
    mutate()
  }

  async function savePreferences() {
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_currency: baseCurrency, theme }),
    })
    toast.success('Preferencias guardadas')
    mutate()
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold">Ajustes</h1>

      <Card>
        <CardHeader><CardTitle>Perfil</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile?.email || ''} disabled />
          </div>
          <Button onClick={saveProfile}>Guardar perfil</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Preferencias</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Moneda base</Label>
            <Select value={baseCurrency} onValueChange={setBaseCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MXN">MXN</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tema</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro</SelectItem>
                <SelectItem value="dark">Oscuro</SelectItem>
                <SelectItem value="system">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={savePreferences}>Guardar preferencias</Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/market/ src/app/\(app\)/watchlist/ src/app/\(app\)/settings/ src/components/market/price-chart.tsx
git commit -m "feat: add market, watchlist, and settings pages"
```

---

## Chunk 4: Landing Page + Deploy

### Task 20: Landing Page

**Files:**
- Create: `src/app/page.tsx`

- [ ] **Step 1: Create landing page**

```tsx
// src/app/page.tsx
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { TrendingUp, PieChart, Zap } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b">
        <span className="font-bold text-xl">InvestTracker</span>
        <div className="flex gap-3">
          <Link href="/login"><Button variant="ghost">Iniciar Sesión</Button></Link>
          <Link href="/register"><Button>Crear Cuenta</Button></Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center py-20 px-6">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Tu portafolio de inversión,<br />
          <span className="text-primary">profesional y en tiempo real</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Trackea acciones, ETFs, crypto, CETES, forex y commodities en una sola plataforma.
          Analytics avanzados, multi-moneda, y diseño que te da control total.
        </p>
        <Link href="/register">
          <Button size="lg" className="text-lg px-8 py-6">
            Crea tu cuenta gratis
          </Button>
        </Link>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Multi-Activo</h3>
            <p className="text-sm text-muted-foreground">
              Acciones, ETFs, crypto, CETES, bonos, forex y commodities. Todo en un solo dashboard.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <PieChart className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Analytics Avanzados</h3>
            <p className="text-sm text-muted-foreground">
              Rendimiento, distribución, riesgo, correlaciones y comparación con benchmarks.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Datos en Tiempo Real</h3>
            <p className="text-sm text-muted-foreground">
              Precios actualizados desde múltiples fuentes. Multi-moneda con tipos de cambio de Banxico.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>InvestTracker — Hecho con Next.js, Supabase y Cloudflare</p>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add landing page with hero, features, and CTA"
```

---

### Task 21: Analytics Page

**Files:**
- Create: `src/app/api/analytics/[pid]/performance/route.ts`
- Create: `src/app/api/analytics/[pid]/allocation/route.ts`
- Create: `src/app/(app)/portfolio/[id]/analytics/page.tsx`

- [ ] **Step 1: Create analytics API routes**

```typescript
// src/app/api/analytics/[pid]/performance/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get portfolio positions
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) return success([])

  // Get price history for all symbols
  const symbols = positions.map(p => p.symbol)
  const { data: history } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })

  return success({ positions, history: history || [] })
}
```

```typescript
// src/app/api/analytics/[pid]/allocation/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, asset_type, quantity, avg_cost, currency')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions) return success({ byType: [], bySymbol: [] })

  const byType: Record<string, number> = {}
  const bySymbol: Array<{ symbol: string; value: number; pct: number }> = []
  let total = 0

  for (const pos of positions) {
    const value = pos.quantity * pos.avg_cost
    total += value
    byType[pos.asset_type] = (byType[pos.asset_type] || 0) + value
    bySymbol.push({ symbol: pos.symbol, value, pct: 0 })
  }

  bySymbol.forEach(s => { s.pct = total > 0 ? (s.value / total) * 100 : 0 })

  return success({
    byType: Object.entries(byType).map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0 })),
    bySymbol: bySymbol.sort((a, b) => b.value - a.value),
  })
}
```

- [ ] **Step 2: Create analytics page**

```tsx
// src/app/(app)/portfolio/[id]/analytics/page.tsx
'use client'

import { use } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export default function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: allocation, isLoading: allocLoading } = useSWR(`/api/analytics/${id}/allocation`, fetcher)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary>
          {allocLoading ? <SkeletonChart /> : (
            <AllocationDonut data={allocation?.byType || []} />
          )}
        </ErrorBoundary>

        <ErrorBoundary>
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Por Activo</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {allocation?.bySymbol?.map((s: { symbol: string; pct: number }) => (
                  <div key={s.symbol} className="flex items-center justify-between">
                    <span className="font-mono text-sm">{s.symbol}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${s.pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{s.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
                {(!allocation?.bySymbol || allocation.bySymbol.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Agrega posiciones para ver el análisis</p>
                )}
              </div>
            </CardContent>
          </Card>
        </ErrorBoundary>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Métricas de Riesgo</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Las métricas de riesgo (volatilidad, Sharpe ratio, max drawdown) estarán disponibles cuando haya suficiente historial de precios.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/ src/app/\(app\)/portfolio/\[id\]/analytics/
git commit -m "feat: add analytics page with allocation breakdown and risk metrics placeholder"
```

---

### Task 22: Final Verification + Deploy

- [ ] **Step 1: Verify build succeeds**

```bash
npm run build
```
Expected: Build completes successfully.

- [ ] **Step 2: Fix any TypeScript / build errors**

Address each error reported by `next build`. Common issues:
- Missing imports
- Type mismatches
- Client/server component boundary issues

- [ ] **Step 3: Set up .env.local with real credentials**

Copy `.env.local.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY` from Supabase dashboard → Settings → API
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from Upstash console
- `NEXT_PUBLIC_APP_URL=http://localhost:3000` (will change to Vercel URL after deploy)

- [ ] **Step 4: Run the Supabase migration**

Go to Supabase Dashboard → SQL Editor → paste contents of `supabase/migrations/001_initial_schema.sql` → Run.

- [ ] **Step 5: Test full flow locally**

```bash
npm run dev
```
1. Register a new account
2. Create a portfolio
3. Add a buy transaction (e.g., AAPL, 10 shares at $200)
4. Verify position appears in portfolio detail
5. Search for a symbol in market page
6. Toggle dark/light mode
7. Change currency

- [ ] **Step 6: Deploy to Vercel**

```bash
npx vercel --yes
```

Or connect the GitHub repo to Vercel dashboard. Set environment variables in Vercel project settings.

- [ ] **Step 7: Update NEXT_PUBLIC_APP_URL**

After deploy, update `NEXT_PUBLIC_APP_URL` in Vercel env vars to the production URL.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: investment portfolio platform v1 — ready for deployment"
```

---

## Chunk 5: Cloudflare Worker (Price Engine)

> This chunk can be developed in parallel or after the main app is deployed. The app works without it — it just fetches prices directly from Yahoo Finance via API routes.

### Task 23: Worker Scaffolding

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.toml`
- Create: `worker/tsconfig.json`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Initialize worker project**

```bash
cd /c/Users/ponye/Projects/investment-portfolio
mkdir -p worker/src/fetchers worker/src/services worker/src/lib
```

```json
// worker/package.json
{
  "name": "price-engine",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2"
  },
  "devDependencies": {
    "wrangler": "^3",
    "@cloudflare/workers-types": "^4",
    "typescript": "^5"
  }
}
```

```toml
# worker/wrangler.toml
name = "price-engine"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[triggers]
crons = [
  "*/5 * * * *",
  "*/30 * * * *",
  "0 */12 * * *",
  "0 22 * * 1-5"
]

[[kv_namespaces]]
binding = "PRICE_CACHE"
id = ""  # Fill after creating KV namespace

[vars]
SUPABASE_URL = ""

# Secrets (set via wrangler secret put):
# SUPABASE_SERVICE_ROLE_KEY
# ALPHA_VANTAGE_API_KEY
# BANXICO_TOKEN
```

- [ ] **Step 2: Create worker entry point**

```typescript
// worker/src/index.ts
import { createClient } from '@supabase/supabase-js'

export interface Env {
  PRICE_CACHE: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ALPHA_VANTAGE_API_KEY: string
  BANXICO_TOKEN: string
  COINGECKO_API_KEY?: string
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    switch (event.cron) {
      case '*/5 * * * *':
        // Fetch hot symbols (open positions) + crypto
        ctx.waitUntil(fetchHotPrices(supabase, env))
        ctx.waitUntil(fetchCryptoPrices(supabase, env))
        break
      case '*/30 * * * *':
        // Fetch warm symbols (watchlists, not already hot)
        ctx.waitUntil(fetchWarmPrices(supabase, env))
        break
      case '0 */12 * * *':
        // Fetch Banxico data (exchange rates)
        ctx.waitUntil(fetchBanxico(supabase, env))
        break
      case '0 22 * * 1-5':
        // Build daily history from current prices
        ctx.waitUntil(buildHistory(supabase, env))
        break
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response('Price Engine Worker is running', { status: 200 })
  },
}

async function fetchHotPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // 1. Get hot symbols (positions with quantity > 0)
  const { data: hotSymbols } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)

  if (!hotSymbols || hotSymbols.length === 0) return

  const symbols = [...new Set(hotSymbols.map(s => s.symbol))]

  // 2. Fetch from Yahoo Finance in batches
  for (const symbol of symbols) {
    try {
      const cached = await env.PRICE_CACHE.get(`price:${symbol}`)
      if (cached) continue // Still fresh

      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
      )
      if (!res.ok) continue
      const data = await res.json()
      const meta = data.chart?.result?.[0]?.meta
      if (!meta) continue

      const price = {
        symbol: meta.symbol,
        exchange: meta.exchangeName || 'US',
        price: meta.regularMarketPrice,
        change_pct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
        volume: meta.regularMarketVolume || 0,
        currency: meta.currency || 'USD',
        source: 'yahoo',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }

      // Write to KV (5 min TTL)
      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 300 })

      // Write to Supabase
      await supabase
        .from('current_prices')
        .upsert(price, { onConflict: 'symbol,exchange' })

      // Check alerts for this symbol
      const { data: alerts } = await supabase
        .from('alerts')
        .select('*')
        .eq('symbol', symbol)
        .eq('is_active', true)

      if (alerts) {
        for (const alert of alerts) {
          let triggered = false
          if (alert.condition === 'above' && price.price >= alert.target_value) triggered = true
          if (alert.condition === 'below' && price.price <= alert.target_value) triggered = true
          if (alert.condition === 'pct_change_daily' && Math.abs(price.change_pct) >= alert.target_value) triggered = true

          if (triggered) {
            await supabase
              .from('alerts')
              .update({ triggered_at: new Date().toISOString(), is_active: false })
              .eq('id', alert.id)
          }
        }
      }
    } catch (e) {
      // Log failed fetch
      await supabase.from('failed_fetches').insert({
        symbol, source: 'yahoo', error: String(e),
      })
    }
  }
}

async function fetchWarmPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get hot symbols to exclude
  const { data: hotSymbols } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)
  const hotSet = new Set((hotSymbols || []).map(s => s.symbol))

  // Get warm symbols (in watchlists but not in positions)
  const { data: watchlistItems } = await supabase
    .from('watchlist_items')
    .select('symbol')
  if (!watchlistItems) return

  const warmSymbols = [...new Set(watchlistItems.map(w => w.symbol))].filter(s => !hotSet.has(s))

  for (const symbol of warmSymbols) {
    try {
      const cached = await env.PRICE_CACHE.get(`price:${symbol}`)
      if (cached) continue

      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
      )
      if (!res.ok) continue
      const data = await res.json()
      const meta = data.chart?.result?.[0]?.meta
      if (!meta) continue

      const price = {
        symbol: meta.symbol,
        exchange: meta.exchangeName || 'US',
        price: meta.regularMarketPrice,
        change_pct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
        volume: meta.regularMarketVolume || 0,
        currency: meta.currency || 'USD',
        source: 'yahoo',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }

      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 1800 })
      await supabase.from('current_prices').upsert(price, { onConflict: 'symbol,exchange' })
    } catch (e) {
      await supabase.from('failed_fetches').insert({ symbol, source: 'yahoo', error: String(e) })
    }
  }
}

async function fetchCryptoPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get crypto symbols from positions and watchlists
  const { data: cryptoPositions } = await supabase
    .from('positions')
    .select('symbol')
    .eq('asset_type', 'crypto')
    .gt('quantity', 0)

  if (!cryptoPositions || cryptoPositions.length === 0) return

  const symbols = [...new Set(cryptoPositions.map(s => s.symbol.toLowerCase()))]

  try {
    // CoinGecko supports comma-separated ids
    const ids = symbols.join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    )
    if (!res.ok) return
    const data = await res.json()

    for (const [id, info] of Object.entries(data) as [string, any][]) {
      const symbol = id.toUpperCase()
      const price = {
        symbol,
        exchange: 'CRYPTO',
        price: info.usd,
        change_pct: info.usd_24h_change || 0,
        volume: Math.round(info.usd_24h_vol || 0),
        currency: 'USD',
        source: 'coingecko',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }

      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 300 })
      await supabase.from('current_prices').upsert(price, { onConflict: 'symbol,exchange' })
    }
  } catch (e) {
    await supabase.from('failed_fetches').insert({ symbol: 'CRYPTO_BATCH', source: 'coingecko', error: String(e) })
  }
}

async function fetchBanxico(supabase: ReturnType<typeof createClient>, env: Env) {
  try {
    // Fetch USD/MXN exchange rate from Banxico
    const res = await fetch('https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno', {
      headers: { 'Bmx-Token': env.BANXICO_TOKEN },
    })
    if (!res.ok) return
    const data = await res.json()
    const rate = data?.bmx?.series?.[0]?.datos?.[0]?.dato
    if (!rate) return

    await env.PRICE_CACHE.put('fx:USDMXN', rate, { expirationTtl: 43200 })
  } catch (e) {
    await supabase.from('failed_fetches').insert({
      symbol: 'USDMXN', source: 'banxico', error: String(e),
    })
  }
}

async function buildHistory(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get all current prices and insert into history
  const { data: prices } = await supabase.from('current_prices').select('*')
  if (!prices) return

  const today = new Date().toISOString().split('T')[0]

  for (const p of prices) {
    await supabase.from('price_history').upsert({
      symbol: p.symbol,
      exchange: p.exchange,
      date: today,
      close: p.price,
      volume: p.volume,
    }, { onConflict: 'symbol,exchange,date' })
  }
}
```

- [ ] **Step 3: Install worker deps and verify**

```bash
cd /c/Users/ponye/Projects/investment-portfolio/worker && npm install
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/ponye/Projects/investment-portfolio
git add worker/
git commit -m "feat: add Cloudflare Worker price engine with Yahoo Finance, Banxico, and alert evaluation"
```

- [ ] **Step 5: Deploy worker (when ready)**

```bash
cd worker
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put BANXICO_TOKEN
npx wrangler secret put ALPHA_VANTAGE_API_KEY
npx wrangler deploy
```

---

### Task 24: SymbolSearch (Cmd+K) Component

**Files:**
- Create: `src/components/market/symbol-search.tsx`
- Create: `src/lib/hooks/use-keyboard.ts`
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Create keyboard hook**

```typescript
// src/lib/hooks/use-keyboard.ts
'use client'

import { useEffect } from 'react'

type Shortcut = { key: string; meta?: boolean; ctrl?: boolean; handler: () => void }

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : true
        const ctrlMatch = s.ctrl ? e.ctrlKey : true
        if (e.key.toLowerCase() === s.key.toLowerCase() && metaMatch && ctrlMatch) {
          e.preventDefault()
          s.handler()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
```

- [ ] **Step 2: Create SymbolSearch command palette**

```tsx
// src/components/market/symbol-search.tsx
'use client'

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { Badge } from '@/components/ui/badge'

export function SymbolSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { data: results } = useMarketSearch(query)
  const router = useRouter()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function handleSelect(symbol: string) {
    setOpen(false)
    setQuery('')
    router.push(`/market/${encodeURIComponent(symbol)}`)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar acciones, ETFs, crypto..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>
        {results && results.length > 0 && (
          <CommandGroup heading="Resultados">
            {results.map((r: { symbol: string; name: string; type: string; exchDisp: string }) => (
              <CommandItem key={r.symbol} value={r.symbol} onSelect={() => handleSelect(r.symbol)}>
                <span className="font-mono font-medium">{r.symbol}</span>
                <span className="ml-2 text-muted-foreground truncate">{r.name}</span>
                <Badge variant="outline" className="ml-auto text-xs">{r.exchDisp}</Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
```

- [ ] **Step 3: Add SymbolSearch to app layout**

In `src/app/(app)/layout.tsx`, add `<SymbolSearch />` inside the CurrencyProvider, after `<MobileNav />`.

- [ ] **Step 4: Update header search button to open Cmd+K**

Replace the placeholder `onClick` in `src/components/layout/header.tsx` search button to use a global event: `onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}`

- [ ] **Step 5: Commit**

```bash
git add src/components/market/symbol-search.tsx src/lib/hooks/use-keyboard.ts
git commit -m "feat: add Cmd+K symbol search command palette and keyboard shortcuts"
```

---

### Task 25: Risk & Benchmark API Routes + Analytics Components

**Files:**
- Create: `src/app/api/analytics/[pid]/risk/route.ts`
- Create: `src/app/api/analytics/[pid]/benchmark/route.ts`
- Create: `src/components/analytics/risk-metrics.tsx`
- Create: `src/components/analytics/benchmark-chart.tsx`
- Create: `src/lib/services/analytics.ts`
- Modify: `src/app/(app)/portfolio/[id]/analytics/page.tsx`

- [ ] **Step 1: Create analytics service**

```typescript
// src/lib/services/analytics.ts

export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) // Annualized
}

export function calculateSharpeRatio(returns: number[], riskFreeRate: number): number {
  if (returns.length < 2) return 0
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualizedReturn = meanReturn * 252
  const volatility = calculateVolatility(returns)
  if (volatility === 0) return 0
  return (annualizedReturn - riskFreeRate) / volatility
}

export function calculateMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0
  let maxDrawdown = 0
  let peak = values[0]
  for (const value of values) {
    if (value > peak) peak = value
    const drawdown = (peak - value) / peak
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }
  return maxDrawdown * 100 // As percentage
}

export function calculateDailyReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }
  return returns
}
```

- [ ] **Step 2: Write tests for analytics**

```typescript
// tests/lib/analytics.test.ts
import { describe, it, expect } from 'vitest'
import { calculateVolatility, calculateSharpeRatio, calculateMaxDrawdown, calculateDailyReturns } from '@/lib/services/analytics'

describe('calculateDailyReturns', () => {
  it('calculates correct daily returns', () => {
    const returns = calculateDailyReturns([100, 105, 103])
    expect(returns[0]).toBeCloseTo(0.05)
    expect(returns[1]).toBeCloseTo(-0.019, 2)
  })
})

describe('calculateMaxDrawdown', () => {
  it('finds max drawdown', () => {
    const dd = calculateMaxDrawdown([100, 120, 90, 110])
    expect(dd).toBeCloseTo(25.0) // 120 -> 90 = 25%
  })
  it('returns 0 for monotonically increasing', () => {
    expect(calculateMaxDrawdown([100, 110, 120])).toBe(0)
  })
})

describe('calculateSharpeRatio', () => {
  it('returns 0 for insufficient data', () => {
    expect(calculateSharpeRatio([0.01], 0.05)).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/lib/analytics.test.ts
```
Expected: PASS

- [ ] **Step 4: Create risk API route**

```typescript
// src/app/api/analytics/[pid]/risk/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateSharpeRatio, calculateMaxDrawdown, calculateDailyReturns } from '@/lib/services/analytics'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get portfolio positions
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) {
    return success({ volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'No positions' })
  }

  // Get price history for portfolio value calculation
  const symbols = positions.map(p => p.symbol)
  const { data: history } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })
    .limit(365)

  if (!history || history.length < 10) {
    return success({ volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'Insufficient price history' })
  }

  // Calculate portfolio value per day
  const dateMap = new Map<string, number>()
  for (const h of history) {
    const pos = positions.find(p => p.symbol === h.symbol)
    if (!pos) continue
    const current = dateMap.get(h.date) || 0
    dateMap.set(h.date, current + pos.quantity * h.close)
  }

  const values = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1])
  const returns = calculateDailyReturns(values)

  // Use CETES 28-day rate as risk-free rate (approx 10% annual in MXN, ~5% USD)
  const riskFreeRate = 0.10

  return success({
    volatility: calculateVolatility(returns) * 100,
    sharpe: calculateSharpeRatio(returns, riskFreeRate),
    maxDrawdown: calculateMaxDrawdown(values),
    dataPoints: values.length,
  })
}
```

- [ ] **Step 5: Create benchmark API route**

```typescript
// src/app/api/analytics/[pid]/benchmark/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const vs = url.searchParams.get('vs') || 'SPY'
  const benchmarks = vs.split(',').slice(0, 3)

  const results: Record<string, Array<{ date: string; value: number }>> = {}

  for (const symbol of benchmarks) {
    const history = await getHistory(symbol.trim(), '1y')
    if (history.length > 0) {
      const base = history[0].close
      results[symbol.trim()] = history.map((h: { date: string; close: number }) => ({
        date: h.date,
        value: ((h.close - base) / base) * 100,
      }))
    }
  }

  return success(results)
}
```

- [ ] **Step 6: Create risk metrics component**

```tsx
// src/components/analytics/risk-metrics.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/utils/numbers'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function RiskMetrics({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR(`/api/analytics/${portfolioId}/risk`, fetcher)

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Calculando...</CardContent></Card>

  if (data?.message) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">{data.message}</CardContent></Card>
  }

  const metrics = [
    { label: 'Volatilidad (anual)', value: `${formatNumber(data?.volatility || 0)}%`, description: 'Desviación estándar anualizada' },
    { label: 'Sharpe Ratio', value: formatNumber(data?.sharpe || 0), description: 'Rendimiento ajustado por riesgo (rf = CETES 28d)' },
    { label: 'Max Drawdown', value: `${formatNumber(data?.maxDrawdown || 0)}%`, description: 'Mayor caída desde el pico' },
  ]

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium">Métricas de Riesgo</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {metrics.map(m => (
            <div key={m.label} className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold font-mono">{m.value}</p>
              <p className="text-sm font-medium mt-1">{m.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7: Create benchmark chart component**

```tsx
// src/components/analytics/benchmark-chart.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444']

export function BenchmarkChart({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR(`/api/analytics/${portfolioId}/benchmark?vs=SPY,EWW`, fetcher)

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando benchmarks...</CardContent></Card>
  if (!data || Object.keys(data).length === 0) return null

  const benchmarks = Object.keys(data)
  const chartData = data[benchmarks[0]]?.map((_: unknown, i: number) => {
    const point: Record<string, unknown> = { date: data[benchmarks[0]][i].date }
    benchmarks.forEach(b => { point[b] = data[b]?.[i]?.value })
    return point
  }) || []

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium">vs Benchmarks (%)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Legend />
            {benchmarks.map((b, i) => (
              <Line key={b} type="monotone" dataKey={b} stroke={COLORS[i]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 8: Update analytics page to use new components**

Replace the risk metrics placeholder in `src/app/(app)/portfolio/[id]/analytics/page.tsx`:

```tsx
// Add imports:
import { RiskMetrics } from '@/components/analytics/risk-metrics'
import { BenchmarkChart } from '@/components/analytics/benchmark-chart'

// Replace the placeholder Card with:
<ErrorBoundary>
  <RiskMetrics portfolioId={id} />
</ErrorBoundary>

<ErrorBoundary>
  <BenchmarkChart portfolioId={id} />
</ErrorBoundary>
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/analytics.ts tests/lib/analytics.test.ts src/app/api/analytics/ src/components/analytics/
git commit -m "feat: add risk metrics (volatility, Sharpe, drawdown) and benchmark comparison"
```

---

### Task 26: Market Page — Add to Portfolio/Watchlist Buttons

**Files:**
- Modify: `src/app/(app)/market/[symbol]/page.tsx`

- [ ] **Step 1: Update symbol detail page with action buttons**

Add to the market symbol detail page (`src/app/(app)/market/[symbol]/page.tsx`) after the PriceDisplay:

```tsx
// Add these imports:
import { Button } from '@/components/ui/button'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

// Inside the component, add:
const { data: portfolios } = usePortfolios()
const { data: watchlists } = useWatchlists()
const { mutate } = useSWRConfig()

async function addToWatchlist(watchlistId: string) {
  const res = await fetch(`/api/watchlist/${watchlistId}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: decodedSymbol, asset_type: 'stock' }),
  })
  const data = await res.json()
  if (data.error) toast.error(data.error)
  else { toast.success('Agregado a watchlist'); mutate('/api/watchlist') }
}

// Add buttons after PriceDisplay:
<div className="flex gap-2 mt-4">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Agregar a Portafolio</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      {portfolios?.map((p: { id: string; name: string }) => (
        <DropdownMenuItem key={p.id} onClick={() => router.push(`/portfolio/${p.id}`)}>
          {p.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>

  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm"><Eye className="h-4 w-4 mr-1" /> Agregar a Watchlist</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      {watchlists?.map((wl: { id: string; name: string }) => (
        <DropdownMenuItem key={wl.id} onClick={() => addToWatchlist(wl.id)}>
          {wl.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/market/
git commit -m "feat: add 'Add to Portfolio' and 'Add to Watchlist' buttons on market detail page"
```

---

## Summary

**26 tasks** organized in 5 chunks:

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-8 | Scaffolding, DB schema, auth, middleware, schemas, utils |
| 2: Core Features | 9-14 | Portfolio/transaction/market/watchlist/alert API routes + SWR hooks |
| 3: Frontend | 15-19 | App shell, dashboard, all pages with charts and components |
| 4: Landing + Deploy | 20-22 | Landing page, analytics stubs, build verification, Vercel deploy |
| 5: Worker + Missing | 23-26 | Price engine, Cmd+K search, full analytics, market actions |

**Critical path to deployment:** Chunks 1-4 (Tasks 1-22).
**Chunk 5** can be developed in parallel or after deploy — the app works without it.

**23 tasks** organized in 5 chunks:

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-8 | Scaffolding, DB schema, auth, middleware, schemas, utils |
| 2: Core Features | 9-14 | Portfolio/transaction/market/watchlist/alert API routes + SWR hooks |
| 3: Frontend | 15-19 | App shell, dashboard, all pages with charts and components |
| 4: Landing + Deploy | 20-22 | Landing page, analytics, build verification, Vercel deploy |
| 5: Worker | 23 | Cloudflare price engine (can be parallel) |

**Critical path to deployment:** Chunks 1-4 (Tasks 1-22).
**Worker (Chunk 5)** can be deployed separately — the app works without it by fetching prices directly from Yahoo Finance in API routes.
