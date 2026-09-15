# Load test results (C8)

2026-09-14. What was loaded, where, what it measured, and what it means for the
app in production. Every number below comes from `scripts/load-test.mjs`,
`tests/load/monte-carlo.bench.ts`, or the browser's own resource timings, and can
be re-run.

## TL;DR

| Question | Answer |
|---|---|
| How much can one server process take? | Public pages ~270–370 req/s; an API request rejected for no session ~1,000–1,150 req/s. Past ~10 concurrent requests throughput stops rising and latency climbs (p50 26 ms → 194 ms for pages at 50). |
| Where does a signed-in request spend its time? | In Supabase round trips, not in the app. A cheap authenticated route took 276–288 ms from this machine, of which the app itself is under 2 ms; each API request verifies the session twice (proxy and route). |
| Is Monte Carlo the bottleneck? | No. One simulation is 9–35 ms at the sizes users run (26–104 weeks, up to 10 holdings) and 413 ms at the API's maximum (25 holdings, 260 weeks). End to end a request took 446–499 ms, almost all of it database reads. |
| What happens with concurrent Monte Carlo? | The simulation is synchronous: on one instance, N concurrent requests queue. 20 concurrent maximum-size requests would make the last wait ~8 s; at the sizes the UI offers, 20 concurrent finish within ~0.7 s. |
| Does rate limiting work? | Mechanically yes: request 61 from one address in a minute gets 429 with `Retry-After: 60`. But it is per serverless instance, it counts a whole office or mobile carrier behind one IP as one user, and ordinary browsing gets close to it — the analytics page alone makes 14 API calls on load. |
| Was production load-tested? | No. See [Environment](#environment-and-why-not-production). |

## Environment, and why not production

The roadmap says staging or preview, not production. The project has one
Supabase project (production, `us-east-1`); Vercel previews use the same
database. So:

- **Heavy load ran against a local production build** (`next build && next start
  -p 3100`), on scenarios that touch no external service: public pages, and API
  requests without a session. Without a session cookie, `supabase.auth.getUser()`
  returns without a network call, so none of this reached Supabase.
- **Monte Carlo CPU was measured in-process** with the exact simulation the route
  and the background job run.
- **Signed-in behaviour was measured at one user's normal pace**, in a browser
  already signed in, against the same local build: one page load at a time, and
  a handful of sequential Monte Carlo requests. That reads the production
  database, which is why it was kept to what a person clicking around does.
- `scripts/load-test.mjs` refuses `project-tri0w.vercel.app` unless
  `LOADTEST_ALLOW_PRODUCTION=1` is set.

Machine: AMD Ryzen 5 7600X (6 cores / 12 threads), Windows 11, Node 24.14, one
`next start` process, requests over loopback. Vercel functions have less CPU per
invocation and run several instances; treat per-process throughput here as an
upper bound for one instance, not as the site's capacity.

## 1. Public pages — `pages`

`GET /` and `/login`, round robin, closed model (each worker sends the next
request as soon as the last one returns), 20 s per level.

| Concurrency | Requests | Throughput | p50 | p95 | p99 | max | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5,456 | 272.8 req/s | 3.5 ms | 4.9 ms | 6.0 ms | 40 ms | 0 |
| 10 | 7,485 | 374.1 req/s | 26.0 ms | 32.9 ms | 43.6 ms | 86 ms | 0 |
| 50 | 5,198 | 259.5 req/s | 194.2 ms | 261.1 ms | 289.9 ms | 343 ms | 0 |

One process saturates around 10 concurrent requests: beyond that, requests
queue, latency grows with the queue and throughput even drops. No errors at any
level.

## 2. API without a session — `api-unauth`

`/api/portfolio`, `/api/watchlist` and a Monte Carlo URL, no cookie: the proxy,
the rate limiter and the route's own auth check, answering 401. Each request
carried a different `x-forwarded-for`, so this measures the application path,
not the limiter.

| Concurrency | Requests | Throughput | p50 | p95 | p99 | max | Statuses |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 12,329 | 616.4 req/s | 1.4 ms | 2.9 ms | 5.5 ms | 62 ms | 401 × 12,329 |
| 10 | 20,605 | 1,029.9 req/s | 9.1 ms | 13.1 ms | 16.4 ms | 43 ms | 401 × 20,605 |
| 50 | 23,022 | 1,148.5 req/s | 43.2 ms | 46.4 ms | 63.6 ms | 78 ms | 401 × 23,022 |

Unauthenticated requests are rejected cheaply, which matters for abuse: they
never cost a database call.

## 3. Rate limiting — `rate-limit`

80 sequential requests to `/api/portfolio`:

| Burst | First 429 at | Rejected | Retry-After |
|---|---:|---:|---|
| One address | request 61 | 20 of 80 | 60 |
| A new `x-forwarded-for` on every request | never | 0 of 80 | — |

What this shows and what it means in production:

- **The limit works as written:** 60 requests per 60 s per address, then 429
  with `Retry-After`.
- **The address comes from `x-forwarded-for`.** Locally anyone can set it, so the
  second burst walks past the limiter. On Vercel the edge overwrites that header
  with the real client address, so this is not exploitable there — but it is if
  the app is ever served behind another proxy.
- **The counter is a `Map` in each serverless instance's memory.** Several
  instances each allow 60, and a cold start resets it. It limits a single
  instance, not a client.
- **It is per address, not per user.** Everyone behind one office NAT or a
  mobile carrier's CGNAT shares one budget of 60/min.
- **Ordinary use gets close to it.** API calls made while loading one page,
  signed in, measured from the browser:

  | Page | API calls on load | Notes |
  |---|---:|---|
  | `/dashboard` | 6 | then one price refresh per 5 min while Realtime is up |
  | `/portfolio/[id]` | 7 | |
  | `/portfolio/[id]/analytics` (first tab) | 14 | + job status polls while Monte Carlo/factors run |

  Dashboard → portfolio → analytics is 27 requests before any tab is switched;
  each analytics tab loads more, and returning focus to the window revalidates
  every visible query at once. During the accessibility audit (C5), loading 20
  pages back to back got a real signed-in user 429s. Before C9, a 429 on the
  dashboard even told that user to "create your first portfolio".

The recommendation is the one already in `docs/SECURITY_AUDIT.md` (finding 15):
count on Upstash, which the code supports, and limit signed-in requests per user
rather than per address, keeping a per-address limit for requests without a
session. Configuring Upstash is an owner action (an account and two environment
variables). **Before doing it**, note finding 21 of the same document: analytics
cache keys were scoped to the caller in `8ee59b9`, found during this test —
turning caching on earlier would have served one user's private analytics to
another.

## 4. Signed-in requests, one user's pace

Browser already signed in, local production build, production Supabase.

| Measurement | Result |
|---|---|
| Round trip to Supabase Auth (`/auth/v1/health`, 5 samples, new connection each) | 220 ms first, then 121–147 ms |
| `GET /api/user/profile`, 5 sequential | 276–288 ms |
| Same route, no session (app path only, §2) | ~1.4 ms |
| Dashboard page load: 6 API calls in parallel | 202–1,689 ms each |
| Portfolio page load: 7 API calls | p50 546 ms |
| Analytics page load: 14 API calls | p50 2.9 s, max 9.7 s (allocation) |
| Document TTFB, `/dashboard` | 439 ms |

Reading this:

- A signed-in API request pays **two session checks** — `updateSession()` in the
  proxy and `auth.getUser()` in the route — each a network round trip to
  Supabase Auth, before its own queries. From this machine that is most of the
  ~280 ms. `vercel.json` sets no region, so production functions run in
  Vercel's default `iad1`, next to the `us-east-1` database, where a round trip is a few milliseconds, so the same
  request is much faster there. The structure still multiplies every future
  latency increase by two; verifying the JWT locally (`getClaims()` with
  asymmetric signing keys) in one of the two places would remove a round trip.
- The analytics page is where concurrency bites: fourteen heavy requests start
  together and share one process, and the slowest (allocation, 9.7 s) waits
  behind the others' CPU and database work.

## 5. Monte Carlo — CPU and concurrency

`npx vitest bench --run tests/load` — `simulatePortfolioGBM` with the production
settings (1,500 paths, 252 days of history per holding), mean of 5–58
iterations, synthetic correlated returns.

| Holdings | 26 weeks | 52 weeks | 104 weeks | 260 weeks (API max) |
|---:|---:|---:|---:|---:|
| 3 | 8.7 ms | 17.1 ms | 34.1 ms | 84.5 ms |
| 10 | 17.8 ms | 35.5 ms | 70.6 ms | 175.6 ms |
| 25 | 40.9 ms | 82.5 ms | 164.0 ms | 413.0 ms |

Cost is linear in horizon × holdings (each doubling of either doubles the time).
The UI offers 26, 52 and 104 weeks; the API clamps anything to 4–260.

**End to end, signed in** (6 holdings, 127 aligned days, sequential): 499 ms at
26 weeks, 446 ms at 52, 455 ms at 104. The simulation is ~10–40 ms of that; the
rest is the session checks and the position and price-history reads. Repeating
the 52-week request took 565 ms: the 5-minute result cache is inactive without
Upstash, so every request recomputes.

**Concurrent requests on one instance.** The simulation is synchronous
JavaScript; while it runs, that process serves nothing else. N simultaneous
requests on one instance therefore queue, and the last one waits about N × the
single run (plus its I/O):

| Concurrent requests | 10 holdings, 52 weeks | 25 holdings, 104 weeks | 25 holdings, 260 weeks |
|---:|---:|---:|---:|
| 1 | 36 ms | 164 ms | 413 ms |
| 5 | 0.18 s | 0.82 s | 2.1 s |
| 20 | 0.71 s | 3.3 s | 8.3 s |
| 50 | 1.8 s | 8.2 s | 20.6 s |

(This machine's CPU. Expect roughly 1.5–3× longer on a serverless vCPU.)

- At realistic sizes this is comfortable, and Vercel spreads concurrent requests
  over instances.
- The background job path (`POST /api/jobs`, C1) runs the same code with a 30 s
  timeout and 3 attempts; the worst case above stays inside it even at 50 queued
  requests on one instance.
- The abuse case is a user cycling `weeks` from 4 to 260 to defeat the cache: up
  to 60 requests a minute per address × 413 ms is ~25 s of CPU a minute on one
  instance. Per-user limits (§3) are the answer, not a smaller simulation.

## Re-running

```bash
npm run build && npx next start -p 3100

node scripts/load-test.mjs pages --concurrency 10 --duration 20
node scripts/load-test.mjs api-unauth --concurrency 10 --duration 20
node scripts/load-test.mjs rate-limit

npx vitest bench --run tests/load
```

Signed-in scenarios, against a preview or staging deployment with its own
database and a test account (never the owner's):

```bash
LOADTEST_COOKIE='<Cookie header of the signed-in test session>' \
  node scripts/load-test.mjs dashboard --base https://<preview-url> --concurrency 5 --duration 30

LOADTEST_COOKIE='...' LOADTEST_PORTFOLIO_ID='<test portfolio uuid>' \
  node scripts/load-test.mjs monte-carlo --base https://<preview-url> --concurrency 10 --duration 30
```

`monte-carlo` varies `weeks` on every request so the result cache cannot hide
the computation. Expect 429s after 60 requests a minute from one machine unless
the target has per-user limits — that is the §3 finding, not a script failure.

## Not done

- A load test of signed-in scenarios at scale: there is no staging database, and
  running it here would have loaded production Supabase with the owner's account.
- Vercel-side measurements (cold starts, instance fan-out): they need a preview
  deployment with its own database.
- k6 itself: not installed, and installing it was not needed — the Node runner
  covers the same scenarios with no dependency. The scenarios translate directly
  if a team prefers k6 later.
