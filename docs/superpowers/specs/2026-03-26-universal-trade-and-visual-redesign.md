# Universal Trade Flow + Visual Redesign

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Two problems — broken add-to-portfolio flow + generic/flat visual design

---

## Problem Statement

### Problem 1: Broken Transaction Flow
- The "Agregar a Portafolio" button on `/market/[symbol]` navigates to `/portfolio/{id}/transactions?add={symbol}`, but the transactions page ignores the `?add` parameter entirely.
- The `TransactionModal` component only lives inside `/portfolio/[id]/page.tsx`. Users cannot buy from market, watchlist, or dashboard.
- The symbol autocomplete in the modal is minimal: shows only symbol + name, no price, no exchange, no visual richness.
- Users who don't know ticker symbols (e.g., they search "Apple" not "AAPL") get a poor experience.

### Problem 2: Generic Visual Design
- Light mode background `#f6f4ef` creates low contrast — everything looks washed out.
- Cards are flat with no real depth (no shadows, no hover states).
- The bento grid `gridTemplateColumns: '1.1fr 0.9fr'` is not responsive — breaks on tablets.
- Action buttons ("Revisar posiciones", "Chequeo de riesgo", "Rebalancear") don't do anything.
- No micro-animations, no visual personality — feels like a template, not a product.

---

## Design: Universal Trade Flow

### TradeContext (Global State)

A React context mounted once in `app-shell.tsx`:

```typescript
interface TradeContextValue {
  openTrade: (opts?: { symbol?: string; portfolioId?: string; type?: 'buy' | 'sell' | 'dividend' }) => void
  closeTrade: () => void
  isOpen: boolean
}
```

**File:** `src/lib/contexts/trade-context.tsx`

Any component anywhere in the app can call `openTrade()`:
- From `/market/AAPL` → `openTrade({ symbol: 'AAPL' })`
- From `/watchlist` → `openTrade({ symbol: 'TSLA' })`
- From `/portfolio/[id]` → `openTrade({ portfolioId: id })`
- From `/dashboard` → `openTrade()` (empty, user picks everything)

### UniversalTradeModal Component

**File:** `src/components/trade/universal-trade-modal.tsx`

Replaces the old `TransactionModal`. Mounted once in `AppShell`, controlled via `TradeContext`.

**Layout:**
1. **Symbol search** (top, prominent) — large input with intelligent autocomplete
2. **Asset card** — appears after symbol selected, shows name + price + change
3. **Portfolio selector** — dropdown of all user portfolios
4. **Type pills** — Compra / Venta / Dividendo (pill buttons, not dropdown)
5. **Price** — auto-filled from market, editable
6. **Amount ↔ Quantity** — bidirectional linked fields (preserved from current)
7. **Fees + Currency** — row
8. **Preview** — "Compraras 0.013 de MSFT a $371.04/unidad = $5.00 USD"
9. **Submit button**

### Intelligent Autocomplete

**File:** `src/components/trade/symbol-autocomplete.tsx`

Extracted as standalone reusable component. Features:

- Searches by **name OR symbol** — "Apple" finds AAPL, "Tesla" finds TSLA
- Minimum 2 characters to trigger search
- Each result shows:
  - Logo placeholder: first letter in colored circle (deterministic color from symbol hash)
  - Symbol (bold, mono font)
  - Full company name
  - Exchange badge (NYSE, NASDAQ, BMV)
  - Current price (mono font)
  - Day change % (green/red pill)
- Grouped by type: Acciones, ETFs, Crypto
- Keyboard navigation: ↑↓ navigate, Enter select, Escape close
- Recent searches shown when input is empty (last 5, with live prices)
- Loading state: skeleton shimmer while searching
- Empty state: "No encontramos resultados para X"

### Integration Points

1. **`/market/[symbol]` page** — "Agregar a Portafolio" button calls `openTrade({ symbol })` instead of navigating away
2. **`/watchlist` page** — Each row gets a "Comprar" button → `openTrade({ symbol })`
3. **Dashboard action pills** — "Transaccion" pill calls `openTrade()`
4. **`/portfolio/[id]` page** — Existing "+ Transaccion" button calls `openTrade({ portfolioId: id })`
5. **Global search (Cmd+K)** — Add "Comprar" action next to each result
6. **Old `TransactionModal`** — deleted, replaced everywhere

---

## Design: Visual Redesign

### Color System

#### Light Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#FFFFFF` | Page background |
| `--bg-secondary` | `#F7F9FA` | Secondary backgrounds, input bg |
| `--card` | `#FFFFFF` | Card background |
| `--card-hover` | `#FAFAFA` | Card hover state |
| `--border` | `#F0F0F0` | Subtle borders |
| `--border-strong` | `#E1E4E8` | Emphasized borders |
| `--ink` | `#0F1419` | Primary text |
| `--ink-secondary` | `#536471` | Secondary text |
| `--ink-tertiary` | `#8899A6` | Tertiary text/placeholders |
| `--brand` | `#6366F1` | Primary accent (indigo) |
| `--brand-hover` | `#4F46E5` | Accent hover |
| `--brand-soft` | `rgba(99,102,241,0.08)` | Accent background |
| `--good` | `#22C55E` | Positive/gain |
| `--good-soft` | `rgba(34,197,94,0.1)` | Positive background |
| `--bad` | `#EF4444` | Negative/loss |
| `--bad-soft` | `rgba(239,68,68,0.1)` | Negative background |

