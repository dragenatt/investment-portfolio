# Phase 1: Fix & Complete — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the empty dashboard chart, replace hardcoded exchange rates with live data, add transaction history/edit/delete UI, and improve watchlist management.

**Architecture:** Four independent features built on existing patterns — Supabase server client with RLS, SWR hooks for frontend data, Zod validation, Yahoo Finance for market data. Each feature adds an API route + hook + UI component following the project's established structure.

**Tech Stack:** Next.js 16, Supabase (PostgreSQL + RLS), SWR, Recharts, shadcn/ui, Zod, Yahoo Finance API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-phase1-fix-and-complete-design.md`

---

## File Structure

### New files:
- `src/app/api/portfolio/history/route.ts` — Portfolio value history API
- `src/app/api/rates/route.ts` — Live exchange rates API
- `src/app/api/watchlist/[id]/route.ts` — Watchlist DELETE + PATCH handlers
- `src/lib/hooks/use-portfolio-history.ts` — SWR hook for chart data
- `src/lib/hooks/use-rates.ts` — SWR hook for exchange rates
- `src/lib/hooks/use-transactions.ts` — SWR hook for transaction list
- `src/app/(app)/portfolio/[id]/transactions/page.tsx` — Transaction history page
- `src/components/portfolio/transaction-edit-modal.tsx` — Edit transaction dialog
- `src/lib/schemas/watchlist-manage.ts` — Zod schema for watchlist rename
- `tests/lib/services/transaction.test.ts` — Unit tests for recalculatePosition
- `tests/lib/services/portfolio-history.test.ts` — Unit tests for history computation

### Modified files:
- `src/lib/schemas/transaction.ts` — Add UpdateTransactionSchema
- `src/app/api/transaction/[id]/route.ts` — Add PUT handler
- `src/components/dashboard/portfolio-chart.tsx` — Wire up real data via period callback
- `src/app/(app)/dashboard/page.tsx` — Feed chart with live history data
- `src/lib/hooks/use-currency.tsx` — Consume live rates instead of hardcoded
- `src/app/(app)/portfolio/[id]/page.tsx` — Add "Ver transacciones" link
- `src/app/(app)/watchlist/page.tsx` — Add sort, rename, delete features

---

## Chunk 1: Database Migration + Exchange Rates

### Task 1: Apply RLS UPDATE policy for transactions

**Files:**
- Create: `supabase/migrations/002_transactions_update_policy.sql`

- [ ] **Step 1: Write the migration SQL**

First create the directory: `mkdir -p supabase/migrations`

Then create `supabase/migrations/002_transactions_update_policy.sql`:

```sql
-- Allow users to update their own transactions
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase dashboard SQL editor or CLI:
```bash
npx supabase db push
```
If no CLI link, paste the SQL directly in the Supabase SQL editor at https://supabase.com/dashboard/project/mabmqxztvakaijtrncyl/sql/new

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_transactions_update_policy.sql
git commit -m "feat: add RLS UPDATE policy for transactions table"
```

---

### Task 2: Live Exchange Rates API

**Files:**
- Create: `src/app/api/rates/route.ts`
- Create: `src/lib/hooks/use-rates.ts`

- [ ] **Step 1: Create the rates API endpoint**

Create `src/app/api/rates/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

const FOREX_PAIRS = [
  { pair: 'USDMXN=X', currency: 'MXN' },
  { pair: 'USDEUR=X', currency: 'EUR' },
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const rates: Record<string, number> = { USD: 1 }

  // Check cache first
  const { data: cached } = await supabase
    .from('current_prices')
    .select('symbol, price, expires_at')
    .in('symbol', FOREX_PAIRS.map(p => p.pair))
    .gt('expires_at', new Date().toISOString())

  const cachedMap = new Map((cached || []).map(c => [c.symbol, c.price]))

  for (const { pair, currency } of FOREX_PAIRS) {
    if (cachedMap.has(pair)) {
      rates[currency] = cachedMap.get(pair)!
      continue
    }

    // Fetch from Yahoo Finance
    const quote = await getQuote(pair)
    if (quote?.price) {
      rates[currency] = quote.price

      // Cache for 1 hour
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
      await supabase.from('current_prices').upsert({
        symbol: pair,
        exchange: 'FX',
        price: quote.price,
        change_pct: quote.changePct ?? 0,
        volume: 0,
        currency: 'USD',
        source: 'yahoo',
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'symbol,exchange' })
    } else {
      // Fallback to hardcoded
      rates[currency] = currency === 'MXN' ? 17.5 : 0.92
    }
  }

  return success(rates)
}
```

- [ ] **Step 2: Verify API compiles**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | head -20
```
Expected: no TypeScript errors related to the new file.

- [ ] **Step 3: Create the useRates hook**

