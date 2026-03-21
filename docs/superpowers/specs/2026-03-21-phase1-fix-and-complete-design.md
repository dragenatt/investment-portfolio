# Phase 1: Fix & Complete — Design Spec

**Date:** 2026-03-21
**Goal:** Fix broken features and fill critical gaps before any visual polish.

---

## 0. Required Database Migration

Before any feature work, apply these schema changes:

```sql
-- Allow users to UPDATE their own transactions (needed for edit feature)
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));

-- Allow API to INSERT into price_history for caching historical prices
-- Use service role key for price_history writes (no user-facing INSERT policy needed)
```

---

## 1. Dashboard Performance Chart

### Problem
The Recharts AreaChart on the dashboard renders empty — no historical portfolio value data exists.

### Solution

**New API: `GET /api/portfolio/history?range=30|90|365`**

1. Fetch all transactions for the authenticated user across all portfolios, ordered by `executed_at`.
2. Build a daily timeline from the earliest transaction to today.
3. For each day, compute the net position per symbol (cumulative buys minus sells up to that date), using the existing `recalculatePosition` logic in `src/lib/services/transaction.ts` as reference for how sells reduce positions.
4. Multiply each position's quantity by the closing price on that day.
   - Historical prices: fetch from Yahoo Finance v8 chart API with `range=1mo|3mo|1y` and `interval=1d`.
   - Cache fetched historical prices in the `price_history` table (columns: `symbol`, `date`, `close_price`). Use Supabase **service role** client for writes since no INSERT policy exists for users.
   - On subsequent requests, read from cache if data exists for that symbol+date range.
   - Rate limit: fetch at most 5 symbols concurrently to avoid Yahoo Finance throttling.
5. Sum all position values per day to get total portfolio value.
6. Cache the aggregated daily totals in memory (or short-lived Supabase row) to avoid recomputation on every request within the same session.
7. Return array of `{ date: string, value: number }`.

**Frontend changes (`src/app/(app)/dashboard/page.tsx`):**
- New hook `usePortfolioHistory(range)` calling `/api/portfolio/history`.
- Replace empty chart with Recharts `AreaChart` using gradient fill.
- Keep existing period tabs from `PortfolioChart` component (`['1D', '1W', '1M', '3M', '1Y', 'MAX']`) but map them to API ranges: 1D→1, 1W→7, 1M→30, 3M→90, 1Y→365, MAX→all.
- Show loading skeleton while data fetches.
- Tooltip shows date + formatted value.

**Edge cases:**
- User with no transactions: show empty state message instead of chart.
- Days with no market data (weekends/holidays): carry forward last known price.
- New position added today with no history: use current price for today only.

---

## 2. Live Exchange Rates

### Problem
Exchange rates are hardcoded: `{ USD: 1, MXN: 17.5, EUR: 0.92 }`.

### Solution

**New API: `GET /api/rates`**

1. Check `current_prices` table for rows where `symbol` is `USDMXN=X` or `USDEUR=X` and `expires_at > now()` (using the existing `expires_at` column, consistent with how `src/app/api/market/[symbol]/route.ts` checks cache freshness).
2. If cache is fresh, return cached rates.
3. If stale or missing, fetch from Yahoo Finance quote endpoint for forex pairs `USDMXN=X` and `USDEUR=X`.
4. Upsert into `current_prices` table with `exchange` set to `'FX'`, `fetched_at` to now, and `expires_at` to now + 1 hour.
5. Return `{ USD: 1, MXN: <rate>, EUR: <rate> }`.

**Frontend changes:**
- New hook `useRates()` in `src/lib/hooks/use-rates.tsx` — SWR with 5-minute refresh.
- Update `useCurrency()` hook (`src/lib/hooks/use-currency.tsx`) to consume `useRates()` instead of hardcoded values.
- Fallback to hardcoded rates if API fails (graceful degradation).

---

## 3. Transaction History UI

### Problem
Transactions can only be created. No list view, edit, or delete exists.

### Solution

