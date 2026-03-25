# Visual Overhaul + Data Enrichment — Design Spec

## Overview

Complete visual redesign of the investment portfolio platform, transitioning from a dark theme to a warm cream/beige palette, enriching data with BigData MCP integration, and adding missing features (alerts, GBM+ import, exports). The goal is a premium financial app experience inspired by Google Finance (data-rich) and Fintual/GBM+ (clean, modern).

**User:** Intermediate investor using GBM+, wants things to "just work."
**Approach:** Phase A — Visual polish first, then data enrichment, then automation.

---

## Phase 1: Visual Overhaul

### 1.1 Color Palette — shadcn/ui Token Migration

The app uses **shadcn/ui's token system** with OKLch values in `globals.css`. The `:root` block defines tokens like `--background`, `--foreground`, `--card`, `--primary`, etc., which are mapped to Tailwind utilities via the `@theme inline` block (e.g., `bg-background`, `text-foreground`, `bg-card`). All shadcn components consume these tokens.

**Migration strategy:** Replace the OKLch values in `:root` with hex equivalents from the warm palette. Keep the same token names so all shadcn components automatically pick up the new colors. Add custom tokens for app-specific needs (gain/loss, chart, shimmer).

**`:root` block replacement (light mode default):**

| shadcn Token | New Value | Warm Palette Role |
|---|---|---|
| `--background` | `#FEFCF8` | Cream main background |
| `--foreground` | `#1C1917` | Dark brown text |
| `--card` | `#FFFDF7` | Warm white cards |
| `--card-foreground` | `#1C1917` | Card text |
| `--popover` | `#FFFDF7` | Popover background |
| `--popover-foreground` | `#1C1917` | Popover text |
| `--primary` | `#B45309` | Amber/gold accent (CTAs, highlights) |
| `--primary-foreground` | `#FFFDF7` | Text on primary buttons |
| `--secondary` | `#F5F0E8` | Beige secondary surfaces |
| `--secondary-foreground` | `#1C1917` | Text on secondary |
| `--muted` | `#F5F0E8` | Muted backgrounds |
| `--muted-foreground` | `#78716C` | Secondary text |
| `--accent` | `#F5F0E8` | Accent backgrounds |
| `--accent-foreground` | `#1C1917` | Accent text |
| `--destructive` | `#C2410C` | Warm terracotta for errors/losses |
| `--border` | `#E8E0D0` | Sand borders |
| `--input` | `#E8E0D0` | Input borders |
| `--ring` | `#D97706` | Focus ring (amber) |
| `--chart-1` | `#D97706` | Chart primary (amber) |
| `--chart-2` | `#4D7C0F` | Chart secondary (olive green) |
| `--chart-3` | `#B45309` | Chart tertiary |
| `--chart-4` | `#78716C` | Chart quaternary |
| `--chart-5` | `#C2410C` | Chart quinary |
| `--radius` | `0.75rem` | Slightly larger radius (was 0.625rem) |
| `--sidebar` | `#F5F0E8` | Sidebar background |
| `--sidebar-foreground` | `#1C1917` | Sidebar text |
| `--sidebar-primary` | `#B45309` | Sidebar active accent |
| `--sidebar-primary-foreground` | `#FFFDF7` | Sidebar active text |
| `--sidebar-accent` | `#FEFCF8` | Sidebar hover |
| `--sidebar-accent-foreground` | `#1C1917` | Sidebar hover text |
| `--sidebar-border` | `#E8E0D0` | Sidebar borders |
| `--sidebar-ring` | `#D97706` | Sidebar focus ring |

**Custom tokens (add after shadcn tokens in `:root`):**

| Token | Value | Usage |
|---|---|---|
| `--gain` | `#4D7C0F` | Positive values (olive green) |
| `--loss` | `#C2410C` | Negative values (terracotta) |
| `--chart-line` | `#D97706` | Chart stroke color |
| `--chart-fill-start` | `rgba(217,119,6,0.15)` | Chart gradient fill top |
| `--chart-fill-end` | `rgba(217,119,6,0)` | Chart gradient fill bottom |
| `--shimmer` | `#F5F0E8` | Skeleton loader pulse color |
| `--gradient-hero-start` | `#FEFCF8` | Hero gradient start |
| `--gradient-hero-end` | `#FEF3E2` | Hero gradient end |

**`.dark` block replacement (warm dark variant):**

