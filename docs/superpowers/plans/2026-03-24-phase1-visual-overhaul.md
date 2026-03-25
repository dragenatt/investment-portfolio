# Phase 1: Visual Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the investment portfolio app from a generic dark-themed UI to a premium warm cream/beige financial app, redesigning every page for a Fintual/GBM+ aesthetic.

**Architecture:** Replace all OKLch CSS variables in globals.css with hex warm palette values mapped to shadcn/ui token names. Restyle all layout components (sidebar, mobile nav, header). Rewrite landing page. Redesign dashboard with animated KPIs and recent activity feed. Polish all other pages with consistent warm styling.

**Tech Stack:** Next.js 16, Tailwind CSS v4, shadcn/ui, Recharts, `@number-flow/react`, Lucide icons, SWR.

**Spec:** `docs/superpowers/specs/2026-03-24-visual-overhaul-design.md`

---

## Chunk 1: Theme + Navigation Foundation

### Task 1: Warm palette CSS variables

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace `:root` light theme variables**

In `src/app/globals.css`, replace the entire `:root { ... }` block (lines 51-84) with:

```css
:root {
  --background: #FEFCF8;
  --foreground: #1C1917;
  --card: #FFFDF7;
  --card-foreground: #1C1917;
  --popover: #FFFDF7;
  --popover-foreground: #1C1917;
  --primary: #B45309;
  --primary-foreground: #FFFDF7;
  --secondary: #F5F0E8;
  --secondary-foreground: #1C1917;
  --muted: #F5F0E8;
  --muted-foreground: #78716C;
  --accent: #F5F0E8;
  --accent-foreground: #1C1917;
  --destructive: #C2410C;
  --border: #E8E0D0;
  --input: #E8E0D0;
  --ring: #D97706;
  --chart-1: #D97706;
  --chart-2: #4D7C0F;
  --chart-3: #B45309;
  --chart-4: #78716C;
  --chart-5: #C2410C;
  --radius: 0.75rem;
  --sidebar: #F5F0E8;
  --sidebar-foreground: #1C1917;
  --sidebar-primary: #B45309;
  --sidebar-primary-foreground: #FFFDF7;
  --sidebar-accent: #FEFCF8;
  --sidebar-accent-foreground: #1C1917;
  --sidebar-border: #E8E0D0;
  --sidebar-ring: #D97706;
  /* Custom app tokens */
  --gain: #4D7C0F;
  --loss: #C2410C;
  --chart-line: #D97706;
  --chart-fill-start: rgba(217,119,6,0.15);
  --chart-fill-end: rgba(217,119,6,0);
  --shimmer: #F5F0E8;
  --gradient-hero-start: #FEFCF8;
  --gradient-hero-end: #FEF3E2;
}
```

- [ ] **Step 2: Replace `.dark` theme variables**

Replace the `.dark { ... }` block (lines 86-109) with:

```css
.dark {
  --background: #1C1917;
  --foreground: #FEFCF8;
  --card: #292524;
  --card-foreground: #FEFCF8;
  --popover: #292524;
  --popover-foreground: #FEFCF8;
  --primary: #D97706;
  --primary-foreground: #1C1917;
  --secondary: #292524;
  --secondary-foreground: #FEFCF8;
  --muted: #292524;
  --muted-foreground: #A8A29E;
  --accent: #292524;
  --accent-foreground: #FEFCF8;
  --destructive: #EF4444;
  --border: #44403C;
  --input: #44403C;
  --ring: #D97706;
  --chart-1: #D97706;
  --chart-2: #4D7C0F;
  --chart-3: #F59E0B;
  --chart-4: #A8A29E;
  --chart-5: #EF4444;
  --sidebar: #1C1917;
  --sidebar-foreground: #FEFCF8;
  --sidebar-primary: #D97706;
  --sidebar-primary-foreground: #1C1917;
  --sidebar-accent: #292524;
  --sidebar-accent-foreground: #FEFCF8;
  --sidebar-border: #44403C;
  --sidebar-ring: #D97706;
  --gain: #4ADE80;
  --loss: #EF4444;
  --chart-line: #D97706;
  --chart-fill-start: rgba(217,119,6,0.2);
  --chart-fill-end: rgba(217,119,6,0);
  --shimmer: #292524;
  --gradient-hero-start: #1C1917;
  --gradient-hero-end: #292524;
}
```

- [ ] **Step 3: Add custom color utilities to @theme inline block**

After the existing `@theme inline` block's last entry (before the closing `}`), add:

