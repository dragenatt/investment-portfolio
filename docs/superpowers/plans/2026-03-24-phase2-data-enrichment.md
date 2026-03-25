# Phase 2: Data Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the investment portfolio app with company fundamentals, market events, and an improved market overview using BigData MCP + Yahoo Finance.

**Architecture:** BigData MCP tools return rich markdown tearsheets. We parse key fields from `find_companies` (structured JSON) and `bigdata_company_tearsheet` (markdown) to populate Supabase cache tables (`company_data`, `market_events`). The Next.js API routes serve cached data with TTL checks, and a seeding script populates initial data. The frontend renders fundamentals grid, company info, events timeline, and enhanced market overview on the market detail page.

**Tech Stack:** Next.js 16 API routes, Supabase (PostgreSQL + RLS), BigData MCP (company_tearsheet, events_calendar, market_tearsheet, find_companies), SWR hooks, Recharts, Tailwind + shadcn/ui.

**Key constraint:** BigData MCP tools are only available in the Claude Code environment (not at Next.js runtime). The strategy is: (1) use a seeding API route that parses BigData markdown and stores structured data in Supabase, (2) serve from cache at runtime, (3) use Yahoo Finance as real-time fallback for price data.

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `supabase/migrations/003_phase2_data_enrichment.sql` | DB tables: company_data, market_events with RLS |
| `src/lib/services/bigdata-parser.ts` | Parse BigData markdown tearsheets into structured objects |
| `src/app/api/market/[symbol]/fundamentals/route.ts` | GET company fundamentals (serve from cache) |
| `src/app/api/market/[symbol]/events/route.ts` | GET market events for a symbol (serve from cache) |
| `src/app/api/market/overview/route.ts` | GET market overview (indices, sectors, movers) |
| `src/app/api/admin/seed-company/route.ts` | POST endpoint to seed company_data from parsed BigData |
| `src/app/api/admin/seed-events/route.ts` | POST endpoint to seed market_events from parsed BigData |
| `src/components/market/company-info.tsx` | "Sobre la empresa" expandable section |
| `src/components/market/fundamentals-grid.tsx` | P/E, Market Cap, EPS, 52W range grid |
| `src/components/market/competitors-list.tsx` | Competitor companies with price comparison |
| `src/components/market/events-timeline.tsx` | Upcoming events (earnings, dividends) |
| `src/components/market/market-overview-card.tsx` | Market index card with change % |
| `src/components/market/sector-performance.tsx` | Sector performance bars |
| `src/lib/hooks/use-fundamentals.ts` | SWR hook for fundamentals API |
| `src/lib/hooks/use-events.ts` | SWR hook for events API |
| `src/lib/hooks/use-market-overview.ts` | SWR hook for market overview |

### Modified Files
| File | Changes |
|------|---------|
| `src/app/(app)/market/[symbol]/page.tsx` | Add fundamentals, company info, competitors, events sections |
| `src/app/(app)/market/page.tsx` | Add market overview with indices, sectors |
| `src/lib/services/market.ts` | Add `getQuoteDetails()` for extended Yahoo data |

---

## Chunk 1: Database & Parsing Foundation

### Task 1: Create Database Migration