| shadcn Token | New Value |
|---|---|
| `--background` | `#1C1917` |
| `--foreground` | `#FEFCF8` |
| `--card` | `#292524` |
| `--card-foreground` | `#FEFCF8` |
| `--popover` | `#292524` |
| `--popover-foreground` | `#FEFCF8` |
| `--primary` | `#D97706` |
| `--primary-foreground` | `#1C1917` |
| `--secondary` | `#292524` |
| `--secondary-foreground` | `#FEFCF8` |
| `--muted` | `#292524` |
| `--muted-foreground` | `#A8A29E` |
| `--accent` | `#292524` |
| `--accent-foreground` | `#FEFCF8` |
| `--destructive` | `#EF4444` |
| `--border` | `#44403C` |
| `--input` | `#44403C` |
| `--ring` | `#D97706` |

**Files affected:**
- `src/app/globals.css` — replace OKLch values in `:root` and `.dark` blocks, add custom tokens
- All components using hardcoded colors (e.g., `#2563eb` in charts) — replace with `var(--chart-line)` or Tailwind `text-primary`
- Note: `@base-ui/react` is in dependencies but does not consume theme tokens (it's used for unstyled primitives). No action needed for it.

### 1.2 Typography & Spacing

- Font: Inter (already used via Next.js)
- Title sizes increased: `text-3xl` for page titles (currently `text-2xl`)
- More vertical spacing between sections: `space-y-8` default (currently `space-y-6`)
- Card border radius: `rounded-2xl` (16px) — currently `rounded-xl` (12px)
- Shadows: Warm-tinted, subtle: `shadow-[0_1px_3px_rgba(28,25,23,0.06)]`

### 1.3 Landing Page

**File:** `src/app/page.tsx` (full rewrite)

**Structure:**
1. **Navbar:** Logo left, "Iniciar sesion" + "Registrarse" right, cream background
2. **Hero section:**
   - Gradient background (`--gradient-hero-start` to `--gradient-hero-end`)
   - H1: "Tu portafolio de inversiones, en un solo lugar"
   - Subtitle: "Rastrea tus inversiones de GBM+, analiza mercados en tiempo real, y toma mejores decisiones."
   - Two CTAs: "Empezar gratis" (accent primary, solid) + "Ver mercados" (outline)
   - Animated dashboard mockup below — card showing portfolio value with `@number-flow/react` animating price changes
3. **Features grid (2x2):**
   - Mercados en vivo (TrendingUp icon)
   - Analisis inteligente (BarChart3 icon)
   - Alertas personalizadas (Bell icon)
   - Multi-moneda (Globe icon)
   - Each: icon + title + 1-line description, card with warm shadow
4. **Integration section:** "Importa desde GBM+" with CSV icon, "Mercados soportados" with BMV/NYSE/NASDAQ labels
5. **Footer:** Minimal — "Hecho en Mexico" + links

**No new dependencies.** Uses `@number-flow/react` (installed), Lucide icons (installed), Tailwind only.

### 1.4 Dashboard Redesign

**File:** `src/app/(app)/dashboard/page.tsx` + components in `src/components/dashboard/`

**Layout (top to bottom):**

1. **KPI Cards row** (4 columns desktop, 2 mobile):
   - Valor Total — animated with `@number-flow/react`, sparkline 7D
   - Ganancia Hoy — absolute + %, green/red colored
   - Ganancia Total — since inception
   - Mejor Posicion — top performing holding name + %
   - Each card: `rounded-2xl`, warm shadow, hover lift (`hover:-translate-y-0.5 transition-transform`)

2. **Middle row** (2/3 + 1/3 split):
   - Left: Performance chart (AreaChart, amber gradient, period pills as rounded tabs)
   - Right: Allocation donut (recolored to warm palette)

3. **Bottom row** (1/2 + 1/2):
   - Left: Top movers (3 cards, sparkline + %)
   - Right: Actividad reciente (new) — last 5 transactions as mini-feed
     - Format: "Compraste 10 AAPL a $248.50" with relative timestamp
     - Source: `/api/transaction?limit=5` — the current GET handler in `src/app/api/transaction/route.ts` does NOT support a `limit` param; this must be added as a backend task
     - Link: "Ver todas" → portfolio transactions page

**New component:** `src/components/dashboard/recent-activity.tsx`

**Modified components:**
- `kpi-cards.tsx` — add sparklines, `@number-flow/react` animation, new "best position" card
- `portfolio-chart.tsx` — warm colors, improved tooltip, crosshair cursor
- `allocation-donut.tsx` — warm color palette
- `top-movers.tsx` — add sparkline per mover

### 1.5 Navigation Redesign

**Note:** There is no `src/components/layout/` directory currently. The sidebar is part of the app layout (likely in `src/app/(app)/layout.tsx`). Navigation components will be created fresh.

**Sidebar** (restyle existing sidebar in app layout):
- Cleaner look: cream background (`bg-sidebar`), icons + labels
- Active state: pill with beige background + accent left border
- Notification badge on Alerts icon (red dot with count)
- 6 items: Dashboard, Mercados, Portfolio, Watchlists, Alertas, Settings

**Mobile bottom tab bar** (new component: `src/components/layout/mobile-nav.tsx`):
- Fixed bottom bar on screens < md
- 5 tabs: Dashboard, Mercados, Portfolio, Watchlists, Alertas
- Settings accessible from a gear icon in the top navbar on mobile
- Active tab: accent colored icon + label
- Replaces hamburger menu on mobile

**Breadcrumbs** (new component: `src/components/shared/breadcrumbs.tsx`):
- Auto-generated from route segments
- Shows on nested pages: Portfolio > AAPL > Transacciones

### 1.6 Market Page Redesign

**Market listing** (`src/app/(app)/market/page.tsx`):
- Large search bar at top, centered, with autocomplete dropdown
- Sections:
  - "Tus activos" — symbols from user's portfolios, always first
  - "Indices" — S&P 500 (^GSPC), IPC (^MXX), NASDAQ (^IXIC) as horizontal scrollable cards with sparkline
  - "Tendencias" — top gainers / losers
- Cards: Logo placeholder (first letter badge) + name + price + sparkline 1D + change badge

**Market detail** (`src/app/(app)/market/[symbol]/page.tsx`):
- Header: Letter badge + name + price (large, animated) + change badge
- Chart: Same improved chart component as dashboard
- Fundamentals grid (new, data from BigData MCP in Phase 2):
  - P/E, Market Cap, Volume, 52-week High/Low, Dividend Yield
  - Sector, Industry
- Company description (Phase 2)
- Event calendar (Phase 2)
- Action buttons: "Agregar a watchlist" + "Registrar transaccion"

### 1.7 Portfolio Pages Polish

**Portfolio list** (`src/app/(app)/portfolio/page.tsx`):
- Larger cards with mini-donut, sparkline 7D, animated total value
- Gain/loss prominent with warm colors
- Hover: reveal quick action buttons

**Portfolio detail** (`src/app/(app)/portfolio/[id]/page.tsx`):
- Header: Name + total + gains
- Tabs component replacing separate buttons: Posiciones | Transacciones | Analytics
- Positions table: letter badge per symbol, sparkline column, allocation bar (visual % width)

**Transactions** (`src/app/(app)/portfolio/[id]/transactions/page.tsx`):
- Monthly summary card at top: "En marzo: X compras, Y ventas, $Z invertido"
- Timeline view alternative (toggle): vertical timeline with transaction cards

### 1.8 Watchlist Polish

**Watchlist page** (`src/app/(app)/watchlist/page.tsx`):
- Items show: sparkline 1D, volume bar, day range (visual min/max bar)
- Toggle compact/expanded view
- Compare mode: select 2-3 assets, see overlay chart

### 1.9 Settings Page

**Settings** (`src/app/(app)/settings/page.tsx`):
- Profile section: name, email, avatar placeholder
- Preferences: currency, theme (claro/oscuro calido), language
- Import/Export and Connections sections are **out of scope for Phase 1** — they will be added in Phase 3 when the features are built. No stub UI needed.

### 1.10 Skeleton Loaders

- Warm shimmer effect (beige pulse instead of gray)
- Shape-accurate: skeletons match real component dimensions
- Applied to all pages with data fetching

---

## Phase 2: Data Enrichment

### 2.1 BigData MCP Integration

Use the connected BigData MCP tools to enrich market data:

- `bigdata_company_tearsheet` — company fundamentals, description, financials
- `bigdata_search` — enhanced search with company details
- `bigdata_events_calendar` — earnings, dividends, splits calendar
- `bigdata_market_tearsheet` — market overview data

**New API endpoints:**
- `GET /api/market/[symbol]/fundamentals` — fetches and caches BigData tearsheet
- `GET /api/market/[symbol]/events` — upcoming events from BigData calendar
- `GET /api/market/overview` — market overview (indices, top movers from BigData)

**Cache strategy:** Store BigData responses in new Supabase tables with TTL enforcement.

**New table `company_data`:**

| Column | Type | Description |
|---|---|---|
| `symbol` | `text` PK | Ticker symbol |
| `name` | `text` | Company name |
| `description` | `text` | Company description |
| `sector` | `text` | Sector |
| `industry` | `text` | Industry |
| `market_cap` | `bigint` | Market capitalization |
| `pe_ratio` | `numeric` | P/E ratio |
| `eps` | `numeric` | Earnings per share |
| `dividend_yield` | `numeric` | Dividend yield % |
| `week52_high` | `numeric` | 52-week high |
| `week52_low` | `numeric` | 52-week low |
| `employees` | `integer` | Number of employees |
| `ceo` | `text` | CEO name |
| `hq` | `text` | Headquarters |
| `competitors` | `jsonb` | Array of competitor symbols |
| `raw_data` | `jsonb` | Full BigData response for future use |
| `fetched_at` | `timestamptz` | When data was fetched |
| `expires_at` | `timestamptz` | Cache expiry (fetched_at + 24 hours) |

**New table `market_events`:**

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | Event ID |
| `symbol` | `text` | Ticker symbol |
| `event_type` | `text` | earnings, dividend, split, etc. |
| `event_date` | `date` | Event date |
| `description` | `text` | Event description |
| `fetched_at` | `timestamptz` | When data was fetched |
| `expires_at` | `timestamptz` | Cache expiry (fetched_at + 6 hours) |

Both tables: RLS enabled, read access for authenticated users. TTL enforced by API checking `expires_at > now()` before serving cached data.

### 2.2 Enhanced Market Detail Page

With BigData data, the market detail page gets:
- Fundamentals grid: P/E, Market Cap, EPS, Revenue, 52W range
- "Sobre la empresa" expandable section: description, CEO, employees, HQ, sector
- Competitors: list of companies in same sector with price comparison
- Events timeline: next earnings date, dividend date, etc.

### 2.3 Market Overview Page

Redesigned market landing with BigData data:
- Market indices with real-time sparklines
- Sector heatmap or sector performance bars
- Economic calendar preview (next 7 days)
- "Noticias" section placeholder (BigData may provide, or use RSS)

---

## Phase 3: Automation & Features

### 3.1 GBM+ CSV Importer

**New page:** `/portfolio/[id]/import`
**New API:** `POST /api/portfolio/[id]/import`

Flow:
1. User clicks "Importar desde GBM+" on portfolio detail
2. Drag & drop or file picker for CSV/Excel file
3. Client-side parsing (no file upload to server — privacy):
   - Parse CSV columns: Fecha, Tipo, Emisora, Serie, Cantidad, Precio, Importe
   - Map to our transaction schema
4. Preview table: show parsed transactions with validation status
5. User confirms → batch POST to create transactions
6. Position recalculation happens server-side

**Parser:** Client-side JavaScript, no new dependencies (CSV is simple). Handles GBM+ export format specifically.

### 3.2 Alert System

**Existing tables:**
- `alerts` table exists with columns: id, user_id, symbol, condition, threshold, is_active, last_triggered_at. **Verify before implementation** — check actual schema matches these assumptions.

**New table `alert_notifications`:**

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` PK | Notification ID |
| `alert_id` | `uuid` FK | Reference to alerts table |
| `user_id` | `uuid` FK | User who owns the alert |
| `symbol` | `text` | Ticker symbol |
| `message` | `text` | Human-readable notification text |
| `triggered_at` | `timestamptz` | When the alert fired |
| `read_at` | `timestamptz` | Null until user reads it |

**New components:**
- `src/app/(app)/alerts/page.tsx` — alert management page
- `src/components/alerts/create-alert-modal.tsx` — create/edit alert form
- `src/components/layout/notification-bell.tsx` — navbar notification badge + dropdown

**Existing API endpoints (verify contracts before use):**
- `POST /api/alerts` — create alert
- `GET /api/alerts` — list user's alerts
- `PATCH /api/alerts/[id]` — exists, verify if toggle/edit is supported (note: actual handler uses PATCH, not PUT)

**New API endpoints:**
- `GET /api/alerts/triggered` — recent unread notifications from `alert_notifications` table

**Notification delivery:**
- In-app: Poll `/api/alerts/triggered` every 60s with SWR, show badge count on bell icon
- Email: Supabase Edge Function triggered by cron

**Cron job: Supabase Edge Function** (chosen over Scheduled Tasks MCP because it runs server-side without depending on any local machine, is deployable via Supabase CLI, and integrates natively with the existing Supabase auth/database):
1. Runs every 5 minutes via `pg_cron` or Supabase Edge Function scheduled invocation
2. Fetch all active alerts from `alerts` table
3. Batch fetch current prices for alert symbols via Yahoo Finance
4. Compare against thresholds
5. Insert into `alert_notifications` for matching alerts
6. Update `last_triggered_at` on the alert
7. Send email via Supabase Auth email if user has email notifications enabled

### 3.3 Export

- **CSV export:** Native JavaScript — generate CSV string client-side, trigger download via Blob URL. No dependency.
- **Excel export:** Use `xlsx` package (~200KB) for .xlsx generation client-side.
- **PDF export:** Use `@react-pdf/renderer` for client-side PDF generation — chosen over server-side because it avoids headless browser complexity on Vercel, works offline, and the data is already available in the client.
- **New dependency:** `xlsx` (Phase 3 only), `@react-pdf/renderer` (Phase 3 only)
- Exportable: portfolio summary, transaction history, performance report

**New components:**
- `src/components/shared/export-menu.tsx` — dropdown with format options (CSV, Excel, PDF)
- Used on: portfolio detail page, transactions page

---

## Technical Decisions

### State Management
No changes — SWR continues to handle all server state. No need for Redux/Zustand for this scope.

### New Dependencies (minimal)
- Phase 1: None — everything uses existing deps (`@number-flow/react`, `recharts`, `lucide-react`, `tailwind`)
- Phase 3 import: None — client-side CSV parsing with native JS
- Phase 3 export: `xlsx` package for Excel generation (~200KB), `@react-pdf/renderer` for PDF generation

### API Caching Strategy
- Yahoo Finance quotes: 30s (current, keep)
- Yahoo Finance history: stored in `price_history` table (current, keep)
- Exchange rates: 1 hour (current, keep)
- BigData tearsheets: 24 hours in new `company_data` table
- BigData events: 6 hours in new `market_events` table

### Mobile Responsiveness
Every component must work on 375px+ width. Specific adaptations:
- KPI cards: 2 columns on mobile
- Tables: card view on mobile (existing pattern, polish)
- Charts: full width, reduced height
- Bottom tab bar instead of sidebar

### Performance Budget
- No new pages should add more than 50KB JS (gzipped)
- Charts lazy-loaded where not immediately visible
- BigData calls never block page render — show skeleton, load async

---

## Out of Scope

- Real-time WebSocket connections (polling with SWR is sufficient)
- AI-powered investment recommendations (legal/compliance risk)
- Social features / community (Phase 2 of the larger roadmap, not this spec)
- Broker API integration (GBM+ has no public API)
- Native mobile app (responsive web is sufficient)

---

## Implementation Order

### Phase 1: Visual Overhaul
1. **Theme + globals** — CSS variables (shadcn token migration), typography, spacing
2. **Navigation** — sidebar restyle + new mobile bottom nav + breadcrumbs
3. **Landing page** — full rewrite with hero, features, footer
4. **Dashboard** — KPI cards + chart + donut + recent activity (includes adding `limit` param to transaction API)
5. **Market pages** — listing redesign + detail polish
6. **Portfolio pages** — list + detail + transactions polish
7. **Watchlist** — polish existing with sparklines, compact/expanded
8. **Settings** — profile + preferences polish
9. **Skeleton loaders** — warm shimmer across all pages

### Phase 2: Data Enrichment
10. **Database migrations** — create `company_data` and `market_events` tables
11. **BigData API endpoints** — fundamentals, events, overview
12. **Market detail enrichment** — wire BigData data into market detail page

### Phase 3: Automation & Features
13. **Alert system** — notifications table, edge function cron, bell UI, alerts page
14. **GBM+ importer** — CSV parser + import flow
15. **Export** — CSV/Excel/PDF generation

Each phase is independently deployable. Copy for landing page is final as written (Spanish).