Create `src/lib/hooks/use-rates.ts`:

```typescript
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useRates() {
  return useSWR<Record<string, number>>('/api/rates', fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 minutes
    fallbackData: { USD: 1, MXN: 17.5, EUR: 0.92 },
  })
}
```

- [ ] **Step 4: Update useCurrency to consume live rates**

Modify `src/lib/hooks/use-currency.tsx`:

Replace the hardcoded `DEFAULT_RATES` and `useState(DEFAULT_RATES)` with the `useRates` hook:

```typescript
'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { convertCurrency, formatCurrency } from '@/lib/utils/currency'
import { useRates } from '@/lib/hooks/use-rates'

type CurrencyContextType = {
  currency: string
  setCurrency: (c: string) => void
  format: (amount: number, from?: string) => string
  convert: (amount: number, from: string) => number
  rates: Record<string, number>
}

const CurrencyContext = createContext<CurrencyContextType | null>(null)

const FALLBACK_RATES: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }

export function CurrencyProvider({ children, initialCurrency = 'MXN' }: { children: ReactNode; initialCurrency?: string }) {
  const [currency, setCurrency] = useState(initialCurrency)
  const { data: rates } = useRates()
  const activeRates = rates ?? FALLBACK_RATES

  const convert = (amount: number, from: string) => convertCurrency(amount, from, currency, activeRates)
  const format = (amount: number, from?: string) => {
    const converted = from ? convert(amount, from) : amount
    return formatCurrency(converted, currency)
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, convert, rates: activeRates }}>
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

- [ ] **Step 5: Build and verify no errors**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/rates/route.ts src/lib/hooks/use-rates.ts src/lib/hooks/use-currency.tsx
git commit -m "feat: live exchange rates from Yahoo Finance with Supabase cache"
```

---

## Chunk 2: Dashboard Performance Chart

### Task 3: Portfolio history computation service

**Files:**
- Create: `src/lib/services/portfolio-history.ts`
- Create: `tests/lib/services/portfolio-history.test.ts`

- [ ] **Step 1: Write the test for computing daily positions from transactions**

Create `tests/lib/services/portfolio-history.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeDailyPositions, buildDailyTimeline } from '@/lib/services/portfolio-history'

describe('computeDailyPositions', () => {
  it('returns empty array for no transactions', () => {
    expect(computeDailyPositions([])).toEqual([])
  })

  it('computes daily positions from buy transactions', () => {
    const transactions = [
      { executed_at: '2026-01-10T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 10, price: 150 },
      { executed_at: '2026-01-15T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 5, price: 160 },
    ]
    const result = computeDailyPositions(transactions)
    // After Jan 10: 10 AAPL
    // After Jan 15: 15 AAPL
    const jan10 = result.find(d => d.date === '2026-01-10')
    expect(jan10?.positions).toEqual({ AAPL: 10 })
    const jan15 = result.find(d => d.date === '2026-01-15')
    expect(jan15?.positions).toEqual({ AAPL: 15 })
  })

  it('handles sells correctly', () => {
    const transactions = [
      { executed_at: '2026-01-10T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 10, price: 150 },
      { executed_at: '2026-01-20T12:00:00Z', type: 'sell' as const, symbol: 'AAPL', quantity: 3, price: 170 },
    ]
    const result = computeDailyPositions(transactions)
    const jan20 = result.find(d => d.date === '2026-01-20')
    expect(jan20?.positions).toEqual({ AAPL: 7 })
  })
})

describe('buildDailyTimeline', () => {
  it('returns empty array for no snapshots', () => {
    expect(buildDailyTimeline([], {}, '2026-01-15')).toEqual([])
  })

  it('calculates portfolio value from positions and prices', () => {
    const snapshots = [
      { date: '2026-01-10', positions: { AAPL: 10 } },
    ]
    const historicalPrices = {
      AAPL: { '2026-01-10': 150, '2026-01-11': 152, '2026-01-12': 148 },
    }
    const result = buildDailyTimeline(snapshots, historicalPrices, '2026-01-12')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2026-01-10', value: 1500 })
    expect(result[1]).toEqual({ date: '2026-01-11', value: 1520 })
    expect(result[2]).toEqual({ date: '2026-01-12', value: 1480 })
  })

  it('carries forward last known price on weekends/holidays', () => {
    const snapshots = [
      { date: '2026-01-09', positions: { AAPL: 5 } },
    ]
    const historicalPrices = {
      AAPL: { '2026-01-09': 200 }, // Friday — no Sat/Sun data
    }
    const result = buildDailyTimeline(snapshots, historicalPrices, '2026-01-11')
    expect(result[1].value).toBe(1000) // Saturday carries Friday's price
    expect(result[2].value).toBe(1000) // Sunday carries Friday's price
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run tests/lib/services/portfolio-history.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement computeDailyPositions**

Create `src/lib/services/portfolio-history.ts`:

```typescript
type HistoryTransaction = {
  executed_at: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  symbol: string
  quantity: number
  price: number
}