**Files:**
- Create: `supabase/migrations/003_phase2_data_enrichment.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Company fundamentals cache
CREATE TABLE IF NOT EXISTS company_data (
  symbol TEXT PRIMARY KEY,
  rp_entity_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sector TEXT,
  industry TEXT,
  market_cap BIGINT,
  pe_ratio NUMERIC,
  eps NUMERIC,
  dividend_yield NUMERIC,
  week52_high NUMERIC,
  week52_low NUMERIC,
  employees INTEGER,
  ceo TEXT,
  hq TEXT,
  website TEXT,
  competitors JSONB DEFAULT '[]',
  analyst_rating TEXT,
  analyst_target_price NUMERIC,
  revenue_ttm BIGINT,
  net_income_ttm BIGINT,
  raw_data JSONB DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Market events cache (earnings, dividends, etc.)
CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('earnings', 'dividend', 'split', 'conference')),
  event_date DATE NOT NULL,
  title TEXT,
  description TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
  UNIQUE(symbol, event_type, event_date)
);

CREATE INDEX idx_market_events_symbol ON market_events(symbol);
CREATE INDEX idx_market_events_date ON market_events(event_date);
CREATE INDEX idx_company_data_expires ON company_data(expires_at);

-- RLS: read for authenticated users
ALTER TABLE company_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_data_read" ON company_data FOR SELECT TO authenticated USING (true);

ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_events_read" ON market_events FOR SELECT TO authenticated USING (true);

-- Service role can insert/update (for seeding)
CREATE POLICY "company_data_service_write" ON company_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "market_events_service_write" ON market_events FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run: `mcp__8ad6669e-d158-42b9-aab0-eb51921d71d1__apply_migration` with the SQL above.
Expected: Tables created successfully.

- [ ] **Step 3: Verify tables exist**

Run: `mcp__8ad6669e-d158-42b9-aab0-eb51921d71d1__list_tables`
Expected: `company_data` and `market_events` appear in the table list.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_phase2_data_enrichment.sql
git commit -m "feat: add company_data and market_events tables for Phase 2"
```

---

### Task 2: BigData Markdown Parser

**Files:**
- Create: `src/lib/services/bigdata-parser.ts`

- [ ] **Step 1: Create parser for company tearsheet markdown**

The BigData `bigdata_company_tearsheet` tool returns a large markdown document. We need to extract structured fields. The parser uses regex to extract key sections.

