# Performance audit (C3)

Measured on 2026-09-14 against a local production build (`next build` + `next
start`), before and after the changes in the C3 commit. Every number below was
produced by the scripts in `scripts/`, so it can be reproduced and re-run after
any future change.

## TL;DR

| | Before | After |
|---|---|---|
| First-load JS, heaviest page (`/portfolio/[id]/analytics`) | 609 KB gzip | 395 KB gzip (−35 %) |
| First-load JS, pages with charts | 529–609 KB gzip | 363–395 KB gzip (−31 to −35 %) |
| First-load JS, every other signed-in page | 421–435 KB gzip | 355–369 KB gzip (−15 to −16 %) |
| Landing page CLS (lab, throttled) | 0.0634 | 0.0001 |
| Recharts in any page's first load | 6 separate copies, ~92 KB gzip each | none |
| Client Sentry SDK shipped with no DSN | 454 KB raw on every page | not bundled |
| Field Core Web Vitals | not collected | collected per route in `web_vitals` |

LCP and INP on the public pages did **not** change measurably. That is reported
as found, not rounded into an improvement — see [Interpreting the lab numbers](#interpreting-the-lab-numbers).

## How it was measured

### Bundle — every page route

```bash
npm run build
node scripts/bundle-report.mjs --json before.json
```

`next build` writes `.next/diagnostics/route-bundle-stats.json`: for each route,
the chunks loaded on first paint and their uncompressed size. The script adds
the gzip size of each chunk (zlib, default level) and detects which libraries
each large chunk contains. The gzip totals matched, byte for byte, the
`encodedBodySize` the browser recorded when the same pages were loaded from
`next start`, so they are what a browser actually downloads.

The Turbopack analyzer (`npx next experimental-analyze --output`) was used to
confirm module composition.

### Lab Core Web Vitals — public pages

```bash
npx next start -p 3100
node scripts/web-vitals-lab.mjs http://localhost:3100 / /login /register
```

Headless Chromium through Playwright, **throttled to Lighthouse's mobile
profile** (4× CPU slowdown, 150 ms RTT, 1.6 Mbps down, 750 kbps up), 5 runs per
route with a fresh context each, median reported. LCP and CLS come from
`PerformanceObserver`; INP is the longest event duration over one real click.
Unthrottled, every page painted in ~65 ms on this machine and the numbers
distinguished nothing.

**Signed-in pages are not in the lab run.** Measuring them would need a real
account's credentials inside a script, which this audit does not do; and the
in-app browser pane used for manual checks reports its document as hidden,
where browsers do not emit LCP at all. Signed-in pages are covered by the
bundle measurement above and by field data below.

### Field Core Web Vitals — every page, from real users

`src/components/analytics/web-vitals-reporter.tsx` reports LCP, CLS, INP, FCP
and TTFB from each page view (Next's `useReportWebVitals`) to
`POST /api/analytics/vitals`, which validates and stores them in the
`web_vitals` table (migration 019). Nothing identifies the user: a metric, a
value, a rating, and the route **pattern** (`/portfolio/[id]`, never the id).

p75 per route over the last week:

```sql
select route, name,
       count(*) as samples,
       round(percentile_cont(0.75) within group (order by value)::numeric, 1) as p75
from web_vitals
where created_at > now() - interval '7 days'
group by route, name
order by route, name;
```

This is the source for future before/after comparisons of signed-in pages. It
started collecting with this change; there is no field "before".

Only real visits report (added in C5): views from `localhost`, automated
browsers (`navigator.webdriver`) and pages inside a frame send nothing. Before
that check, local audits wrote about 230 rows of lab data into this table on
2026-09-14 between 07:00 and 08:00 UTC; read field data from after that hour.

## Findings and changes

### 1. The client Sentry SDK shipped to every page and could never report

`src/instrumentation-client.ts` imported `@sentry/nextjs` statically and called
`init({ enabled: Boolean(dsn) })`. `NEXT_PUBLIC_SENTRY_DSN` is not set in
production — the deployed bundle contains `enabled:!1` — so the SDK was
downloaded, parsed and initialised as disabled on every page view.

**Change:** the SDK is imported dynamically, and only when a DSN exists at build
time. `NEXT_PUBLIC_` variables are inlined, so with no DSN the branch is dead
code and the import is removed from the bundle. With a DSN it loads in its own
chunk right after start-up; an error thrown in the milliseconds before that
chunk arrives would not be captured. Server-side Sentry is unchanged.

**Effect:** −66 to −70 KB gzip on every page route, including the public ones.

### 2. Recharts was in the first-load bundle of every chart page, six times over

17 files imported `recharts` statically. Turbopack built six near-identical
314 KB (≈92 KB gzip) chunks, one per chart route, so each page's first paint
waited on a charting library and moving between two chart pages downloaded it
again under another file name.

**Change:** `src/components/charts/lazy-charts.tsx` exports every chart through
`next/dynamic` with `ssr: false` (all of them measure their container in the
browser). Pages import charts from there. The five charts written inline in
pages — two in `/advisor`, two in `/compare`, one in `/market/compare` — were
moved, JSX unchanged, into components (`advisor-charts.tsx`,
`compare-charts.tsx`, `compare-returns-chart.tsx`) so they could be loaded the
same way. Wrapping Recharts primitives in `dynamic` directly does not work:
Recharts identifies its children (`Line`, `Area`, …) by type.

Placeholders keep the chart's height (the existing `SkeletonChart`, or a block
at the chart's own height inside cards that already frame it), so the swap from
placeholder to chart does not shift layout.

**Effect:** Recharts is in no page's first load. Chart pages dropped 31–35 %.
Verified on the production build that every affected page still draws its
charts (dashboard, portfolio, market, lab, analytics risk tab) with no console
errors.

### 3. The landing headline re-wrapped when the web font arrived

Lab CLS on `/` was 0.0634. Layout-shift attribution showed the headline's
second phrase, "en un solo lugar", moving from y=120 to y=180 at ~1.2 s: in the
fallback font the headline fitted on one line at 1280 px; in Plus Jakarta Sans
bold it needed two, pushing the page down. `next/font` adjusts fallback metrics,
but against the regular weight, not bold.

**Change:** the phrase is always on its own line, so the line count no longer
depends on which font is showing.

**Effect:** CLS 0.0634 → 0.0001.

### 4. Long lists — no virtualization, deliberately

C3 asks for virtualization "where appropriate". Every long list was checked:

| List | Bound |
|---|---|
| Transactions | paginated, 20 per page |
| Discover | paginated through `usePublicPortfolios(page)` |
| Leaderboard | generated with a SQL `LIMIT`; currently empty |
| Positions, watchlist | the user's own holdings — tens of rows |

None renders hundreds of rows at once, so a virtualization library would add
bundle weight to save nothing. **Rule for later:** virtualize any list that can
render more than ~200 rows without pagination.

## Interpreting the lab numbers

| Route | LCP before (ms) | LCP after | CLS before | CLS after | INP before (ms) | INP after | JS loaded before (KB) | after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 1132 | 1124 | 0.0634 | 0.0001 | 24 | 24 | 313 | 251 |
| `/login` | 1000 | 1004 | 0 | 0 | 24 | 24 | 309 | 243 |
| `/register` | 1000 | 992 | 0 | 0 | 32 | 32 | 309 | 243 |

("JS loaded" includes chunks fetched after first paint, which is why it is a
little above the first-load figures.)

LCP on the public pages is the server-rendered headline and is bounded by the
network profile, not by JavaScript: removing 66 KB of script did not move it.
INP on those pages is already far inside "good" (≤ 200 ms). The JavaScript
reduction matters where the page's own content waited on it — the chart pages —
and that is exactly what the lab cannot reach and field data will show.

## Full bundle table

First-load JavaScript per page route, before → after.

| Route | Before gzip (KB) | After gzip (KB) | Change | Before raw (KB) | After raw (KB) |
|---|---:|---:|---:|---:|---:|
| `/portfolio/[id]/analytics` | 609 | 395 | −35 % | 2011 | 1297 |
| `/market/[symbol]` | 568 | 378 | −33 % | 1874 | 1246 |
| `/advisor` | 566 | 382 | −33 % | 1876 | 1264 |
| `/compare` | 548 | 365 | −33 % | 1818 | 1210 |
| `/lab` | 545 | 363 | −33 % | 1806 | 1200 |
| `/dashboard` | 545 | 365 | −33 % | 1804 | 1207 |
| `/market/compare` | 534 | 364 | −32 % | 1772 | 1208 |
| `/portfolio/[id]` | 534 | 369 | −31 % | 1768 | 1224 |
| `/portfolio/[id]/public` | 529 | 364 | −31 % | 1749 | 1206 |
| `/discover` | 435 | 369 | −15 % | 1428 | 1218 |
| `/discover/leaderboard` | 431 | 365 | −15 % | 1414 | 1204 |
| `/watchlist` | 430 | 364 | −15 % | 1413 | 1203 |
| `/market` | 427 | 360 | −16 % | 1404 | 1194 |
| `/portfolio/import` | 427 | 361 | −15 % | 1403 | 1194 |
| `/portfolio` | 427 | 361 | −15 % | 1402 | 1193 |
| `/settings` | 426 | 360 | −15 % | 1399 | 1190 |
| `/portfolio/[id]/transactions` | 425 | 359 | −16 % | 1399 | 1189 |
| `/profile/[username]` | 425 | 359 | −16 % | 1397 | 1188 |
| `/alerts` | 425 | 358 | −16 % | 1395 | 1185 |
| `/settings/profile` | 424 | 357 | −16 % | 1393 | 1183 |
| `/settings/privacy` | 424 | 357 | −16 % | 1392 | 1183 |
| `/portfolio/new` | 423 | 357 | −16 % | 1390 | 1181 |
| `/admin/metrics` | 421 | 355 | −16 % | 1384 | 1174 |
| `/register` | 309 | 243 | −21 % | 1050 | 841 |
| `/login` | 309 | 243 | −21 % | 1049 | 840 |
| `/` | 243 | 177 | −27 % | 814 | 605 |
| `/_not-found` | 227 | 161 | −29 % | 770 | 559 |

The "after" figures include the web-vitals reporter, which added ~3 KB gzip to
every page.

## Next opportunities, not done here

- **Server response time on signed-in pages.** Field TTFB during verification
  was ~800 ms on `/dashboard` and ~650 ms on analytics, against ~250 ms on
  lighter pages. The request path authenticates in the proxy
  (`supabase.auth.getUser()`), again in the `(app)` layout, and reads the
  profile, all before the page renders. Worth profiling once field data
  confirms it outside local testing.
- **The largest remaining shared chunk** (~69 KB gzip on every route) has no
  single library marker; it is framework and app shell code. Next step is the
  interactive analyzer (`npx next experimental-analyze`) on that chunk.
- **supabase-js** (~48 KB gzip) is on 25 of 27 routes. Signed-in pages need it;
  whether every one needs it at first paint is open.