```css
  --color-gain: var(--gain);
  --color-loss: var(--loss);
```

This lets you use `text-gain` and `text-loss` in Tailwind classes.

- [ ] **Step 4: Build to verify no CSS errors**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: warm cream/beige color palette replacing OKLch theme"
```

---

### Task 2: Sidebar redesign

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Update sidebar with warm styling and Alertas link**

Replace the full content of `src/components/layout/sidebar.tsx` with:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Bell, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portafolios', icon: Briefcase },
  { href: '/market', label: 'Mercados', icon: TrendingUp },
  { href: '/watchlist', label: 'Watchlists', icon: Eye },
  { href: '/alerts', label: 'Alertas', icon: Bell },
  { href: '/settings', label: 'Ajustes', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside className={cn(
      'hidden md:flex flex-col border-r bg-sidebar transition-all duration-300',
      collapsed ? 'w-16' : 'w-60'
    )}>
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        {!collapsed && <span className="font-bold text-lg text-sidebar-foreground">InvestTracker</span>}
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="text-sidebar-foreground hover:bg-sidebar-accent">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors',
              pathname.startsWith(item.href)
                ? 'bg-sidebar-accent text-sidebar-primary font-medium border-l-2 border-sidebar-primary'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
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

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: sidebar warm redesign with Alertas link"
```

---

### Task 3: Mobile bottom nav redesign

**Files:**
- Modify: `src/components/layout/mobile-nav.tsx`

- [ ] **Step 1: Update mobile nav with Alertas tab, remove Settings**

Replace the full content of `src/components/layout/mobile-nav.tsx` with:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Bell } from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portafolio', icon: Briefcase },
  { href: '/market', label: 'Mercados', icon: TrendingUp },
  { href: '/watchlist', label: 'Watch', icon: Eye },
  { href: '/alerts', label: 'Alertas', icon: Bell },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50">
      <div className="flex justify-around py-2">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors',
              pathname.startsWith(item.href)
                ? 'text-primary font-medium'
                : 'text-muted-foreground'
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

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/mobile-nav.tsx
git commit -m "feat: mobile nav with Alertas tab, warm styling"
```

---

### Task 4: Header warm restyle

**Files:**
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Update header with warm card background and settings gear on mobile**

Replace the full content of `src/components/layout/header.tsx` with:

```typescript
'use client'

import { ThemeToggle } from './theme-toggle'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, Search, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Link from 'next/link'

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
    <header className="flex items-center justify-between px-4 h-14 border-b border-border bg-card">
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground border-border hover:bg-secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Buscar...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-secondary px-1.5 text-xs text-muted-foreground">⌘K</kbd>
      </Button>

      <div className="flex items-center gap-2">
        <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
          <SelectTrigger className="w-20 h-8 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MXN">MXN</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>

        <ThemeToggle />

        <Link href="/settings" className="md:hidden">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground">
            <Settings className="h-4 w-4" />
          </Button>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium transition-colors hover:bg-secondary h-9 w-9">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-sm">U</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/header.tsx
git commit -m "feat: header warm restyle with mobile settings gear"
```

---

### Task 5: Breadcrumbs component

**Files:**
- Create: `src/components/shared/breadcrumbs.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Create breadcrumbs component**

Create `src/components/shared/breadcrumbs.tsx`:

```typescript
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  portfolio: 'Portafolios',
  market: 'Mercados',
  watchlist: 'Watchlists',
  alerts: 'Alertas',
  settings: 'Ajustes',
  transactions: 'Transacciones',
  analytics: 'Analytics',
  new: 'Nuevo',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1) return null

  const crumbs = segments.map((segment, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = LABELS[segment] || decodeURIComponent(segment)
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          {crumb.isLast ? (
            <span className="text-foreground font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Add breadcrumbs to app layout**

In `src/app/(app)/layout.tsx`, add the import:

```typescript
import { Breadcrumbs } from '@/components/shared/breadcrumbs'
```

Then add `<Breadcrumbs />` as the first child inside the `<main>` content area, before `{children}`.

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/breadcrumbs.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: breadcrumbs navigation for nested pages"
```

---

## Chunk 2: Landing Page

### Task 6: Landing page full rewrite

**Files:**
- Modify: `src/app/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite landing page with warm palette and animated mockup**

Replace the full content of `src/app/page.tsx` with:

```typescript
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { TrendingUp, BarChart3, Bell, Globe, FileSpreadsheet } from 'lucide-react'