```typescript
export type ParsedCompanyData = {
  name: string
  description: string
  sector: string
  industry: string
  market_cap: number | null
  pe_ratio: number | null
  eps: number | null
  dividend_yield: number | null
  week52_high: number | null
  week52_low: number | null
  employees: number | null
  ceo: string | null
  hq: string | null
  website: string | null
  analyst_rating: string | null
  analyst_target_price: number | null
  revenue_ttm: number | null
  net_income_ttm: number | null
  competitors: string[]
}

export function parseCompanyTearsheet(markdown: string): ParsedCompanyData {
  const extract = (label: string): string | null => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i')
    const m = markdown.match(re)
    return m ? m[1].trim() : null
  }

  const extractNum = (label: string): number | null => {
    const val = extract(label)
    if (!val) return null
    const cleaned = val.replace(/[$,%BM]/g, '').replace(/,/g, '').trim()
    const num = parseFloat(cleaned)
    return isNaN(num) ? null : num
  }

  const extractBillions = (label: string): number | null => {
    const val = extract(label)
    if (!val) return null
    const m = val.match(/([\d,.]+)\s*([BM])?/)
    if (!m) return null
    let num = parseFloat(m[1].replace(/,/g, ''))
    if (m[2] === 'B') num *= 1_000_000_000
    else if (m[2] === 'M') num *= 1_000_000
    return isNaN(num) ? null : num
  }

  // Extract name from title
  const nameMatch = markdown.match(/^#\s+(.+)$/m)
  const name = nameMatch ? nameMatch[1].trim() : ''

  // Extract description
  const descMatch = markdown.match(/### Description\n(.+?)(\n\n|$)/s)
  const description = descMatch ? descMatch[1].trim() : ''

  // Extract competitors from table
  const competitors: string[] = []
  const compSection = markdown.match(/## Competitors[\s\S]*?\n\n/i)
  if (compSection) {
    const tickerMatches = compSection[0].matchAll(/\|\s*(\w{1,5})\s*\|/g)
    for (const tm of tickerMatches) {
      if (tm[1] !== 'Symbol' && tm[1] !== '---') competitors.push(tm[1])
    }
  }

  // Extract analyst consensus
  const consensusMatch = markdown.match(/\*\*Consensus:\*\*\s*(\w+)/i)
  const analyst_rating = consensusMatch ? consensusMatch[1] : null

  const targetMatch = markdown.match(/\*\*Consensus:\*\*\s*\$([\d,.]+)/i)
  const analyst_target_price = targetMatch ? parseFloat(targetMatch[1].replace(/,/g, '')) : null

  return {
    name,
    description,
    sector: extract('Sector') ?? '',
    industry: extract('Industry') ?? '',
    market_cap: extractBillions('Market Cap'),
    pe_ratio: extractNum('P/E Ratio') ?? (() => {
      // Fallback: look in Financial Ratios table
      const peMatch = markdown.match(/\| P\/E Ratio \| ([\d.]+)x/)
      return peMatch ? parseFloat(peMatch[1]) : null
    })(),
    eps: (() => {
      const epsMatch = markdown.match(/\*\*Actual:\*\*\s*\$([\d.]+)/)
      return epsMatch ? parseFloat(epsMatch[1]) : null
    })(),
    dividend_yield: (() => {
      const dyMatch = markdown.match(/\| Dividend Yield \| ([\d.]+)%/)
      return dyMatch ? parseFloat(dyMatch[1]) : null
    })(),
    week52_high: extractNum('52-Week High'),
    week52_low: extractNum('52-Week Low'),
    employees: (() => {
      const empVal = extract('Employees')
      if (!empVal) return null
      return parseInt(empVal.replace(/,/g, ''), 10) || null
    })(),
    ceo: extract('CEO'),
    hq: extract('Country'),
    website: extract('Website'),
    analyst_rating,
    analyst_target_price,
    revenue_ttm: (() => {
      // Sum last 4 quarters of revenue from Income Statement
      const revMatches = [...markdown.matchAll(/\| Revenue \| ([\$\d,.B]+)/g)]
      if (revMatches.length === 0) return null
      // First match in the Income Statement table row has the TTM values
      return null // Will be populated from raw_data
    })(),
    net_income_ttm: null,
    competitors,
  }
}

export type ParsedEvent = {
  symbol: string
  event_type: 'earnings' | 'dividend' | 'conference'
  event_date: string
  title: string
  description: string
}

export function parseEventsCalendar(markdown: string): ParsedEvent[] {
  const events: ParsedEvent[] = []

  // Parse earnings section
  const earningsSection = markdown.match(/## .*Earnings.*\n\n([\s\S]*?)(?=\n## |$)/i)
  if (earningsSection) {
    const rows = earningsSection[1].matchAll(
      /\|\s*(\w+)\s*\|\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|/g
    )
    for (const row of rows) {
      if (row[1] === 'TICKER' || row[1].startsWith('-')) continue
      events.push({
        symbol: row[1],
        event_type: 'earnings',
        event_date: row[3],
        title: `${row[2].trim()} Earnings (${row[5]})`,
        description: `Earnings call: ${row[4].trim()}`,
      })
    }
  }

  // Parse conferences section
  const confSection = markdown.match(/## .*Conference.*\n\n([\s\S]*?)(?=\n## |$)/i)
  if (confSection) {
    const rows = confSection[1].matchAll(
      /\|\s*(\w+)\s*\|\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g
    )
    for (const row of rows) {
      if (row[1] === 'TICKER' || row[1].startsWith('-')) continue
      events.push({
        symbol: row[1],
        event_type: 'conference',
        event_date: row[3],
        title: row[5].trim(),
        description: `${row[2].trim()} - ${row[4].trim()}`,
      })
    }
  }

  return events
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/services/bigdata-parser.ts
git commit -m "feat: add BigData markdown tearsheet parser"
```

---

### Task 3: Seeding API Routes

**Files:**
- Create: `src/app/api/admin/seed-company/route.ts`
- Create: `src/app/api/admin/seed-events/route.ts`

These endpoints accept parsed BigData data and upsert into Supabase. They're called by Claude after running BigData MCP tools.

- [ ] **Step 1: Create seed-company route**

```typescript
// src/app/api/admin/seed-company/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const { symbol, rp_entity_id, ...rest } = body

  if (!symbol) return error('symbol required', 400)

  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data, error: dbError } = await supabase
    .from('company_data')
    .upsert({
      symbol: symbol.toUpperCase(),
      rp_entity_id,
      ...rest,
      fetched_at: new Date().toISOString(),
      expires_at,
    }, { onConflict: 'symbol' })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, 'Company data seeded')
}
```

- [ ] **Step 2: Create seed-events route**