type DailySnapshot = {
  date: string // YYYY-MM-DD
  positions: Record<string, number> // symbol -> quantity
}

export function computeDailyPositions(transactions: HistoryTransaction[]): DailySnapshot[] {
  if (transactions.length === 0) return []

  // Sort by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  )

  const snapshots: DailySnapshot[] = []
  const currentPositions: Record<string, number> = {}

  for (const txn of sorted) {
    const date = txn.executed_at.slice(0, 10) // YYYY-MM-DD

    switch (txn.type) {
      case 'buy':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) + txn.quantity
        break
      case 'sell':
        currentPositions[txn.symbol] = Math.max(0, (currentPositions[txn.symbol] || 0) - txn.quantity)
        break
      case 'split':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) * txn.quantity
        break
      case 'dividend':
        break // no effect on positions
    }

    // Update or add snapshot for this date
    const existing = snapshots.find(s => s.date === date)
    if (existing) {
      existing.positions = { ...currentPositions }
    } else {
      snapshots.push({ date, positions: { ...currentPositions } })
    }
  }

  return snapshots
}

export function buildDailyTimeline(
  snapshots: DailySnapshot[],
  historicalPrices: Record<string, Record<string, number>>, // symbol -> { "YYYY-MM-DD": closePrice }
  endDate: string // YYYY-MM-DD
): Array<{ date: string; value: number }> {
  if (snapshots.length === 0) return []

  const startDate = snapshots[0].date
  const timeline: Array<{ date: string; value: number }> = []
  let currentPositions: Record<string, number> = {}

  const start = new Date(startDate)
  const end = new Date(endDate)

  let snapshotIdx = 0
  const current = new Date(start)

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)

    // Update positions if there's a snapshot for this date
    while (snapshotIdx < snapshots.length && snapshots[snapshotIdx].date <= dateStr) {
      currentPositions = { ...snapshots[snapshotIdx].positions }
      snapshotIdx++
    }

    // Calculate portfolio value for this date
    let value = 0
    for (const [symbol, quantity] of Object.entries(currentPositions)) {
      if (quantity <= 0) continue
      // Find price: exact date, or carry forward last known
      const symbolPrices = historicalPrices[symbol] || {}
      const price = symbolPrices[dateStr] ?? findLastKnownPrice(symbolPrices, dateStr)
      value += quantity * (price || 0)
    }

    timeline.push({ date: dateStr, value })
    current.setDate(current.getDate() + 1)
  }

  return timeline
}

