# Professional Quality Audit Fix

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all auth, data integrity, and UX issues found in the comprehensive audit so the app works like a professional production application.

**Architecture:** Fix auth flow (middleware→proxy migration + session persistence), clean database of test data, add error states and null safety across all pages, sync currency preferences, and add defense-in-depth auth checks.

**Tech Stack:** Next.js 16.2.0, Supabase SSR, SWR, TypeScript

---

## Chunk 1: Auth & Session Fixes

### Task 1: Migrate middleware to proxy (Next.js 16)

**Files:**
- Rename: `src/middleware.ts` → `src/proxy.ts`
- Modify: `src/lib/supabase/middleware.ts`

- [ ] Rename `src/middleware.ts` to `src/proxy.ts`
- [ ] Change exported function from `middleware` to `proxy`
- [ ] In `src/lib/supabase/middleware.ts`, add redirect for authenticated users visiting `/login` or `/register`:
```ts
if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
  const url = request.nextUrl.clone()
  url.pathname = '/dashboard'
  return NextResponse.redirect(url)
}
```
- [ ] Skip `getUser()` call for API routes (early return before the Supabase call):
```ts
if (isApiRoute) return supabaseResponse
```
- [ ] Build and verify

### Task 2: Fix login/register session persistence

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/register/page.tsx`

- [ ] In login page, replace `router.push` + `router.refresh` with:
```ts
window.location.href = '/dashboard'
```
- [ ] In register page, check for null session after signUp:
```ts
const { data, error } = await supabase.auth.signUp(...)
if (error) { ... }
if (!data.session) {
  setError('Revisa tu email para confirmar tu cuenta')
  setLoading(false)
  return
}
window.location.href = '/dashboard'
```
- [ ] Build and verify

### Task 3: Add server-side auth guard in app layout

**Files:**
- Modify: `src/app/(app)/layout.tsx`

- [ ] Convert to async server component, add auth check:
```tsx
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <CurrencyProvider>
      ...
    </CurrencyProvider>
  )
}
```
- [ ] Build and verify

### Task 4: Commit auth fixes

- [ ] `git add && git commit -m "fix: auth flow - proxy migration, session persistence, server-side guard"`

---

## Chunk 2: Data Integrity

### Task 5: Clean test data from Supabase

- [ ] Delete test transactions (position_id starts with `b0000000`)
- [ ] Delete test positions (id starts with `b0000000`)
- [ ] Delete test portfolio (id = `a0000000-0000-0000-0000-000000000001`)
- [ ] Delete test user accounts (e2etest, claudetest)
- [ ] Verify only real user data remains

### Task 6: Recalculate avg_cost with fees

- [ ] Query real user's positions and transactions
- [ ] Recalculate avg_cost including fees
- [ ] Update positions with correct avg_cost
- [ ] Verify dashboard shows accurate gains

---

## Chunk 3: Dashboard & UI Fixes

### Task 7: Fix dashboard data accuracy

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] Fix movers `name` field — use company name from livePrices or keep symbol but don't render both:
```ts
name: liveData.name ?? pos.symbol,
```
- [ ] Add null guard for `liveData.price` in movers push
- [ ] Build and verify

### Task 8: Fix "Add to Portfolio" on symbol detail page

**Files:**
- Modify: `src/app/(app)/market/[symbol]/page.tsx`

- [ ] Change dropdown to navigate to portfolio's transaction page with pre-filled symbol:
```ts
router.push(`/portfolio/${p.id}/transactions?add=${encodeURIComponent(decodedSymbol)}`)
```
- [ ] Build and verify

### Task 9: Add error states to all pages

**Files:**
- Modify: `src/app/(app)/portfolio/page.tsx`
- Modify: `src/app/(app)/watchlist/page.tsx`
- Modify: `src/app/(app)/alerts/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] Destructure `error` from each SWR hook
- [ ] Add error display: `{error && <p className="text-destructive">Error al cargar datos</p>}`
- [ ] Fix alerts `target_value?.toFixed(2)` null safety
- [ ] Fix settings fetcher to check for API errors
- [ ] Fix watchlist delete to check response for errors
- [ ] Build and verify

### Task 10: Fix search minimum characters

**Files:**
- Modify: `src/lib/hooks/use-market.ts`

- [ ] Change `query.length >= 1` to `query.length >= 2`

### Task 11: Fix header avatar to show user initials

**Files:**
- Modify: `src/components/layout/header.tsx`

- [ ] Add `useEffect` to fetch user on mount:
```ts
const [initials, setInitials] = useState('U')
useEffect(() => {
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (user?.user_metadata?.display_name) {
      const name = user.user_metadata.display_name
      setInitials(name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2))
    } else if (user?.email) {
      setInitials(user.email[0].toUpperCase())
    }
  })
}, [])
```
- [ ] Use `initials` in AvatarFallback

### Task 12: Commit UI fixes

- [ ] `git commit -m "fix: dashboard accuracy, error states, UX polish"`

---

## Chunk 4: Deploy & Verify

### Task 13: Build, deploy, and full E2E verification

- [ ] `npx next build` — must succeed with 0 errors
- [ ] `npx vercel --prod` — deploy
- [ ] Playwright: verify login persists session
- [ ] Playwright: verify /market redirects when not logged in
- [ ] Playwright: verify dashboard shows correct data (no phantom gains)
- [ ] Playwright: verify all pages load without crashes