#### Dark Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#000000` | Page background (pure black) |
| `--bg-secondary` | `#0A0A0A` | Secondary backgrounds |
| `--card` | `#16181C` | Card background |
| `--card-hover` | `#1D1F23` | Card hover |
| `--border` | `#2F3336` | Borders |
| `--border-strong` | `#3E4144` | Emphasized borders |
| `--ink` | `#E7E9EA` | Primary text |
| `--ink-secondary` | `#71767B` | Secondary text |
| `--ink-tertiary` | `#536471` | Tertiary |
| `--brand` | `#818CF8` | Lighter indigo for dark bg |
| `--brand-hover` | `#6366F1` | Accent hover |
| `--brand-soft` | `rgba(129,140,248,0.12)` | Accent bg |
| `--good` | `#4ADE80` | Brighter green for dark |
| `--good-soft` | `rgba(74,222,128,0.12)` | Positive bg |
| `--bad` | `#F87171` | Brighter red for dark |
| `--bad-soft` | `rgba(248,113,113,0.12)` | Negative bg |

### Card System

All cards share:
- `border-radius: 16px`
- `background: var(--card)`
- `border: 1px solid var(--border)`
- `box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)` (light only)
- `transition: box-shadow 200ms, transform 200ms`
- Hover: `box-shadow: 0 4px 16px rgba(0,0,0,0.12)` + `transform: translateY(-1px)`
- Dark mode: no box-shadow, rely on border glow on hover

### Sidebar

- Active indicator: 3px vertical bar on left side, `var(--brand)` color
- Active background: `var(--brand-soft)`
- Icon size: 20px
- Hover: `var(--bg-secondary)` background
- Footer CTA: more subtle gradient, rounded-2xl

### Topbar

- Solid background with blur: `backdrop-filter: blur(12px)` + `var(--bg)` at 85% opacity
- Search bar: `var(--bg-secondary)` background, `var(--border)` border, 44px height
- Avatar: 2px ring in `var(--brand)` color

### Dashboard Responsive Grid

```css
/* Mobile first */
.bento-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1fr;
}
@media (min-width: 1024px) {
  .bento-grid {
    grid-template-columns: 1.1fr 0.9fr;
  }
}
```

### Micro-animations

```css
/* Staggered card entrance */
.stagger-enter > * {
  opacity: 0;
  transform: translateY(8px);
  animation: stagger-in 400ms ease-out forwards;
}
.stagger-enter > *:nth-child(1) { animation-delay: 0ms; }
.stagger-enter > *:nth-child(2) { animation-delay: 60ms; }
.stagger-enter > *:nth-child(3) { animation-delay: 120ms; }
/* ... up to 8 */

@keyframes stagger-in {
  to { opacity: 1; transform: translateY(0); }
}

/* Button press */
.btn-press:active {
  transform: scale(0.97);
  transition: transform 100ms;
}

/* Number count-up handled by JS (requestAnimationFrame) */
```

### Typography

| Role | Font | Size | Weight | Tracking |
|------|------|------|--------|----------|
| Page heading | Fraunces | clamp(24px, 3vw, 40px) | 700 | -0.03em |
| Section heading | Plus Jakarta Sans | 18px | 700 | -0.01em |
| KPI value | JetBrains Mono | clamp(28px, 3.3vw, 44px) | 700 | -0.02em |
| Body | Plus Jakarta Sans | 14px | 500 | normal |
| Caption/label | Plus Jakarta Sans | 12px | 600 | 0.05em, uppercase |
| Badge/pill | Plus Jakarta Sans | 12px | 600 | 0.03em |
| Code/prices | JetBrains Mono | 13px | 500 | normal |

### Non-functional action buttons