```typescript
// src/app/api/admin/seed-events/route.ts
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const { events } = body

  if (!Array.isArray(events) || events.length === 0) return error('events array required', 400)

  const expires_at = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()

  const rows = events.map((e: Record<string, unknown>) => ({
    symbol: (e.symbol as string).toUpperCase(),
    event_type: e.event_type,
    event_date: e.event_date,
    title: e.title || '',
    description: e.description || '',
    fetched_at: new Date().toISOString(),
    expires_at,
  }))

  const { data, error: dbError } = await supabase
    .from('market_events')
    .upsert(rows, { onConflict: 'symbol,event_type,event_date' })
    .select()

  if (dbError) return error(dbError.message, 500)
  return success(data, `${rows.length} events seeded`)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/seed-company/route.ts src/app/api/admin/seed-events/route.ts
git commit -m "feat: add admin seeding API routes for company data and events"
```

---

## Chunk 2: API Routes & Hooks

### Task 4: Fundamentals API Route

**Files:**
- Create: `src/app/api/market/[symbol]/fundamentals/route.ts`

- [ ] **Step 1: Create fundamentals endpoint**

Serves company_data from cache. If expired or missing, returns partial data from Yahoo quote.

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { symbol } = await params

  // Check cache
  const { data: cached } = await supabase
    .from('company_data')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single()

  if (cached) return success(cached)

  // Fallback: return whatever we have even if expired
  const { data: stale } = await supabase
    .from('company_data')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .single()

  if (stale) return success({ ...stale, _stale: true })

  // No cache at all: return basic quote data
  const quote = await getQuote(symbol)
  if (!quote) return error('Symbol not found', 404)

  return success({
    symbol: quote.symbol,
    name: quote.symbol,
    market_cap: null,
    pe_ratio: null,
    eps: null,
    dividend_yield: null,
    week52_high: null,
    week52_low: null,
    _partial: true,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/market/[symbol]/fundamentals/route.ts
git commit -m "feat: add fundamentals API endpoint with cache + fallback"
```

---

### Task 5: Events API Route

**Files:**
- Create: `src/app/api/market/[symbol]/events/route.ts`

- [ ] **Step 1: Create events endpoint**

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { symbol } = await params

  const { data: events } = await supabase
    .from('market_events')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .gte('event_date', new Date().toISOString().slice(0, 10))
    .order('event_date', { ascending: true })
    .limit(10)

  return success(events ?? [])
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/market/[symbol]/events/route.ts
git commit -m "feat: add events API endpoint for upcoming market events"
```

---

### Task 6: Market Overview API Route

**Files:**
- Create: `src/app/api/market/overview/route.ts`

- [ ] **Step 1: Create market overview endpoint**

Fetches quotes for major indices and popular stocks in a single batch.

```typescript
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

const INDICES = [
  { symbol: '^GSPC', name: 'S&P 500', region: 'US' },
  { symbol: '^DJI', name: 'Dow Jones', region: 'US' },
  { symbol: '^IXIC', name: 'NASDAQ', region: 'US' },
  { symbol: '^MXX', name: 'IPC Mexico', region: 'MX' },
  { symbol: '^FTSE', name: 'FTSE 100', region: 'UK' },
  { symbol: '^N225', name: 'Nikkei 225', region: 'JP' },
]

const SECTORS = [
  { symbol: 'XLK', name: 'Tecnología' },
  { symbol: 'XLF', name: 'Financiero' },
  { symbol: 'XLV', name: 'Salud' },
  { symbol: 'XLE', name: 'Energía' },
  { symbol: 'XLY', name: 'Consumo Disc.' },
  { symbol: 'XLI', name: 'Industrial' },
  { symbol: 'XLP', name: 'Consumo Básico' },
  { symbol: 'XLU', name: 'Servicios Pub.' },
  { symbol: 'XLRE', name: 'Inmobiliario' },
  { symbol: 'XLB', name: 'Materiales' },
  { symbol: 'XLC', name: 'Comunicaciones' },
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const [indexQuotes, sectorQuotes] = await Promise.all([
    Promise.all(INDICES.map(async (idx) => {
      const q = await getQuote(idx.symbol)
      return q ? { ...idx, price: q.price, change: q.change, changePct: q.changePct } : { ...idx, price: 0, change: 0, changePct: 0 }
    })),
    Promise.all(SECTORS.map(async (sec) => {
      const q = await getQuote(sec.symbol)
      return q ? { ...sec, price: q.price, change: q.change, changePct: q.changePct } : { ...sec, price: 0, change: 0, changePct: 0 }
    })),
  ])

  return success({ indices: indexQuotes, sectors: sectorQuotes })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/market/overview/route.ts
git commit -m "feat: add market overview API with indices and sectors"
```

---

### Task 7: SWR Hooks

**Files:**
- Create: `src/lib/hooks/use-fundamentals.ts`
- Create: `src/lib/hooks/use-events.ts`
- Create: `src/lib/hooks/use-market-overview.ts`

- [ ] **Step 1: Create all three hooks**

```typescript
// src/lib/hooks/use-fundamentals.ts
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useFundamentals(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/fundamentals` : null,
    fetcher,
    { refreshInterval: 300_000 } // 5 min
  )
}
```

```typescript
// src/lib/hooks/use-events.ts
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useEvents(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/events` : null,
    fetcher,
    { refreshInterval: 600_000 } // 10 min
  )
}
```

```typescript
// src/lib/hooks/use-market-overview.ts
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useMarketOverview() {
  return useSWR('/api/market/overview', fetcher, {
    refreshInterval: 60_000, // 1 min
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/hooks/use-fundamentals.ts src/lib/hooks/use-events.ts src/lib/hooks/use-market-overview.ts
git commit -m "feat: add SWR hooks for fundamentals, events, and market overview"
```

---

## Chunk 3: Frontend Components

### Task 8: Company Info Component

**Files:**
- Create: `src/components/market/company-info.tsx`

- [ ] **Step 1: Create expandable company info section**

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, Users, Globe, MapPin } from 'lucide-react'
import { useState } from 'react'