function findLastKnownPrice(prices: Record<string, number>, targetDate: string): number {
  const dates = Object.keys(prices).filter(d => d <= targetDate).sort()
  return dates.length > 0 ? prices[dates[dates.length - 1]] : 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run tests/lib/services/portfolio-history.test.ts
```
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/portfolio-history.ts tests/lib/services/portfolio-history.test.ts
git commit -m "feat: portfolio history computation with daily position tracking"
```

---

### Task 4: Portfolio history API endpoint

**Files:**
- Create: `src/app/api/portfolio/history/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/portfolio/history/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { computeDailyPositions, buildDailyTimeline } from '@/lib/services/portfolio-history'

const RANGE_MAP: Record<string, string> = {
  '1': '1d',
  '7': '5d',
  '30': '1mo',
  '90': '3mo',
  '365': '1y',
  'max': 'max',
}

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') || '30'

  // 1. Get all transactions across user's portfolios
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id')
    .is('deleted_at', null)

  if (!portfolios || portfolios.length === 0) return success([])

  const portfolioIds = portfolios.map(p => p.id)

  const { data: transactions } = await supabase
    .from('transactions')
    .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id, symbol)')
    .in('position.portfolio_id', portfolioIds)
    .order('executed_at', { ascending: true })

  if (!transactions || transactions.length === 0) return success([])

  // Flatten transactions with symbol
  const flatTxns = transactions.map((t: Record<string, unknown>) => {
    const position = t.position as { symbol: string }
    return {
      executed_at: t.executed_at as string,
      type: t.type as 'buy' | 'sell' | 'dividend' | 'split',
      symbol: position.symbol,
      quantity: t.quantity as number,
      price: t.price as number,
    }
  })

  // 2. Compute daily positions
  const snapshots = computeDailyPositions(flatTxns)
  if (snapshots.length === 0) return success([])

  // 3. Get unique symbols — check price_history cache first, then fetch missing from Yahoo
  const symbols = [...new Set(flatTxns.map(t => t.symbol))]
  const yahooRange = RANGE_MAP[range] || '1mo'

  const historicalPrices: Record<string, Record<string, number>> = {}

  // Check cache in price_history table
  const rangeDays = range === 'max' ? 3650 : (parseInt(range) || 30)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - rangeDays)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  for (const symbol of symbols) {
    const { data: cached } = await supabase
      .from('price_history')
      .select('date, close')
      .eq('symbol', symbol)
      .gte('date', cutoffStr)
      .order('date', { ascending: true })

    if (cached && cached.length > 0) {
      const priceMap: Record<string, number> = {}
      for (const row of cached) {
        priceMap[row.date] = row.close
      }
      historicalPrices[symbol] = priceMap
    }
  }

  // Fetch from Yahoo for symbols with no cached data
  const uncachedSymbols = symbols.filter(s => !historicalPrices[s] || Object.keys(historicalPrices[s]).length === 0)

  // Fetch up to 5 symbols concurrently
  const chunks: string[][] = []
  for (let i = 0; i < uncachedSymbols.length; i += 5) {
    chunks.push(uncachedSymbols.slice(i, i + 5))
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        const history = await getHistory(symbol, yahooRange)
        const priceMap: Record<string, number> = {}
        const rowsToCache: Array<{ symbol: string; exchange: string; date: string; open: number; high: number; low: number; close: number; volume: number }> = []
        for (const point of history) {
          const date = new Date(point.date).toISOString().slice(0, 10)
          if (point.close != null) {
            priceMap[date] = point.close
            rowsToCache.push({
              symbol,
              exchange: 'yahoo',
              date,
              open: point.open ?? 0,
              high: point.high ?? 0,
              low: point.low ?? 0,
              close: point.close,
              volume: point.volume ?? 0,
            })
          }
        }

        // Cache in price_history (upsert, ignore errors — cache is best-effort)
        if (rowsToCache.length > 0) {
          await supabase.from('price_history').upsert(rowsToCache, { onConflict: 'symbol,exchange,date' }).select()
        }

        return { symbol, priceMap }
      })
    )
    for (const { symbol, priceMap } of results) {
      historicalPrices[symbol] = priceMap
    }
  }

  // 4. Build daily timeline
  const today = new Date().toISOString().slice(0, 10)
  const timeline = buildDailyTimeline(snapshots, historicalPrices, today)

  // Filter to requested range
  const filtered = timeline.filter(t => t.date >= cutoffStr)

  return success(filtered)
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portfolio/history/route.ts
git commit -m "feat: portfolio history API with Yahoo Finance historical prices"
```

---

### Task 5: Wire chart to live data

**Files:**
- Create: `src/lib/hooks/use-portfolio-history.ts`
- Modify: `src/components/dashboard/portfolio-chart.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create the usePortfolioHistory hook**

Create `src/lib/hooks/use-portfolio-history.ts`:

```typescript
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function usePortfolioHistory(range: string) {
  return useSWR<Array<{ date: string; value: number }>>(
    `/api/portfolio/history?range=${range}`,
    fetcher,
    { refreshInterval: 60_000 } // 1 minute
  )
}
```

- [ ] **Step 2: Update PortfolioChart to accept an onPeriodChange callback**

Modify `src/components/dashboard/portfolio-chart.tsx`:

Replace the entire file with:

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { useState } from 'react'

type DataPoint = { date: string; value: number }

const periods = ['1D', '1W', '1M', '3M', '1Y', 'MAX'] as const

const PERIOD_TO_RANGE: Record<string, string> = {
  '1D': '1',
  '1W': '7',
  '1M': '30',
  '3M': '90',
  '1Y': '365',
  'MAX': 'max',
}

type Props = {
  data: DataPoint[]
  isLoading?: boolean
  onPeriodChange?: (range: string) => void
}

export function PortfolioChart({ data, isLoading, onPeriodChange }: Props) {
  const [period, setPeriod] = useState<string>('1M')

  const handlePeriodChange = (p: string) => {
    setPeriod(p)
    onPeriodChange?.(PERIOD_TO_RANGE[p] || '30')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Rendimiento</CardTitle>
        <Tabs value={period} onValueChange={handlePeriodChange}>
          <TabsList className="h-8">
            {periods.map(p => (
              <TabsTrigger key={p} value={p} className="text-xs px-2 h-6">{p}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
            Cargando datos...
          </div>
        ) : data.length === 0 ? (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
            Agrega transacciones para ver el rendimiento
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(d: string) => {
                  const date = new Date(d)
                  return `${date.getDate()}/${date.getMonth() + 1}`
                }}
              />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={60} />
              <Tooltip
                labelFormatter={(d: string) => new Date(d).toLocaleDateString('es-MX')}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Valor']}
              />
              <Area type="monotone" dataKey="value" stroke="#2563eb" fill="url(#colorValue)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Update dashboard to pass live data to chart**

Modify `src/app/(app)/dashboard/page.tsx`:

Add import at top:
```typescript
import { usePortfolioHistory } from '@/lib/hooks/use-portfolio-history'
```

Add state and hook inside the component (after `useCurrency`):
```typescript
const [chartRange, setChartRange] = useState('30')
const { data: chartData, isLoading: chartLoading } = usePortfolioHistory(chartRange)
```

Add `useState` to the existing `useMemo` import:
```typescript
import { useMemo, useState } from 'react'
```

Replace the chart line `<PortfolioChart data={[]} />` with:
```typescript
<PortfolioChart
  data={chartData ?? []}
  isLoading={chartLoading}
  onPeriodChange={setChartRange}
/>
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/use-portfolio-history.ts src/components/dashboard/portfolio-chart.tsx src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: dashboard chart shows real portfolio performance data"
```

---

## Chunk 3: Transaction History UI

### Task 6: UpdateTransactionSchema + PUT handler

**Files:**
- Modify: `src/lib/schemas/transaction.ts`
- Modify: `src/app/api/transaction/[id]/route.ts`

- [ ] **Step 1: Add UpdateTransactionSchema**

Add to end of `src/lib/schemas/transaction.ts`:

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

- [ ] **Step 2: Add PUT handler to transaction/[id]/route.ts**

Add to `src/app/api/transaction/[id]/route.ts` (after the existing DELETE export):

```typescript
import { validate } from '@/lib/api/validate'
import { UpdateTransactionSchema } from '@/lib/schemas/transaction'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdateTransactionSchema, body)
  if ('error' in result) return result.error

  // Get transaction to find position_id
  const { data: txn } = await supabase
    .from('transactions')
    .select('position_id')
    .eq('id', id)
    .single()
  if (!txn) return error('Transaction not found', 404)

  // Update transaction
  const { error: updateErr } = await supabase
    .from('transactions')
    .update(result.data)
    .eq('id', id)
  if (updateErr) return error(updateErr.message, 500)

  // Recalculate position from all transactions
  const { data: allTxns } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', txn.position_id)
    .order('executed_at', { ascending: true })

  const recalc = recalculatePosition(
    (allTxns || []) as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>
  )
  await supabase
    .from('positions')
    .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
    .eq('id', txn.position_id)

  return success({ updated: true })
}
```

Note: The imports for `validate` and `UpdateTransactionSchema` need to be added at the top of the file alongside existing imports. The final file should have these imports:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { recalculatePosition } from '@/lib/services/transaction'
import { UpdateTransactionSchema } from '@/lib/schemas/transaction'
```

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schemas/transaction.ts src/app/api/transaction/\[id\]/route.ts
git commit -m "feat: transaction UPDATE schema and PUT API endpoint"
```

---

### Task 7: useTransactions hook

**Files:**
- Create: `src/lib/hooks/use-transactions.ts`

- [ ] **Step 1: Create the hook**

Create `src/lib/hooks/use-transactions.ts`:

```typescript
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export type Transaction = {
  id: string
  position_id: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string
  notes: string | null
  position: {
    portfolio_id: string
    symbol: string
  }
}

