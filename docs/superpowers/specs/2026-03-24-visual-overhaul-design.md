# Visual Overhaul + Data Enrichment — Design Spec

## Overview

Complete visual redesign of the investment portfolio platform, transitioning from a dark theme to a warm cream/beige palette, enriching data with BigData MCP integration, and adding missing features (alerts, GBM+ import, exports). The goal is a premium financial app experience inspired by Google Finance (data-rich) and Fintual/GBM+ (clean, modern).

**User:** Intermediate investor using GBM+, wants things to "just work."
**Approach:** Phase A — Visual polish first, then data enrichment, then automation.

---

## Phase 1: Visual Overhaul

### 1.1 Color Palette

Replace current OKLch dark theme variables with warm light palette as default.

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#FEFCF8` | Main background |
| `--bg-secondary` | `#F5F0E8` | Alternate sections, sidebars |
| `--card-bg` | `#FFFDF7` | Card backgrounds |
| `--card-border` | `#E8E0D0` | Card borders |
| `--accent-primary` | `#B45309` | CTAs, highlights, active states |
| `--accent-hover` | `#D97706` | Hover on accent elements |
| `--gain` | `#4D7C0F` | Positive values (green olive) |
| `--loss` | `#C2410C` | Negative values (warm terracotta) |
| `--text-primary` | `#1C1917` | Main text (dark brown, not black) |
| `--text-secondary` | `#78716C` | Secondary text |
| `--gradient-hero-start` | `#FEFCF8` | Hero gradient start |
| `--gradient-hero-end` | `#FEF3E2` | Hero gradient end |
| `--chart-line` | `#D97706` | Chart stroke color |
| `--chart-fill-start` | `rgba(217,119,6,0.15)` | Chart gradient fill top |
| `--chart-fill-end` | `rgba(217,119,6,0)` | Chart gradient fill bottom |
| `--shimmer` | `#F5F0E8` | Skeleton loader pulse color |

Dark mode (optional, warm variant):

| Token | Value |
|---|---|
| `--bg-primary` | `#1C1917` |
| `--bg-secondary` | `#292524` |
| `--card-bg` | `#292524` |
| `--card-border` | `#44403C` |
| `--text-primary` | `#FEFCF8` |
| `--text-secondary` | `#A8A29E` |

**Files affected:**
- `src/app/globals.css` — replace all `@theme` color variables
- All components using hardcoded colors (e.g., `#2563eb` in charts)

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
     - Source: `/api/transaction?limit=5` (needs new param)
     - Link: "Ver todas" → portfolio transactions page

**New component:** `src/components/dashboard/recent-activity.tsx`

**Modified components:**
- `kpi-cards.tsx` — add sparklines, `@number-flow/react` animation, new "best position" card
- `portfolio-chart.tsx` — warm colors, improved tooltip, crosshair cursor
- `allocation-donut.tsx` — warm color palette
- `top-movers.tsx` — add sparkline per mover

### 1.5 Navigation Redesign

**Sidebar** (`src/components/layout/sidebar.tsx` or equivalent):
- Cleaner look: cream background, icons + labels
- Active state: pill with beige background (`--bg-secondary`) + accent left border
- Notification badge on Alerts icon (red dot with count)

**Mobile bottom tab bar** (new component: `src/components/layout/mobile-nav.tsx`):
- Fixed bottom bar on screens < md
- 5 tabs: Dashboard, Mercados, Portfolio, Watchlist, Mas (overflow)
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
- Import/Export section (Phase 3 implementation, UI placeholder now)
- Connections section (future, UI placeholder)

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

**Cache strategy:** Store BigData responses in Supabase `current_prices` or new `company_data` table with 24-hour TTL. BigData calls are more expensive than Yahoo, so aggressive caching.

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

**New tables:**
- `alerts` table already exists (id, user_id, symbol, condition, threshold, is_active, last_triggered_at)

**New components:**
- `src/app/(app)/alerts/page.tsx` — alert management page
- `src/components/alerts/create-alert-modal.tsx` — create/edit alert form
- `src/components/layout/notification-bell.tsx` — navbar notification badge + dropdown

**New API endpoints:**
- `POST /api/alerts` — create alert (already exists)
- `PUT /api/alerts/[id]` — toggle/edit alert
- `GET /api/alerts/triggered` — recent triggered alerts for notification panel

**Notification delivery:**
- In-app: Poll `/api/alerts/triggered` every 60s with SWR, show badge count
- Email: Supabase Edge Function triggered by cron — checks active alerts against current prices, sends email via Supabase Auth email service

**Cron job:** Use Scheduled Tasks MCP or Supabase Edge Function cron to run price checks every 5 minutes:
1. Fetch all active alerts
2. Batch fetch current prices for alert symbols
3. Compare against thresholds
4. Update `last_triggered_at` and insert notification record
5. Send email if configured

### 3.3 Export

- **Excel export:** Client-side using a lightweight library (e.g., `xlsx` or manual CSV generation)
- **PDF export:** Use `@react-pdf/renderer` or server-side HTML-to-PDF
- Exportable: portfolio summary, transaction history, performance report

**New components:**
- Export buttons on portfolio detail and transactions pages
- Format selector: CSV, Excel, PDF

---

## Technical Decisions

### State Management
No changes — SWR continues to handle all server state. No need for Redux/Zustand for this scope.

### New Dependencies (minimal)
- Phase 1: None — everything uses existing deps (`@number-flow/react`, `recharts`, `lucide-react`, `tailwind`)
- Phase 3 import: None — client-side CSV parsing with native JS
- Phase 3 export: `xlsx` package for Excel generation (~200KB)

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

1. **Theme + globals** — CSS variables, typography, spacing (affects everything)
2. **Navigation** — sidebar + mobile nav + breadcrumbs (structural)
3. **Landing page** — first impression
4. **Dashboard** — main page users see daily
5. **Market pages** — listing + detail polish
6. **Portfolio pages** — list + detail + transactions polish
7. **Watchlist** — polish existing
8. **Settings** — polish + placeholders for import/export
9. **Skeleton loaders** — warm shimmer across all pages
10. **BigData integration** — API endpoints + market detail enrichment
11. **Alert system** — full implementation
12. **GBM+ importer** — CSV parser + import flow
13. **Export** — Excel/CSV/PDF generation
