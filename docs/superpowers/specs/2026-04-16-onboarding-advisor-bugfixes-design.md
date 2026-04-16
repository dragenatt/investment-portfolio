# Onboarding, Advisor Promotion & System-Wide Bug Fixes

**Date:** 2026-04-16
**Status:** Approved
**Scope:** UX onboarding flow, navigation restructuring, functional bug fixes

---

## 1. Onboarding: Empty State + Guided Checklist

### Problem
New users arrive at an empty dashboard with zero KPIs and no guidance on what to do first.

### Solution
**A. Dashboard Empty State** — When user has 0 portfolios, replace the normal dashboard content with:
- Illustration/icon + welcome heading ("¡Bienvenido a InvestTracker!")
- Brief description of what the app does
- Primary CTA button: "Crear mi primer portafolio" → `/portfolio/new`
- Secondary CTA: "Completar mi perfil de inversión" → `/advisor`

**B. Onboarding Checklist** — Small progress card shown on the dashboard (below KPIs when portfolios exist but onboarding incomplete):
- Step 1: Crear un portafolio ✓/○
- Step 2: Agregar una posición ✓/○
- Step 3: Completar perfil de inversión ✓/○
- Dismissible via "×" button, stores `onboarding_checklist_dismissed` in localStorage
- Auto-hides when all 3 steps are complete

### Files to modify
- `src/app/(app)/dashboard/page.tsx` — Add empty state conditional
- `src/components/dashboard/onboarding-checklist.tsx` — New component
- `src/components/dashboard/welcome-empty-state.tsx` — New component

---

## 2. Advisor as Main Navigation Feature

### Problem
The Advisor page (`/advisor`) has 858 lines of sophisticated investment profiling (Monte Carlo, risk assessment, allocation recommendations) but is completely unreachable from navigation.

### Solution
Add "Asesor" to the sidebar's **primary items** (not tools section):
- Position: 5th item, after Watchlist
- Icon: `Lightbulb` (from lucide-react)
- Label: "Asesor" (ES) / "Advisor" (EN)
- Keyboard shortcut: `A`
- Path: `/advisor`

### Files to modify
- `src/components/layout/sidebar.tsx` — Add advisor to primary nav items
- `src/components/layout/mobile-nav.tsx` — Add advisor to mobile nav
- `src/lib/i18n/` — Add translation keys if missing

---

## 3. Currency Selector Verification

### Current State
Currency selector exists in Settings page (line 79) with MXN/USD/EUR options. Saved via `/api/user/preferences`. CurrencyProvider defaults to MXN.

### Action
Verify it works end-to-end. No changes expected unless broken.

---

## 4. Bug Fixes

### 4a. Hardcoded benchmark return (CRITICAL)
- **File:** `src/app/api/analytics/[pid]/attribution/route.ts` line 69
- **Issue:** `const benchmarkReturn = 10` — hardcoded instead of calculated
- **Fix:** Calculate from actual benchmark data or use a reasonable market default based on time period

### 4b. Login/Register navigation (HIGH)
- **Files:** `src/app/(auth)/login/page.tsx` line 33, `src/app/(auth)/register/page.tsx` line 45
- **Issue:** `window.location.href = '/dashboard'` causes full page reload, loses state
- **Fix:** Use Next.js `useRouter().push('/dashboard')` or `redirect()`

### 4c. parseInt without radix (MEDIUM)
- **Files:**
  - `src/app/api/discover/portfolios/route.ts` lines 16-17
  - `src/app/api/transaction/route.ts` line 16
- **Fix:** Add radix 10: `parseInt(value, 10)`

### 4d. Unbounded localStorage for recent searches (LOW)
- **Files:** `src/components/market/symbol-search.tsx`, `src/app/(app)/watchlist/page.tsx`
- **Fix:** Cap recent searches array to 10 items max

### 4e. Missing global not-found page (LOW)
- **Fix:** Add `src/app/not-found.tsx` with branded 404 page

---

## 5. Non-goals
- No redesign of the Advisor questionnaire itself (already excellent)
- No Redux/Zustand migration
- No new API endpoints
- No changes to auth flow beyond the navigation fix
