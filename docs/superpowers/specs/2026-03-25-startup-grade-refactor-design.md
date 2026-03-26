# Investment Portfolio Tracker — Startup-Grade Refactor

**Date:** 2026-03-25
**Status:** Design
**Goal:** Elevate from "good personal project" (80/100) to "startup-grade" (95/100)

---

## Phase A: Architecture Refactor

### A1. Shared Fetcher + SWR Configuration

**Problem:** The same fetcher function is copy-pasted across 12 hooks.

**Solution:** Extract to `src/lib/api/fetcher.ts`:
```ts
export const apiFetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}
```

Also create `src/lib/api/swr-config.ts` for shared SWR options (dedupingInterval, retry, error handler).

### A2. FormattedAmount Component

**Problem:** Currency conversion + formatting called manually 20+ times with inconsistent patterns.

**Solution:** `src/components/shared/formatted-amount.tsx`:
```tsx
<FormattedAmount value={100} from="USD" /> // → $1,920.50 MXN (auto-converts)
<FormattedAmount value={100} from="MXN" colorize /> // → green if positive
```

Encapsulates: conversion lookup, number formatting, color coding, null safety.

### A3. Dashboard Decomposition

**Problem:** Dashboard page is ~150 lines mixing data computation with UI.

**Solution:**
- Extract `src/lib/hooks/use-portfolio-stats.ts` — computes totalValue, totalReturn, allocation, movers, bestPosition
- Dashboard page becomes pure UI consuming the hook
- Each KPI card gets its own data slice (no giant useMemo)

### A4. Chart Config Factory

**Problem:** Recharts tooltip, responsive, axis configs repeated across 3+ chart components.

**Solution:** `src/lib/utils/chart-config.ts`:
```ts
export const createChartConfig = (type: 'area' | 'bar' | 'donut') => ({
  tooltip: { ... },
  responsive: { ... },
  axis: { ... },
})
```

### A5. Error Handling + Empty States

**Problem:** No centralized error logging, inconsistent empty states, no retry.

**Solution:**
- `src/lib/api/error-logger.ts` — logs errors with context (route, user, timestamp)
- SWR retry config (exponential backoff, max 3 retries)
- `src/components/shared/empty-state.tsx` — reusable empty state with icon, message, CTA
- `src/components/shared/error-display.tsx` — reusable error with retry button

### A6. Performance: Debounce + Optimistic Updates

**Problem:** Search fires on every keystroke. CRUD operations wait for server before updating UI.

**Solution:**
- `useDebounce(value, 300)` hook for search inputs
- SWR `optimisticData` for create/update/delete operations (instant UI feedback)
- Lazy load heavy components (charts, fundamentals grid) with `React.lazy` + Suspense

### A7. Dead Code Cleanup

**Problem:** Manual test scripts (.mjs files), unused admin routes, legacy references.

**Solution:** Remove test-*.mjs, seed-*.mjs scripts from root. Remove /api/admin/* if not needed.

---

## Phase B: New Features

### B1. Smart Transaction Modal

**Problem:** Users enter qty=1 at wrong price instead of fractional shares — root cause of phantom gains bug.

**Solution:** Dual-input mode in transaction modal:
- **By Quantity:** Enter shares directly (existing behavior)
- **By Amount:** Enter dollar amount → auto-calculates fractional shares at current market price
- Live preview: "You're buying 0.01344 shares of MSFT at $372.74/share"
- Auto-fetch current price when symbol selected

### B2. CSV/Excel Portfolio Importer

**Problem:** Manual entry is tedious for users with existing portfolios.

**Solution:** `/portfolio/import` page:
- Drag & drop CSV/XLSX upload
- Auto-detect columns (date, symbol, qty, price, fees)
- Preview table with validation (highlight errors)
- Support GBM+ export format specifically (Mexican broker)
- Bulk insert via API

### B3. Portfolio Export

**Problem:** No way to export portfolio data.

**Solution:**
- CSV export of transactions
- PDF portfolio report (summary, positions, performance chart)
- Shareable portfolio snapshot (public URL with read-only view)

---

## Phase C: Testing

### C1. Unit Tests (target: 60% coverage on services/)

- `market.ts` — mock Twelve Data + Yahoo, test fallback behavior
- `transaction.ts` — test recalculatePosition with buy/sell/split/dividend
- `portfolio-history.ts` — test daily snapshot computation
- `analytics.ts` — test Sharpe ratio, volatility calculations
- `currency.ts` — expand existing tests
- `fetcher.ts` — test error handling, retry

### C2. Component Tests

- FormattedAmount — renders correct currency, handles null
- TransactionModal — validates inputs, calculates amounts
- KPI Cards — displays correct values
- PositionsTable — sorting works

### C3. E2E Tests (Playwright)

- Full login → dashboard → add transaction → verify values flow
- Search market → add to watchlist → verify
- Create alert → verify display
- Import CSV → verify positions created

---

## Implementation Order

1. A1 (fetcher) → A2 (FormattedAmount) → A3 (dashboard) → A5 (errors) — Foundation
2. A4 (charts) → A6 (perf) → A7 (cleanup) — Polish
3. B1 (smart modal) → C1 (unit tests) — Critical feature + safety net
4. B2 (import) → B3 (export) → C2 + C3 (tests) — Features + coverage

## Success Criteria

- Zero code duplication in fetchers/formatters
- Dashboard renders in <1s (optimistic + cached)
- Transaction modal prevents data entry errors
- 60%+ test coverage on business logic
- All E2E tests pass on every deploy