type Props = {
  name: string
  description: string | null
  ceo: string | null
  employees: number | null
  hq: string | null
  website: string | null
  sector: string | null
  industry: string | null
}

export function CompanyInfo({ name, description, ceo, employees, hq, website, sector, industry }: Props) {
  const [expanded, setExpanded] = useState(false)
  const truncated = description && description.length > 200
    ? description.slice(0, 200) + '...'
    : description

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Sobre {name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {description && (
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {expanded ? description : truncated}
            </p>
            {description.length > 200 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-primary font-medium mt-1 hover:underline"
              >
                {expanded ? 'Ver menos' : 'Ver más'}
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {ceo && (
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">CEO</p>
                <p className="font-medium">{ceo}</p>
              </div>
            </div>
          )}
          {employees && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Empleados</p>
                <p className="font-medium">{employees.toLocaleString()}</p>
              </div>
            </div>
          )}
          {hq && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">País</p>
                <p className="font-medium">{hq}</p>
              </div>
            </div>
          )}
          {website && (
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Web</p>
                <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline truncate block max-w-[140px]">
                  {website.replace(/https?:\/\/(www\.)?/, '')}
                </a>
              </div>
            </div>
          )}
        </div>
        {(sector || industry) && (
          <div className="flex gap-2 flex-wrap">
            {sector && <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{sector}</span>}
            {industry && <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">{industry}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/market/company-info.tsx
git commit -m "feat: add CompanyInfo component for market detail page"
```

---

### Task 9: Fundamentals Grid Component

**Files:**
- Create: `src/components/market/fundamentals-grid.tsx`

- [ ] **Step 1: Create fundamentals grid**

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  marketCap: number | null
  peRatio: number | null
  eps: number | null
  dividendYield: number | null
  week52High: number | null
  week52Low: number | null
  currentPrice?: number
  analystRating: string | null
  analystTarget: number | null
}

function formatLargeNumber(n: number | null): string {
  if (n == null) return '--'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

export function FundamentalsGrid({
  marketCap, peRatio, eps, dividendYield,
  week52High, week52Low, currentPrice,
  analystRating, analystTarget,
}: Props) {
  const metrics = [
    { label: 'Cap. de Mercado', value: formatLargeNumber(marketCap) },
    { label: 'P/E Ratio', value: peRatio != null ? `${peRatio.toFixed(2)}x` : '--' },
    { label: 'EPS (TTM)', value: eps != null ? `$${eps.toFixed(2)}` : '--' },
    { label: 'Div. Yield', value: dividendYield != null ? `${dividendYield.toFixed(2)}%` : '--' },
    { label: '52W Alto', value: week52High != null ? `$${week52High.toFixed(2)}` : '--' },
    { label: '52W Bajo', value: week52Low != null ? `$${week52Low.toFixed(2)}` : '--' },
    { label: 'Consenso', value: analystRating ?? '--' },
    { label: 'Precio Obj.', value: analystTarget != null ? `$${analystTarget.toFixed(2)}` : '--' },
  ]

  // 52-week range bar
  const rangePercent = (week52High && week52Low && currentPrice)
    ? ((currentPrice - week52Low) / (week52High - week52Low)) * 100
    : null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Fundamentales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {metrics.map(m => (
            <div key={m.label}>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="font-semibold text-sm font-mono">{m.value}</p>
            </div>
          ))}
        </div>
        {rangePercent != null && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>${week52Low?.toFixed(2)}</span>
              <span>Rango 52 semanas</span>
              <span>${week52High?.toFixed(2)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(0, rangePercent))}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/market/fundamentals-grid.tsx
git commit -m "feat: add FundamentalsGrid component with 52W range bar"
```

---

### Task 10: Events Timeline Component

**Files:**
- Create: `src/components/market/events-timeline.tsx`

- [ ] **Step 1: Create events timeline**

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, TrendingUp, DollarSign, Megaphone } from 'lucide-react'

type MarketEvent = {
  id: string
  event_type: 'earnings' | 'dividend' | 'split' | 'conference'
  event_date: string
  title: string
  description: string
}

const EVENT_ICONS = {
  earnings: TrendingUp,
  dividend: DollarSign,
  split: Calendar,
  conference: Megaphone,
}

const EVENT_LABELS = {
  earnings: 'Reporte',
  dividend: 'Dividendo',
  split: 'Split',
  conference: 'Conferencia',
}

export function EventsTimeline({ events }: { events: MarketEvent[] }) {
  if (events.length === 0) {
    return (
      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Próximos Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Sin eventos próximos</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Próximos Eventos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event) => {
            const Icon = EVENT_ICONS[event.event_type] || Calendar
            const label = EVENT_LABELS[event.event_type] || event.event_type
            const date = new Date(event.event_date + 'T00:00:00')
            const formatted = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })
            const daysUntil = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

            return (
              <div key={event.id} className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-primary">{label}</span>
                    <span className="text-xs text-muted-foreground">{formatted}</span>
                    {daysUntil > 0 && daysUntil <= 7 && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        en {daysUntil}d
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate">{event.title}</p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/market/events-timeline.tsx
git commit -m "feat: add EventsTimeline component for market detail page"
```

---

### Task 11: Sector Performance Component

**Files:**
- Create: `src/components/market/sector-performance.tsx`

- [ ] **Step 1: Create sector performance bars**

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type SectorData = {
  name: string
  symbol: string
  changePct: number
}

export function SectorPerformance({ sectors }: { sectors: SectorData[] }) {
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct)
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.changePct)), 1)

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Rendimiento por Sector (1D)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map(sector => {
          const isPositive = sector.changePct >= 0
          const width = (Math.abs(sector.changePct) / maxAbs) * 100

          return (
            <div key={sector.symbol} className="flex items-center gap-2">
              <span className="text-xs w-28 truncate text-muted-foreground">{sector.name}</span>
              <div className="flex-1 h-5 bg-muted/50 rounded-md overflow-hidden relative">
                <div
                  className={`h-full rounded-md transition-all ${isPositive ? 'bg-gain/20' : 'bg-loss/20'}`}
                  style={{ width: `${Math.max(2, width)}%` }}
                />
              </div>
              <span className={`text-xs font-mono w-16 text-right ${isPositive ? 'text-gain' : 'text-loss'}`}>
                {isPositive ? '+' : ''}{sector.changePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/market/sector-performance.tsx
git commit -m "feat: add SectorPerformance component with horizontal bars"
```

---

## Chunk 4: Page Integration

### Task 12: Enhanced Market Detail Page

**Files:**
- Modify: `src/app/(app)/market/[symbol]/page.tsx`

- [ ] **Step 1: Add fundamentals, company info, and events to market detail**

Read the current file, then add the new sections below the existing price chart. The layout:
- Row 1: Price + Chart (existing)
- Row 2: FundamentalsGrid (full width)
- Row 3: CompanyInfo (2/3) + EventsTimeline (1/3)

Import the new hooks and components, call `useFundamentals(symbol)` and `useEvents(symbol)`, and render them below the existing chart section. Wrap each in an `ErrorBoundary`.

Key integration points:
- `useFundamentals` provides: name, description, ceo, employees, hq, website, sector, industry, market_cap, pe_ratio, eps, dividend_yield, week52_high, week52_low, analyst_rating, analyst_target_price
- `useEvents` provides: array of events with event_type, event_date, title, description
- Pass `currentPrice` from the existing `useQuote` hook to `FundamentalsGrid` for the 52W range bar

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/market/[symbol]/page.tsx
git commit -m "feat: integrate fundamentals, company info, and events into market detail"
```

---

### Task 13: Enhanced Market Overview Page

**Files:**
- Modify: `src/app/(app)/market/page.tsx`

- [ ] **Step 1: Add sector performance to market page**

Read the current file. Add the `SectorPerformance` component below the existing indices section. Use `useMarketOverview()` hook to get both indices and sectors data. Replace the hardcoded index cards with data from the overview API.

Key changes:
- Import `useMarketOverview` and `SectorPerformance`
- Call `useMarketOverview()` at the top of the component
- Render index cards from `overview.indices`
- Add `<SectorPerformance sectors={overview.sectors} />` below indices

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/market/page.tsx
git commit -m "feat: enhance market page with overview API and sector performance"
```

---

## Chunk 5: Data Seeding & Deployment

### Task 14: Seed Initial Data via BigData MCP

No files to create — this is a manual step using BigData MCP tools.

- [ ] **Step 1: Seed company data for portfolio symbols**

For each symbol in the user's portfolio (AAPL, MSFT, VOO) plus popular symbols (GOOGL, AMZN, TSLA, NVDA, META, NFLX):

1. Call `find_companies` with the symbol to get `rp_entity_id` and `company_type`
2. Call `bigdata_company_tearsheet` with the entity ID
3. Parse the markdown response using `parseCompanyTearsheet()`
4. POST to `/api/admin/seed-company` with the parsed data

- [ ] **Step 2: Seed upcoming events**

1. Call `bigdata_events_calendar` with `countries: ["US", "MX"]`, `start_date: today`, `end_date: today + 30 days`
2. Parse the markdown response using `parseEventsCalendar()`
3. POST to `/api/admin/seed-events` with the parsed events

- [ ] **Step 3: Verify data in Supabase**

Run `execute_sql`: `SELECT symbol, name, sector, pe_ratio FROM company_data`
Expected: See rows for AAPL, MSFT, VOO, etc.

Run `execute_sql`: `SELECT symbol, event_type, event_date, title FROM market_events LIMIT 10`
Expected: See upcoming earnings and conference events.

---

### Task 15: Deploy and Verify

- [ ] **Step 1: Push all changes**

```bash
git push origin master
```

- [ ] **Step 2: Deploy to Vercel**

```bash
npx vercel --prod --yes
```

- [ ] **Step 3: Verify all pages via Playwright**

Test the full user flow:
1. Login → Dashboard (verify KPIs, chart, top movers with arrows)
2. Navigate to Market → verify indices + sector performance bars
3. Click on a symbol (AAPL) → verify fundamentals grid, company info, events timeline
4. Navigate to Portfolio → verify positions with correct data
5. Check all pages for zero console errors

Expected: All data renders correctly, no errors, warm palette consistent.

- [ ] **Step 4: Final commit if any hotfixes needed**

```bash
git commit -m "fix: Phase 2 deployment hotfixes"
```

---

## Summary

| Chunk | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-3 | Database migration, BigData parser, seeding routes |
| 2 | 4-7 | API routes (fundamentals, events, overview) + SWR hooks |
| 3 | 8-11 | Frontend components (CompanyInfo, FundamentalsGrid, EventsTimeline, SectorPerformance) |
| 4 | 12-13 | Page integration (market detail + market overview) |
| 5 | 14-15 | Data seeding via BigData MCP + deployment + verification |