**Data fetching:** Use existing `GET /api/transaction?pid=<portfolio_id>` endpoint which already returns all transactions for a portfolio with position joins.

**New page: `src/app/(app)/portfolio/[id]/transactions/page.tsx`**

- Linked from portfolio detail page via a "Ver transacciones" button.
- Table columns: Fecha, Simbolo, Tipo (badge: buy/sell/dividend/split), Cantidad, Precio, Comisiones, Total.
- Filters: by type (multi-select), by symbol (dropdown), by date range (date pickers).
- Pagination: 20 per page with next/prev buttons.
- Each row has Edit (pencil icon) and Delete (trash icon) action buttons.

**Edit modal:**
- Dialog component with editable fields: `type`, `quantity`, `price`, `fees`, `currency`, `executed_at`, `notes`.
- `portfolio_id`, `symbol`, and `asset_type` are NOT editable (changing symbol would require moving between positions — out of scope).
- Pre-filled with existing values.
- On save: `PUT /api/transaction/[id]` with Zod validation.
- Recalculates affected position using existing `recalculatePosition()` from `src/lib/services/transaction.ts`.

**Delete flow:**
- Confirmation dialog: "Eliminar esta transaccion de {quantity} {symbol}?"
- On confirm: `DELETE /api/transaction/[id]` (endpoint already exists).
- Recalculates affected position after deletion.
- If position quantity reaches 0, keep the position row but mark quantity as 0.

**New API endpoint:**

`PUT /api/transaction/[id]/route.ts` (add PUT handler to existing file):
- Auth check + verify transaction belongs to user's portfolio.
- Validate body with `UpdateTransactionSchema`.
- Update transaction row (requires new RLS UPDATE policy — see Section 0).
- Recalculate position using existing `recalculatePosition()`.

**New schema in `src/lib/schemas/transaction.ts`:**
```typescript
export const UpdateTransactionSchema = z.object({
  type: z.enum(['buy', 'sell', 'dividend', 'split']).optional(),
  quantity: z.number().positive().max(999_999_999).optional(),
  price: z.number().positive().max(999_999_999).optional(),
  fees: z.number().min(0).optional(),
  currency: z.enum(['MXN', 'USD', 'EUR']).optional(),
  executed_at: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
})
```

---

## 4. Watchlist Improvements

### Problem
Watchlists are basic: no sorting, no delete watchlist, no rename.

### Solution

**Sorting:**
- Add sort dropdown to each watchlist card header: "Ordenar por: Nombre | Precio | Cambio %".
- Default sort: insertion order (current behavior).
- Sort is client-side since watchlists are small (< 50 items typically).

**Delete watchlist:**
- Add trash icon button in watchlist card header.
- Confirmation dialog: "Eliminar watchlist '{name}' y todos sus activos?"
- New route file: `src/app/api/watchlist/[id]/route.ts` with DELETE and PATCH handlers (does not exist yet).
- Cascade deletes watchlist_items via Supabase FK.

**Rename watchlist:**
- Pencil icon on watchlist name to enter edit mode.
- Inline input replaces the title text.
- On blur or Enter: `PATCH /api/watchlist/[id]` with new name.
- Validate: name must be 1-50 characters, non-empty after trim.
- Escape cancels edit.

---

## Technical Notes

- All new API routes follow existing patterns: Supabase server client, auth check, Zod validation, `success()`/`error()` response helpers.
- All new hooks follow existing SWR pattern in `src/lib/hooks/`.
- Position recalculation after transaction edit/delete: use existing `recalculatePosition()` from `src/lib/services/transaction.ts` which properly handles sells and splits.
- Yahoo Finance historical data: use existing fetch pattern from `src/lib/services/market.ts`.
- `price_history` writes use Supabase service role client (no user INSERT policy).
- No new dependencies needed — all features use existing libraries (Recharts, SWR, shadcn/ui, Zod).

---

## Out of Scope (Phase 2+)
- Visual polish, animations, gradients
- Landing page redesign
- Alerts/notifications system
- CSV/PDF export
- Drag-to-reorder watchlist items
- Cloudflare Worker price-engine deployment