The three dashboard buttons ("Revisar posiciones", "Chequeo de riesgo", "Rebalancear") will be connected:
- "Revisar posiciones" → navigates to first portfolio's positions
- "Chequeo de riesgo" → navigates to first portfolio's analytics
- "Rebalancear" → opens toast "Proximamente" (not yet implemented)

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/contexts/trade-context.tsx` | TradeContext provider + hook |
| `src/components/trade/universal-trade-modal.tsx` | Global trade modal |
| `src/components/trade/symbol-autocomplete.tsx` | Intelligent autocomplete |

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/globals.css` | New color system, card classes, animations, responsive grid |
| `src/components/layout/app-shell.tsx` | Mount TradeProvider + UniversalTradeModal |
| `src/components/layout/sidebar.tsx` | Active indicator bar, improved hover states |
| `src/components/layout/topbar.tsx` | Solid bg, avatar ring, improved search |
| `src/app/(app)/dashboard/page.tsx` | Responsive bento grid, connect action buttons, stagger animations |
| `src/app/(app)/market/[symbol]/page.tsx` | Use openTrade() instead of navigation |
| `src/app/(app)/watchlist/page.tsx` | Add "Comprar" button per row |
| `src/app/(app)/portfolio/[id]/page.tsx` | Replace TransactionModal with openTrade() |
| `src/components/dashboard/kpi-cards.tsx` | New card styling, typography |
| `src/components/dashboard/portfolio-chart.tsx` | New card styling |
| `src/components/dashboard/allocation-donut.tsx` | New card styling |
| `src/components/dashboard/top-movers.tsx` | New card styling, buy button |
| `src/components/market/symbol-search.tsx` | Add "Comprar" action to results |

## Files to Delete

| File | Reason |
|------|--------|
| `src/components/portfolio/transaction-modal.tsx` | Replaced by UniversalTradeModal |

---

## Review Fixes (from spec review)

### Fix 1: CSS Variable Consolidation
The existing codebase has THREE variable systems: shadcn (`--background`, `--card`), design-system (`--bg`, `--paper`, `--ink`, `--hair`), and now this spec. **Decision: consolidate to ONE system.** All shadcn tokens stay as-is (components reference them). The custom `--bg`, `--paper`, `--ink`, `--hair`, `--ds-muted` tokens are REMOVED. This spec's tokens map directly to shadcn:
- `--background` = `#FFFFFF` / `#000000`
- `--card` = `#FFFFFF` / `#16181C`
- `--border` = `#F0F0F0` / `#2F3336`
- `--foreground` = `#0F1419` / `#E7E9EA`
- `--muted-foreground` = `#536471` / `#71767B`
- `--primary` = `#6366F1` / `#818CF8`

New tokens added (not conflicting):
- `--good`, `--good-soft`, `--bad`, `--bad-soft` for gain/loss colors
- `--bg-secondary` for secondary backgrounds

All references to `--hair`, `--paper`, `--ink`, `--ds-muted` in components will be replaced with the corresponding shadcn tokens. The `glass-panel` class, body grain texture (`body::before`), and radial body gradient are REMOVED — replaced by clean white/black backgrounds.

### Fix 2: Asset Type Auto-Detection
The autocomplete results include a `type` field from the search API (e.g., "Equity", "ETF", "Cryptocurrency"). The modal will auto-set `assetType` based on this:
- `Equity` → `stock`
- `ETF` → `etf`
- `Cryptocurrency` → `crypto`
- Default → `stock`
User can still override via a small type selector shown below the asset card.

### Fix 3: Date Field
Add optional date picker to the modal, defaulting to today. For recording historical transactions.

### Fix 4: Empty Portfolio State
If user has zero portfolios when opening trade modal, show: "No tienes portafolios aun" with a "Crear portafolio" button that links to `/portfolio/new`.

### Fix 5: Mobile Modal
On screens < 640px, the modal renders as a full-screen Sheet (bottom-up) instead of centered Dialog. Uses shadcn Sheet component.

### Fix 6: Keep TransactionEditModal
The existing `TransactionEditModal` for editing transactions is NOT touched. Only the creation modal is replaced.

### Fix 7: Font Stack
JetBrains Mono is already loaded in `layout.tsx` as `--font-mono`. The `--mono` CSS variable will be updated to reference it. No new font downloads needed.

### Fix 8: Global Keyboard Shortcut
`T` key opens trade modal globally (when not in input/textarea), matching the dashboard pill hint.

---

## Implementation Strategy

4 parallel agents (ordered to avoid conflicts):

**Agent 1 — Trade System (no CSS conflicts):**
- Create `trade-context.tsx`, `universal-trade-modal.tsx`, `symbol-autocomplete.tsx`
- These are NEW files, no conflicts with other agents

**Agent 2 — CSS + Visual Foundation (owns globals.css):**
- Rewrite color tokens in globals.css (consolidate 3 systems → 1)
- Remove glass-panel, grain texture, body gradients
- Add card utility classes, animations, responsive grid
- Update sidebar.tsx + topbar.tsx visual styles

**Agent 3 — Dashboard + Components (depends on Agent 2 tokens):**
- Update KPI cards, chart, donut, top movers with new styling
- Responsive bento grid
- Connect action buttons
- Stagger animations

**Agent 4 — Integration (depends on Agent 1 context):**
- Update market/[symbol], watchlist, portfolio/[id] to use openTrade()
- Add "Comprar" to Cmd+K search results
- Delete old transaction-modal.tsx

**Merge order:** Agent 1 + Agent 2 first (independent), then Agent 3 + Agent 4 (dependent). Build and fix after all complete.