const features = [
  {
    icon: TrendingUp,
    title: 'Mercados en Vivo',
    description: 'Precios actualizados de NYSE, NASDAQ y BMV con graficos interactivos.',
  },
  {
    icon: BarChart3,
    title: 'Analisis Inteligente',
    description: 'Rendimiento historico, distribucion de activos, riesgo y benchmarks.',
  },
  {
    icon: Bell,
    title: 'Alertas Personalizadas',
    description: 'Recibe notificaciones cuando tus activos alcanzan el precio objetivo.',
  },
  {
    icon: Globe,
    title: 'Multi-Moneda',
    description: 'Opera en MXN, USD y EUR con tipos de cambio en tiempo real.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, var(--gradient-hero-start) 0%, var(--gradient-hero-end) 50%, var(--background) 100%)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <span className="font-bold text-xl text-foreground">InvestTracker</span>
        <div className="flex gap-3">
          <Link href="/login">
            <Button variant="ghost" className="text-foreground/70 hover:text-foreground hover:bg-secondary">
              Iniciar sesion
            </Button>
          </Link>
          <Link href="/register">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl">
              Registrarse
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center pt-16 pb-12 px-6">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-foreground">
          Tu portafolio de inversiones,{' '}
          <span className="text-primary">en un solo lugar</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
          Rastrea tus inversiones de GBM+, analiza mercados en tiempo real, y toma mejores decisiones financieras.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/register">
            <Button size="lg" className="text-lg px-8 py-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
              Empezar gratis
            </Button>
          </Link>
          <Link href="/market">
            <Button size="lg" variant="outline" className="text-lg px-8 py-6 rounded-xl border-border hover:bg-secondary">
              Ver mercados
            </Button>
          </Link>
        </div>
      </section>

      {/* Dashboard Mockup */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="bg-card rounded-2xl border border-border shadow-xl shadow-foreground/5 p-6 md:p-8">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
              <p className="text-xl font-bold font-mono text-foreground">$847,231.50</p>
              <p className="text-xs text-[var(--gain)]">+2.4% hoy</p>
            </div>
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Ganancia Total</p>
              <p className="text-xl font-bold font-mono text-[var(--gain)]">+$123,456.00</p>
              <p className="text-xs text-muted-foreground">+17.1%</p>
            </div>
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Posiciones</p>
              <p className="text-xl font-bold font-mono text-foreground">12</p>
              <p className="text-xs text-muted-foreground">activos</p>
            </div>
          </div>
          <div className="h-32 bg-secondary rounded-xl flex items-end px-4 pb-4 gap-1">
            {[40, 45, 38, 52, 48, 55, 60, 58, 65, 70, 68, 75, 72, 80, 78, 85, 82, 88, 90, 95].map((h, i) => (
              <div key={i} className="flex-1 bg-primary/20 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-center mb-12 text-foreground">Todo lo que necesitas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map(feature => (
            <div key={feature.title} className="bg-card rounded-2xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 mb-4">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2 text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Integration */}
      <section className="max-w-3xl mx-auto px-6 pb-16 text-center">
        <div className="bg-card rounded-2xl border border-border p-8">
          <FileSpreadsheet className="h-10 w-10 text-primary mx-auto mb-4" />
          <h3 className="font-bold text-lg mb-2 text-foreground">Importa desde GBM+</h3>
          <p className="text-sm text-muted-foreground mb-4">Sube tu estado de cuenta CSV y tus transacciones se importan automaticamente.</p>
          <div className="flex gap-3 justify-center text-xs text-muted-foreground">
            <span className="bg-secondary px-3 py-1 rounded-full">BMV</span>
            <span className="bg-secondary px-3 py-1 rounded-full">NYSE</span>
            <span className="bg-secondary px-3 py-1 rounded-full">NASDAQ</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>InvestTracker — Hecho en Mexico</p>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: landing page redesign with warm palette and dashboard mockup"
```

---

## Chunk 3: Dashboard Redesign

### Task 7: Add limit param to transaction API

**Files:**
- Modify: `src/app/api/transaction/route.ts`

- [ ] **Step 1: Read the current transaction GET handler**

Read `src/app/api/transaction/route.ts` to understand the current query structure.

- [ ] **Step 2: Add optional `limit` query param**

In the GET handler, after parsing `pid` from the URL search params, add:

```typescript
const limitParam = url.searchParams.get('limit')
const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : undefined
```

Then after the `.order('executed_at', { ascending: false })` chain, add:

```typescript
if (limit) query = query.limit(limit)
```

(The exact integration depends on the current code structure — the implementer should read the file first.)

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/transaction/route.ts
git commit -m "feat: add limit param to transaction GET endpoint"
```

---

### Task 8: Recent activity component

**Files:**
- Create: `src/components/dashboard/recent-activity.tsx`

- [ ] **Step 1: Create the recent activity feed component**

Create `src/components/dashboard/recent-activity.tsx`:

```typescript
'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUpRight, ArrowDownRight, Coins, Scissors } from 'lucide-react'
import Link from 'next/link'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

type Transaction = {
  id: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  executed_at: string
  position: { portfolio_id: string; symbol: string }
}

const TYPE_ICON = {
  buy: ArrowUpRight,
  sell: ArrowDownRight,
  dividend: Coins,
  split: Scissors,
}

const TYPE_LABEL = {
  buy: 'Compraste',
  sell: 'Vendiste',
  dividend: 'Dividendo',
  split: 'Split',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export function RecentActivity() {
  const { data: transactions, isLoading } = useSWR<Transaction[]>(
    '/api/transaction?limit=5',
    fetcher,
    { refreshInterval: 60_000 }
  )

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Actividad Reciente</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-secondary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sin transacciones recientes</p>
        ) : (
          <div className="space-y-2">
            {transactions.map(t => {
              const Icon = TYPE_ICON[t.type]
              const isPositive = t.type === 'buy' || t.type === 'dividend'
              return (
                <div key={t.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${isPositive ? 'bg-[var(--gain)]/10' : 'bg-[var(--loss)]/10'}`}>
                      <Icon className={`h-3.5 w-3.5 ${isPositive ? 'text-[var(--gain)]' : 'text-[var(--loss)]'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {TYPE_LABEL[t.type]} {t.quantity} {t.position.symbol}
                      </p>
                      <p className="text-xs text-muted-foreground">{timeAgo(t.executed_at)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-mono">${(t.quantity * t.price).toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/recent-activity.tsx
git commit -m "feat: recent activity feed component for dashboard"
```

---

### Task 9: KPI cards redesign

**Files:**
- Modify: `src/components/dashboard/kpi-cards.tsx`

- [ ] **Step 1: Rewrite KPI cards with warm styling, 4 cards, hover lift**

Replace the full content of `src/components/dashboard/kpi-cards.tsx` with:

```typescript
'use client'

import { Card, CardContent } from '@/components/ui/card'
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Trophy } from 'lucide-react'
import { useCurrency } from '@/lib/hooks/use-currency'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  bestPosition?: { symbol: string; changePct: number }
  todayReturn?: number
  todayReturnPct?: number
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, bestPosition, todayReturn, todayReturnPct }: Props) {
  const { format } = useCurrency()

  const cards = [
    {
      label: 'Valor Total',
      value: format(totalValue, 'USD'),
      sub: `${positionCount} posiciones`,
      icon: DollarSign,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Hoy',
      value: todayReturn != null ? `${todayReturn >= 0 ? '+' : ''}${format(Math.abs(todayReturn), 'USD')}` : '--',
      sub: todayReturnPct != null ? `${todayReturnPct >= 0 ? '+' : ''}${todayReturnPct.toFixed(2)}%` : '--',
      icon: todayReturn != null && todayReturn >= 0 ? TrendingUp : TrendingDown,
      color: todayReturn != null && todayReturn >= 0 ? 'text-[var(--gain)]' : 'text-[var(--loss)]',
      bgColor: todayReturn != null && todayReturn >= 0 ? 'bg-[var(--gain)]/10' : 'bg-[var(--loss)]/10',
    },
    {
      label: 'Ganancia Total',
      value: `${totalReturn >= 0 ? '+' : ''}${format(Math.abs(totalReturn), 'USD')}`,
      sub: `${totalReturn >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%`,
      icon: BarChart3,
      color: totalReturn >= 0 ? 'text-[var(--gain)]' : 'text-[var(--loss)]',
      bgColor: totalReturn >= 0 ? 'bg-[var(--gain)]/10' : 'bg-[var(--loss)]/10',
    },
    {
      label: 'Mejor Posicion',
      value: bestPosition?.symbol || '--',
      sub: bestPosition ? `${bestPosition.changePct >= 0 ? '+' : ''}${bestPosition.changePct.toFixed(2)}%` : '--',
      icon: Trophy,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.label} className="rounded-2xl border-border shadow-sm hover:-translate-y-0.5 transition-transform">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
              <div className={`p-1.5 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
            </div>
            <p className="text-xl font-bold font-mono">{card.value}</p>
            <p className={`text-xs mt-1 ${card.color}`}>{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/kpi-cards.tsx
git commit -m "feat: KPI cards redesign with 4 cards and warm palette"
```

---

### Task 10: Chart and donut warm recolor

**Files:**
- Modify: `src/components/dashboard/portfolio-chart.tsx`
- Modify: `src/components/dashboard/allocation-donut.tsx`

- [ ] **Step 1: Update chart colors to warm palette**

In `src/components/dashboard/portfolio-chart.tsx`, find the `linearGradient` definition and the `<Area>` component. Replace the hardcoded blue colors (`#2563eb`) with amber:

- `stopColor="#2563eb"` → `stopColor="#D97706"`
- `stroke="#2563eb"` → `stroke="#D97706"`

Also update the Card to use `className="rounded-2xl border-border shadow-sm"`.

- [ ] **Step 2: Update donut colors to warm palette**

In `src/components/dashboard/allocation-donut.tsx`, replace the color array:

```typescript
// Old:
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4']
// New:
const COLORS = ['#D97706', '#4D7C0F', '#B45309', '#78716C', '#C2410C', '#92400E']
```

Also update the Card to use `className="rounded-2xl border-border shadow-sm"`.

- [ ] **Step 3: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/portfolio-chart.tsx src/components/dashboard/allocation-donut.tsx
git commit -m "feat: chart and donut warm amber/olive color palette"
```

---

### Task 11: Dashboard page rewiring

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Update dashboard to use 4-card KPIs, add recent activity, improve layout**

The dashboard currently passes 3 stats to KpiCards. Update it to:

1. Import `RecentActivity` from `@/components/dashboard/recent-activity`
2. Compute `bestPosition` from movers (first item, highest changePct)
3. Compute `todayReturn` / `todayReturnPct` from live prices vs previous close (or pass `undefined` if not available — the KPI card handles this gracefully)
4. Pass all new props to `KpiCards`: `totalValue`, `totalReturn`, `totalReturnPct`, `positionCount`, `bestPosition`, `todayReturn`, `todayReturnPct`
5. Update the layout grid:
   - Top: `<KpiCards ... />`
   - Middle: `grid grid-cols-1 lg:grid-cols-3 gap-4` — chart in `lg:col-span-2`, donut in `lg:col-span-1`
   - Bottom: `grid grid-cols-1 lg:grid-cols-2 gap-4` — TopMovers left, RecentActivity right
6. Update page title from `text-2xl` to `text-3xl`

The implementer should read the full current file first, then apply these changes.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: dashboard layout with 4 KPIs, recent activity, warm styling"
```

---

## Chunk 4: Market, Portfolio, Watchlist & Settings Polish

### Task 12: Market page redesign

**Files:**
- Modify: `src/app/(app)/market/page.tsx`

- [ ] **Step 1: Redesign market page with sections**

Rewrite the market page with:
1. Large centered search input at top with icon (`Search`), warm border, `rounded-xl`
2. "Indices" section: horizontal scrollable row of 3 cards for `^GSPC`, `^MXX`, `^IXIC` using `useQuote()` for each — card shows name + price + change badge
3. "Popular" section: existing grid of popular symbols (AAPL, MSFT, etc.), cards redesigned with `rounded-2xl`, warm shadow, letter-badge for symbol
4. Search results below search bar when query present
5. All cards use `bg-card rounded-2xl border-border shadow-sm`

The implementer should read the current file first and preserve existing hooks/logic while restyling.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/market/page.tsx"
git commit -m "feat: market page redesign with indices and warm styling"
```

---

### Task 13: Market detail page polish

**Files:**
- Modify: `src/app/(app)/market/[symbol]/page.tsx`

- [ ] **Step 1: Restyle market detail page**

Update the market detail page:
1. Header: letter badge (40x40 rounded-xl bg-primary/10 with symbol first letter) + name + large price + change badge
2. Chart: warm colors (already done in Task 10 if shared component)
3. Action buttons below chart: "Agregar a watchlist" (outline) + "Registrar transaccion" (primary) — these link to watchlist add flow and transaction modal respectively
4. All cards: `rounded-2xl border-border shadow-sm`
5. Page title: `text-3xl`

The implementer should read the current file, preserve data fetching, and apply styling changes.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/market/[symbol]/page.tsx"
git commit -m "feat: market detail warm restyle with action buttons"
```

---

### Task 14: Portfolio pages polish

**Files:**
- Modify: `src/app/(app)/portfolio/page.tsx`
- Modify: `src/app/(app)/portfolio/[id]/page.tsx`
- Modify: `src/components/portfolio/portfolio-card.tsx`

- [ ] **Step 1: Restyle portfolio list page**

In `src/app/(app)/portfolio/page.tsx`:
- Title: `text-3xl`
- "Nuevo Portafolio" button: `rounded-xl bg-primary text-primary-foreground`
- Grid: maintain 1/2 column layout
- Loading skeletons: warm shimmer

- [ ] **Step 2: Restyle portfolio card component**

In `src/components/portfolio/portfolio-card.tsx`:
- Card: `rounded-2xl border-border shadow-sm hover:-translate-y-0.5 transition-transform`
- Gain/loss: use `text-[var(--gain)]` / `text-[var(--loss)]` instead of hardcoded green/red

- [ ] **Step 3: Restyle portfolio detail with tabs**

In `src/app/(app)/portfolio/[id]/page.tsx`:
- Replace separate buttons (Transacciones, Analytics) with `<Tabs>` component from shadcn
- Tabs: Posiciones | Transacciones | Analytics
- Posiciones tab shows the existing positions table
- Transacciones tab links to `/portfolio/[id]/transactions`
- Analytics tab links to `/portfolio/[id]/analytics`
- Title: `text-3xl`
- All cards: `rounded-2xl`

- [ ] **Step 4: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/portfolio/page.tsx" "src/app/(app)/portfolio/[id]/page.tsx" src/components/portfolio/portfolio-card.tsx
git commit -m "feat: portfolio pages warm redesign with tabs navigation"
```

---

### Task 15: Watchlist page polish

**Files:**
- Modify: `src/app/(app)/watchlist/page.tsx`

- [ ] **Step 1: Restyle watchlist page with warm palette**

Update the watchlist page:
- All cards: `rounded-2xl border-border shadow-sm`
- Input fields: `rounded-xl border-border`
- Buttons: warm accent colors
- Sort dropdown: warm styling
- Title: `text-3xl`
- Gain/loss colors: `text-[var(--gain)]` / `text-[var(--loss)]`
- Search results: `rounded-xl border-border`

The implementer should read the current file and apply consistent warm styling without changing functionality.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/watchlist/page.tsx"
git commit -m "feat: watchlist warm styling polish"
```

---

### Task 16: Settings page polish

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Restyle settings with warm palette**

Update settings page:
- Title: `text-3xl`
- Cards: `rounded-2xl border-border shadow-sm`
- Input fields: `rounded-xl border-border`
- Buttons: warm accent
- Section headings: slightly larger with more spacing

The implementer should read the current file and apply consistent warm styling.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "feat: settings page warm styling polish"
```

---

### Task 17: Skeleton loaders warm shimmer

**Files:**
- Modify: `src/components/shared/skeleton-card.tsx`
- Modify: `src/components/shared/skeleton-chart.tsx`
- Modify: `src/components/shared/skeleton-table.tsx`

- [ ] **Step 1: Update all skeleton components**

For each skeleton component, update:
- Card wrapper: `rounded-2xl border-border`
- Skeleton elements: add `bg-[var(--shimmer)]` or use the shadcn Skeleton which will pick up the new `--muted` color automatically
- Ensure skeleton dimensions match real component dimensions

The implementer should read each file, verify the Skeleton component from shadcn already uses `bg-muted` (which is now `#F5F0E8`), and only apply card-level styling changes.

- [ ] **Step 2: Build and verify**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/skeleton-card.tsx src/components/shared/skeleton-chart.tsx src/components/shared/skeleton-table.tsx
git commit -m "feat: skeleton loaders warm styling"
```

---

### Task 18: Final build + deploy

- [ ] **Step 1: Run full test suite**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Run production build**

```bash
cd C:/Users/ponye/Projects/investment-portfolio && npx next build
```
Expected: Clean build, no errors.

- [ ] **Step 3: Push to GitHub**

```bash
git push origin master
```

- [ ] **Step 4: Deploy to Vercel**

```bash
npx vercel --prod
```
Expected: Successful deployment.

- [ ] **Step 5: Verify deployment**

Open https://project-tri0w.vercel.app and verify:
- Landing page shows warm cream palette with new hero
- Dashboard shows 4 KPI cards with warm colors
- Sidebar has warm beige styling with Alertas link
- Mobile nav has bottom tab bar with 5 tabs
- Charts use amber/olive colors
- All pages have `rounded-2xl` cards with warm shadows