export function useTransactions(portfolioId: string | null) {
  return useSWR<Transaction[]>(
    portfolioId ? `/api/transaction?pid=${portfolioId}` : null,
    fetcher
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/hooks/use-transactions.ts
git commit -m "feat: useTransactions SWR hook"
```

---

### Task 8: Transaction edit modal component

**Files:**
- Create: `src/components/portfolio/transaction-edit-modal.tsx`

- [ ] **Step 1: Create the edit modal**

Create `src/components/portfolio/transaction-edit-modal.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import type { Transaction } from '@/lib/hooks/use-transactions'

type Props = {
  transaction: Transaction
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionEditModal({ transaction, open, onOpenChange }: Props) {
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: transaction.type,
    quantity: transaction.quantity.toString(),
    price: transaction.price.toString(),
    fees: transaction.fees.toString(),
    currency: transaction.currency,
    executed_at: transaction.executed_at.slice(0, 16), // for datetime-local input
    notes: transaction.notes || '',
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (form.type !== transaction.type) body.type = form.type
      if (parseFloat(form.quantity) !== transaction.quantity) body.quantity = parseFloat(form.quantity)
      if (parseFloat(form.price) !== transaction.price) body.price = parseFloat(form.price)
      if (parseFloat(form.fees) !== transaction.fees) body.fees = parseFloat(form.fees)
      if (form.currency !== transaction.currency) body.currency = form.currency
      if (form.executed_at + ':00Z' !== transaction.executed_at) body.executed_at = form.executed_at + ':00Z'
      if (form.notes !== (transaction.notes || '')) body.notes = form.notes

      if (Object.keys(body).length === 0) {
        onOpenChange(false)
        return
      }

      const res = await fetch(`/api/transaction/${transaction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Transaccion actualizada')
        mutate(`/api/transaction?pid=${transaction.position.portfolio_id}`)
        mutate(`/api/portfolio/${transaction.position.portfolio_id}`)
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Transaccion — {transaction.position.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Tipo</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as typeof f.type }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">Compra</SelectItem>
                <SelectItem value="sell">Venta</SelectItem>
                <SelectItem value="dividend">Dividendo</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cantidad</Label>
              <Input type="number" step="any" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label>Precio</Label>
              <Input type="number" step="any" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Comisiones</Label>
              <Input type="number" step="any" value={form.fees} onChange={e => setForm(f => ({ ...f, fees: e.target.value }))} />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Fecha de ejecucion</Label>
            <Input type="datetime-local" value={form.executed_at} onChange={e => setForm(f => ({ ...f, executed_at: e.target.value }))} />
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/portfolio/transaction-edit-modal.tsx
git commit -m "feat: transaction edit modal dialog component"
```

---

### Task 9: Transaction history page

**Files:**
- Create: `src/app/(app)/portfolio/[id]/transactions/page.tsx`
- Modify: `src/app/(app)/portfolio/[id]/page.tsx`

- [ ] **Step 1: Create the transactions page**

Create `src/app/(app)/portfolio/[id]/transactions/page.tsx`:

```typescript
'use client'

import { use, useState } from 'react'
import { useTransactions, type Transaction } from '@/lib/hooks/use-transactions'
import { TransactionEditModal } from '@/components/portfolio/transaction-edit-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { Pencil, Trash2, ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'

const TYPE_LABELS: Record<string, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  split: 'Split',
}

const TYPE_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  buy: 'default',
  sell: 'destructive',
  dividend: 'secondary',
  split: 'outline',
}

const PAGE_SIZE = 20

export default function TransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: transactions, isLoading } = useTransactions(id)
  const { mutate } = useSWRConfig()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [symbolFilter, setSymbolFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Get unique symbols for filter
  const symbols = [...new Set((transactions || []).map(t => t.position.symbol))].sort()

  // Apply filters
  const filtered = (transactions || []).filter(t => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (symbolFilter !== 'all' && t.position.symbol !== symbolFilter) return false
    return true
  })

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/transaction/${deleting.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Transaccion eliminada')
        mutate(`/api/transaction?pid=${id}`)
        mutate(`/api/portfolio/${id}`)
        setDeleting(null)
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  if (isLoading) return <SkeletonTable />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/portfolio/${id}`}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Volver</Button>
        </Link>
        <h1 className="text-2xl font-bold">Transacciones</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0) }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="buy">Compra</SelectItem>
            <SelectItem value="sell">Venta</SelectItem>
            <SelectItem value="dividend">Dividendo</SelectItem>
            <SelectItem value="split">Split</SelectItem>
          </SelectContent>
        </Select>
        <Select value={symbolFilter} onValueChange={v => { setSymbolFilter(v); setPage(0) }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Simbolo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No hay transacciones</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Simbolo</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3 text-right">Cantidad</th>
                      <th className="p-3 text-right">Precio</th>
                      <th className="p-3 text-right">Comisiones</th>
                      <th className="p-3 text-right">Total</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(t => (
                      <tr key={t.id} className="border-b hover:bg-muted/50">
                        <td className="p-3 text-sm">{new Date(t.executed_at).toLocaleDateString('es-MX')}</td>
                        <td className="p-3 font-mono text-sm font-medium">{t.position.symbol}</td>
                        <td className="p-3"><Badge variant={TYPE_COLORS[t.type]}>{TYPE_LABELS[t.type]}</Badge></td>
                        <td className="p-3 text-right font-mono text-sm">{t.quantity}</td>
                        <td className="p-3 text-right font-mono text-sm">${t.price.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm">${t.fees.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm font-medium">${(t.quantity * t.price + t.fees).toFixed(2)}</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(t)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleting(t)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y">
                {paginated.map(t => (
                  <div key={t.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-sm">{t.position.symbol}</span>
                        <Badge variant={TYPE_COLORS[t.type]} className="text-xs">{TYPE_LABELS[t.type]}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(t)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{new Date(t.executed_at).toLocaleDateString('es-MX')}</span>
                      <span className="font-mono">{t.quantity} × ${t.price.toFixed(2)}</span>
                    </div>
                    <div className="text-right font-mono text-sm font-medium">${(t.quantity * t.price + t.fees).toFixed(2)}</div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    {filtered.length} transacciones
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit modal */}
      {editing && (
        <TransactionEditModal
          transaction={editing}
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null) }}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar transaccion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Eliminar esta transaccion de {deleting?.quantity} {deleting?.position.symbol}? Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add "Ver transacciones" link to portfolio detail page**

Modify `src/app/(app)/portfolio/[id]/page.tsx`. In the button group (around line 65-69), add a new Link before the Analytics link:

```typescript
import { BarChart3, List } from 'lucide-react'
```

Add between the `<div className="flex gap-2">` and the Analytics Link:
```typescript
<Link href={`/portfolio/${id}/transactions`}>
  <Button variant="outline" size="sm"><List className="h-4 w-4 mr-1" /> Transacciones</Button>
</Link>
```

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/portfolio/\[id\]/transactions/page.tsx src/components/portfolio/transaction-edit-modal.tsx src/app/\(app\)/portfolio/\[id\]/page.tsx
git commit -m "feat: transaction history page with filters, edit, and delete"
```

---

## Chunk 4: Watchlist Improvements

### Task 10: Watchlist API routes (DELETE + PATCH)

**Files:**
- Create: `src/app/api/watchlist/[id]/route.ts`
- Create: `src/lib/schemas/watchlist-manage.ts`

- [ ] **Step 1: Create the Zod schema for rename**

Create `src/lib/schemas/watchlist-manage.ts`:

```typescript
import { z } from 'zod'

export const RenameWatchlistSchema = z.object({
  name: z.string().min(1).max(50).transform(s => s.trim()),
})
```

- [ ] **Step 2: Create the watchlist [id] route**

Create `src/app/api/watchlist/[id]/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { RenameWatchlistSchema } from '@/lib/schemas/watchlist-manage'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Verify ownership
  const { data: wl } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!wl) return error('Watchlist not found', 404)

  // Delete items first (FK constraint), then watchlist
  await supabase.from('watchlist_items').delete().eq('watchlist_id', id)
  const { error: delErr } = await supabase.from('watchlists').delete().eq('id', id)
  if (delErr) return error(delErr.message, 500)

  return success({ deleted: true })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(RenameWatchlistSchema, body)
  if ('error' in result) return result.error

  const { error: updateErr } = await supabase
    .from('watchlists')
    .update({ name: result.data.name })
    .eq('id', id)
    .eq('user_id', user.id)
  if (updateErr) return error(updateErr.message, 500)

  return success({ updated: true })
}
```

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/watchlist/\[id\]/route.ts src/lib/schemas/watchlist-manage.ts
git commit -m "feat: watchlist DELETE and PATCH (rename) API endpoints"
```

---

### Task 11: Watchlist UI improvements (sort, rename, delete)

**Files:**
- Modify: `src/app/(app)/watchlist/page.tsx`

- [ ] **Step 1: Update the watchlist page with sorting, rename, and delete**

Replace the full content of `src/app/(app)/watchlist/page.tsx`. The key changes are:

1. Add `sortBy` state per watchlist (name, price, changePct)
2. Add inline rename (pencil icon → input → blur/Enter saves, Escape cancels)
3. Add delete button with confirmation dialog
4. Sort watchlist items client-side

Full replacement for `src/app/(app)/watchlist/page.tsx`:

```typescript
'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus, X, Search, TrendingUp, TrendingDown, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useState, useRef } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'

function WatchlistItemRow({ watchlistId, item }: { watchlistId: string; item: { id: string; symbol: string; asset_type: string } }) {
  const { data: quote, isLoading } = useQuote(item.symbol)
  const { mutate } = useSWRConfig()

  return (
    <div className="flex items-center justify-between py-2 px-1 hover:bg-muted/50 rounded">
      <Link href={`/market/${encodeURIComponent(item.symbol)}`} className="flex-1">
        <div className="flex items-center justify-between">
          <span className="font-mono font-medium text-sm">{item.symbol}</span>
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : quote ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{quote.price != null ? `$${quote.price.toFixed(2)}` : '--'}</span>
              {quote.changePct != null && (
                <span className={`text-xs flex items-center gap-0.5 ${quote.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
                </span>
              )}
            </div>
          ) : null}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 ml-2"
        onClick={async () => {
          await fetch(`/api/watchlist/${watchlistId}/${encodeURIComponent(item.symbol)}`, { method: 'DELETE' })
          mutate('/api/watchlist')
          toast.success('Eliminado de watchlist')
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}

export default function WatchlistPage() {
  const { data: watchlists, isLoading } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: searchResults, isLoading: searching } = useMarketSearch(searchQuery)
  const [sortBy, setSortBy] = useState<Record<string, string>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingWl, setDeletingWl] = useState<{ id: string; name: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  async function addSymbol(watchlistId: string, symbol: string) {
    const res = await fetch(`/api/watchlist/${watchlistId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, asset_type: 'stock' }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success(`${symbol} agregado`); mutate('/api/watchlist') }
    setAddingTo(null)
    setSearchQuery('')
  }

  async function handleRename(watchlistId: string) {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const res = await fetch(`/api/watchlist/${watchlistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Nombre actualizado'); mutate('/api/watchlist') }
    setRenamingId(null)
  }

  async function handleDeleteWatchlist() {
    if (!deletingWl) return
    setDeleteLoading(true)
    const res = await fetch(`/api/watchlist/${deletingWl.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist eliminada'); mutate('/api/watchlist') }
    setDeletingWl(null)
    setDeleteLoading(false)
  }

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input className="w-48" placeholder="Nueva watchlist..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          <Button size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {watchlists?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No tienes watchlists. Crea una para empezar a seguir activos.</p>
      )}

      {watchlists?.map((wl: { id: string; name: string; watchlist_items: Array<{ id: string; symbol: string; asset_type: string }> }) => (
        <Card key={wl.id}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              {renamingId === wl.id ? (
                <Input
                  ref={renameInputRef}
                  className="h-8 w-48"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(wl.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(wl.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  autoFocus
                />
              ) : (
                <>
                  <CardTitle className="text-lg">{wl.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name) }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select value={sortBy[wl.id] || 'default'} onValueChange={v => setSortBy(s => ({ ...s, [wl.id]: v }))}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Ordenar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Por defecto</SelectItem>
                  <SelectItem value="name">Nombre</SelectItem>
                  <SelectItem value="price">Precio</SelectItem>
                  <SelectItem value="change">Cambio %</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setAddingTo(addingTo === wl.id ? null : wl.id)}>
                <Plus className="h-3 w-3 mr-1" /> Agregar
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletingWl({ id: wl.id, name: wl.name })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {addingTo === wl.id && (
              <div className="mb-4 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar accion (ej: AAPL, TSLA)..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {searching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando...</div>}
                {searchResults?.map((r: { symbol: string; name: string }) => (
                  <div key={r.symbol} className="flex items-center justify-between p-2 border rounded hover:bg-muted cursor-pointer" onClick={() => addSymbol(wl.id, r.symbol)}>
                    <div>
                      <span className="font-mono font-medium text-sm">{r.symbol}</span>
                      <span className="text-xs text-muted-foreground ml-2">{r.name}</span>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}

            {wl.watchlist_items?.length === 0 && addingTo !== wl.id ? (
              <p className="text-sm text-muted-foreground">Sin activos. Haz click en &quot;Agregar&quot; para buscar y agregar activos.</p>
            ) : (
              <div className="divide-y">
                {wl.watchlist_items?.map(item => (
                  <WatchlistItemRow key={item.id} watchlistId={wl.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Delete confirmation */}
      <Dialog open={!!deletingWl} onOpenChange={(open) => { if (!open) setDeletingWl(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar watchlist</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Eliminar watchlist &quot;{deletingWl?.name}&quot; y todos sus activos? Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingWl(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteWatchlist} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

Note about sorting: The sort dropdown is wired for name sorting directly since symbol data is available. Price/change sorting requires quote data from each row — since quotes are fetched independently per `WatchlistItemRow`, these sort options show a "coming soon" note. In the items rendering section, replace:
```typescript
{wl.watchlist_items?.map(item => (
```
with:
```typescript
{[...(wl.watchlist_items || [])].sort((a, b) => {
  const sort = sortBy[wl.id]
  if (sort === 'name') return a.symbol.localeCompare(b.symbol)
  return 0 // default: insertion order
}).map(item => (
```

Also update the sort Select options to clarify:
```typescript
<SelectItem value="price">Precio (pronto)</SelectItem>
<SelectItem value="change">Cambio % (pronto)</SelectItem>
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/watchlist/page.tsx
git commit -m "feat: watchlist sort, inline rename, and delete with confirmation"
```

---

## Chunk 5: Final Verification & Deploy

### Task 12: Full build + test + deploy

- [ ] **Step 1: Run all tests**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Full production build**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build
```
Expected: Build succeeds with no errors.

- [ ] **Step 3: Apply database migration**

Run the SQL from `supabase/migrations/002_transactions_update_policy.sql` in the Supabase SQL editor. Verify by checking policies on the transactions table.

- [ ] **Step 4: Push to GitHub**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && git push origin main
```

- [ ] **Step 5: Deploy to Vercel**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx vercel --prod
```
Expected: Deployment succeeds.

- [ ] **Step 6: Verify deployed features**

Test each feature on the live deployment:
1. Dashboard chart shows portfolio performance data with period toggles
2. Currency values reflect live exchange rates (check if MXN rate differs from 17.5)
3. Portfolio detail → "Transacciones" button → list of transactions with filter/edit/delete
4. Watchlists → rename (pencil icon), delete (trash icon), sort dropdown
