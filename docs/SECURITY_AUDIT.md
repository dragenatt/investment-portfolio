# Security audit (C6)

OWASP Top 10 (2021) review of InvestTracker, 2026-09-14: Next.js 16 app on
Vercel, Supabase (Postgres + Auth + Realtime) project `mabmqxztvakaijtrncyl`.
Every finding lists its category, the evidence, the risk, a severity, the
solution, and whether it was fixed in this change.

Severity: **Critical** — exploitable now, large impact. **High** — exploitable
now by any signed-in user against other users or shared data. **Medium** —
exploitable with conditions, or integrity/privacy impact on the attacker's own
account that leaks to others. **Low** — defence in depth, or impact limited to
information disclosure. **Info** — reviewed, no issue.

## Threat model in one paragraph

The anon key is in the browser bundle, so **anyone can call Supabase's REST API
directly**; any signed-in user also holds a JWT. That means the API routes and
their zod schemas are *not* the security boundary for data — RLS policies and
Postgres privileges are. Every database finding below was reachable with the
public anon key plus a normal user's session, without touching an API route.
Server code that uses the service role bypasses RLS and must check ownership
itself.

## Summary

| # | Finding | OWASP | Severity | Status |
|---|---|---|---|---|
| 1 | Users could set their own `is_verified`, `badges`, follower counts | A01 Broken Access Control | High | Fixed (migration 020) |
| 2 | Owners could set `like_count` / `view_count` / `share_token` on portfolios | A01 | Medium | Fixed (020) |
| 3 | Any signed-in user could write shared `market_events` | A01 | High | Fixed (020) |
| 4 | Public portfolio RPCs ignored the owner's privacy switches | A01 | Medium | Fixed (020) |
| 5 | `toggle_portfolio_like` accepted private and own portfolios | A01 | Low | Fixed (020) |
| 6 | `anon` held table privileges on every table | A01 / A05 | Low | Fixed (020) |
| 7 | Cron routes failed open without `CRON_SECRET` | A07 Identification & Auth Failures | High (latent) | Fixed |
| 8 | No Content-Security-Policy; frameable by any site | A05 Security Misconfiguration / A03 | Medium | Fixed |
| 9 | Missing `nosniff`, `Referrer-Policy`, `Permissions-Policy` | A05 | Low | Fixed |
| 10 | Watchlist PATCH updated the table with the raw request body | A04 Insecure Design / A08 | Low | Fixed |
| 11 | Profile website/avatar accepted `javascript:` URLs | A03 Injection (XSS) | Low (latent) | Fixed |
| 12 | 500 responses returned database error text (47 routes) | A05 | Low | Fixed |
| 13 | Hard-coded FX rates used silently when the provider failed | A04 / A08 integrity | Medium | Fixed |
| 14 | 25 known-vulnerable dependencies, 1 critical (`next`) | A06 Vulnerable Components | Critical | Fixed in C7 (0 remaining) |
| 15 | Rate limiting is per serverless instance; Upstash optional | A04 / A07 | Medium | Open → C8 |
| 16 | Leaked-password protection disabled in Supabase Auth | A07 | Medium | Open — owner action |
| 17 | `share_token` of public portfolios readable by signed-in users | A01 | Low | Accepted, documented |
| 18 | Session cookies readable by JavaScript (`@supabase/ssr` design) | A07 | Low | Accepted, mitigated by CSP |
| 19 | Remaining SECURITY DEFINER functions flagged by the linter | A01 | Info | Reviewed, by design |
| 20 | SQL injection, SSRF, secrets, logging, authentication on routes | A03 / A10 / A02 / A09 | Info | Reviewed, no issue |
| 21 | Analytics cache keyed by portfolio id, not by caller (found in C8) | A01 | High (latent) | Fixed |

## Findings

### 1. Self-awarded trust on `profiles` — A01, High — fixed

**Evidence.** Policy `profiles_update` is `USING (user_id = auth.uid())` with no
column restriction, and `authenticated` held table-wide `UPDATE`. A signed-in
user could send `PATCH /rest/v1/profiles?user_id=eq.<self>` with
`{"is_verified": true, "badges": [...], "follower_count": 1000000}`.

**Risk.** Fake verification badges and follower counts are trust signals other
users rely on when deciding whose public portfolio to follow or copy.

**Solution.** Migration 020 revokes table-wide `INSERT`/`UPDATE` and grants them
only on the columns a person edits (`display_name, avatar_url, base_currency,
theme, username, bio, location, website`). Counters remain maintained by
`toggle_follow` and triggers, which run as owner.

**Verified** on the live database, simulating the user's role: updating `bio`
succeeds; `is_verified` and `follower_count` fail with *permission denied for
table profiles*. Through the app, re-saving the profile with its current values
returns 200.

### 2. Self-awarded popularity on `portfolios` — A01, Medium — fixed

**Evidence.** Same pattern: `portfolios_update` has no column restriction, and
`INSERT` accepted every column. An owner could set `like_count = 10000`, set
`view_count`, overwrite `share_token`, or create a portfolio born with likes.

**Risk.** Manipulation of discovery and leaderboards.

**Solution.** Column grants for `UPDATE` and `INSERT` on the user-editable
columns only. `deleted_at` changes only through `soft_delete_portfolio()`.

**Verified:** renaming and changing visibility succeed; `like_count` update and
an insert carrying `like_count` fail.

### 3. Shared `market_events` writable by any user — A01, High — fixed

**Evidence.** Policy `market_events_auth_write`: `FOR ALL TO authenticated USING
(true) WITH CHECK (true)`. The app only reads the table
(`api/market/[symbol]/events`).

**Risk.** Any user could insert, alter or delete the earnings and dividend
events every other user sees — false events next to real prices. Same class as
`current_prices`, closed in migration 018.

**Solution.** Policy dropped; `INSERT/UPDATE/DELETE` revoked from `anon` and
`authenticated`. Writes belong to the service role.

**Verified:** insert as a signed-in user fails with *permission denied*.

### 4. Public portfolio RPCs ignored privacy switches — A01, Medium — fixed

**Evidence.** `get_portfolio_allocation` and `get_portfolio_performance` are
SECURITY DEFINER and callable by `anon` at `/rest/v1/rpc/...`. Both returned
data for any portfolio with `visibility = 'public'` and ignored
`show_amounts`, `show_positions` and `show_allocation`. An owner who published
returns but hid amounts still had every symbol and dollar value readable.

**Solution.** Non-owners now get: nothing unless the portfolio is public (and,
for allocation, `show_allocation`); symbols only with `show_positions`; money
only with `show_amounts`. Owners see everything.

**Verified:** another user's private portfolio returns `null` for `anon` and
for a signed-in user.

### 5. Likes on invisible portfolios — A01, Low — fixed

**Evidence.** `toggle_portfolio_like` checked nothing about the target.

**Solution.** The target must exist, not be deleted, not belong to the caller,
and be public or shared with the caller. **Verified:** liking one's own
portfolio raises *Portfolio not found*.

### 6. `anon` table privileges — A01/A05, Low — fixed

**Evidence.** `anon` held `SELECT/INSERT/UPDATE/DELETE` on almost every table.
RLS denied the rows, so nothing was open — but several policies are declared
without `TO` (which includes `anon`), so a single mistaken policy would have
exposed a table to every visitor.

**Solution.** `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` plus the
same default for future tables. Signed-out pages query no table.

**Verified:** `anon` reading `profiles`, `portfolios` or `current_prices` fails
with *permission denied*; the public pages pass their audit unchanged.

### 7. Cron routes failed open — A07, High (latent) — fixed

**Evidence.** All four cron routes:
`if (cronSecret && authHeader !== \`Bearer ${cronSecret}\`) return 401`. With
`CRON_SECRET` unset the condition is false and the request proceeds — with the
service role — to run snapshots for every user, backfill, or read cron status.
Production has the secret: `GET /api/cron/status` without it returns 401.

**Risk.** Any environment without the variable (a preview, a renamed secret, a
new project) exposes service-role jobs to the internet: data-integrity and
denial-of-wallet risk.

**Solution.** `src/lib/api/cron-auth.ts`: no secret means no access, and the
header is compared with `timingSafeEqual`. `CRON_SECRET` is documented in
`.env.local.example`. Tests cover the unset, wrong, truncated and case-changed
cases.

### 8. No Content-Security-Policy — A05/A03, Medium — fixed

**Evidence.** Production responses carried only `Strict-Transport-Security`.
No CSP, no framing restriction.

**Risk.** Any HTML/script injection that got past React's escaping would run
with full access to the session; any site could frame the app for
clickjacking.

**Solution.** A per-request nonce CSP set in `src/proxy.ts`
(`src/lib/security/csp.ts`), following Next's guide:

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
font-src 'self' data:; connect-src 'self' <supabase https> <supabase wss> <sentry ingest>;
worker-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Next stamps the nonce on its own scripts; `next-themes`' inline script receives
it through the root layout.

**Verified** on a production build: 27 of 27 script tags carry the nonce; no
CSP violation on the dashboard, analytics, market and settings pages; the
Supabase Realtime websocket is allowed; a `fetch` to another origin is blocked
(`connect-src`); an injected `<img onerror>` and a `javascript:` link do not run
(`script-src-attr`, `script-src-elem`).

**Residual.** `style-src 'unsafe-inline'` (Recharts and many components set
`style` attributes, which a nonce cannot cover; injected CSS cannot run code).
`'strict-dynamic'` lets an already-running script create further scripts, which
is how it trusts Next's chunks.

### 9. Other security headers — A05, Low — fixed

`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
denying camera, microphone, geolocation, payment, USB and topics — on every
route, from `next.config.ts`. HSTS was already set by Vercel.

### 10. Raw body into `.update()` — A04/A08, Low — fixed

**Evidence.** `PATCH /api/watchlist/[id]` passed the request JSON straight to
`.update(body)`. RLS kept `user_id` pinned, so this was not a cross-user write,
but every other column was writable through the route.

**Solution.** The route validates with `RenameWatchlistSchema` (it existed and
was unused) and updates only `name`. A scan found no other raw-body writes.

### 11. `javascript:` URLs in profile fields — A03, Low (latent) — fixed

**Evidence.** `avatar_url: z.string().url()` accepts `javascript:alert(1)` —
it is a valid URL. The profile page also sends `username`, `bio`, `location`
and `website`, which the schema stripped, so those were silently never saved
(the page still said "Perfil actualizado").

**Solution.** URLs must be `http(s)`, max 200; `username` 3–30 of
`[a-z0-9_]`; `bio` ≤ 300; `location` ≤ 50; an empty website clears it; a taken
username answers 409 instead of a database error. The same change allows the
"Sistema" theme, which the settings page offered and the API refused with 400.

**Verified:** `PATCH /api/user/profile {"website":"javascript:alert(1)"}` → 400.

### 12. Database error text in responses — A05, Low — fixed

**Evidence.** 47 routes return `error(dbError.message, 500)`; unhandled
exceptions also returned their message. Seen during the audit: *"Could not find
the function public.get_public_portfolios(filter, limit, min_positions, order,
page, sort) in the schema cache"* — function and parameter names.

**Solution.** `error()` never sends a 500's message: it logs it and returns a
generic sentence. 4xx and 503 messages are written for users and pass through.

### 13. Silent hard-coded exchange rates — A04/A08, Medium — fixed

**Evidence.** `api/rates` fell back to `MXN 17.5` / `EUR 0.92` whenever the
provider failed, with no signal. The real MXN rate during the audit was 17.00 —
a 3% error applied silently to every converted amount.

**Solution.** The last rate actually observed (any age) is used first; the
constants remain only for a database with no observation at all and log an
error when used. Removing the currency instead would be worse:
`convertCurrency` returns amounts unconverted when a rate is missing.

### 14. Vulnerable dependencies — A06, Critical — fixed in C7

`npm audit` on 2026-09-14: **25** (1 critical, 14 high, 7 moderate, 3 low). The
critical one is `next` itself (denial of service in Server Components; fixed in
16.3.5). Most high ones are transitive build/test tooling (`brace-expansion`,
`js-yaml`, `hono`, `fast-uri`, `ip-address`).

**Fixed in C7:** `next` and `eslint-config-next` 16.2.0 → 16.3.5 and
`npm audit fix` for the transitive ones — `npm audit` reports **0**. CI now runs
`npm audit --audit-level=high` in its own job, and Dependabot opens weekly
grouped update PRs.

### 15. Rate limiting — A04/A07, Medium — open (C8)

**Evidence.** `src/proxy.ts` limits `/api/*` to 60 requests/minute per IP in a
module-level `Map`. On Vercel each serverless instance has its own map, and
cold starts reset it, so the real limit is 60 × instances. The per-user tiers
in `src/lib/api/rate-limit.ts` use Upstash only when its variables are set and
allow everything otherwise. Login brute force is limited by Supabase Auth's own
rate limits.

**Recommendation.** Configure Upstash in production (the code is ready) and
move the proxy's per-IP limit onto it. C8 measures the current behaviour under
load. Also observed: during the accessibility audit, loading 20 pages back to
back tripped the limit for a single real user.

### 16. Leaked-password protection disabled — A07, Medium — owner action

Supabase's security advisor reports it off. Enabling it (Authentication →
Providers → Email → *Prevent use of leaked passwords*) rejects passwords found
in HaveIBeenPwned. It is a project setting; this audit does not change account
security settings.

### 17. `share_token` visible on public portfolios — A01, Low — accepted

`portfolios_select` exposes every column, including `share_token`, for public
portfolios. The token only matters for `visibility = 'shared'`; if an owner
switches a public portfolio to shared, a token read earlier still works.
Column-level `SELECT` revokes break `select('*')` across the app. Recommended:
rotate the token whenever visibility changes.

### 18. JavaScript-readable session cookies — A07, Low — accepted

`@supabase/ssr` stores the session in cookies the browser client can read, by
design. An XSS could read them; findings 8 and 11 are the mitigation.

### 19. SECURITY DEFINER functions still flagged — Info — by design

The linter lists `auth_user_portfolio_ids`, `auth_user_position_ids`,
`user_owns_portfolio`, `user_has_portfolio_share` (used inside RLS policies;
revoking them broke every write once — migrations 006a/006b/015), the two RPCs
fixed in finding 4, `soft_delete_portfolio`, `toggle_follow`,
`toggle_portfolio_like` and `handle_new_user`. Every one filters on
`auth.uid()` or is a trigger function; none returns another user's data.

### 20. Reviewed with no issue — Info

- **Injection (A03).** Database access goes through PostgREST/supabase-js, which
  parameterises values. The one interpolated filter string
  (`api/social/feed`) interpolates `auth.uid()` from the verified session. No
  migration builds dynamic SQL. No `dangerouslySetInnerHTML` in the app. CSV
  import is validated row by row with zod (symbol regex, numeric bounds, ≤ 500
  rows).
- **Authentication on routes (A07).** All 73 route files call
  `supabase.auth.getUser()` (verified server side) or the cron check, except
  `POST /api/analytics/vitals`, which is intentionally anonymous, validates a
  hostile body and writes only metric/route/value. `/admin/metrics` is gated
  by `ADMIN_EMAILS` and fails closed. Post-login redirects accept same-origin
  paths only (`safe-redirect.ts`).
- **Authorisation with the service role (A01).** Background jobs check the
  portfolio through RLS with the user's client before a job row exists, and
  compute with the user's client.
- **Secrets (A02).** No keys in the repository (scanned for common key formats;
  `.env.local` is git-ignored; only `.env.local.example` is tracked). The
  service-role key is used only server-side (`src/lib/supabase/admin.ts`); the
  browser sees only `NEXT_PUBLIC_` values (URL and anon key). Share tokens are
  128-bit random (`gen_random_bytes(16)`).
- **SSRF (A10).** Outbound requests go to fixed hosts; symbols are
  `encodeURIComponent`-escaped into the path.
- **Logging (A09).** Sentry is configured with `sendDefaultPii: false` and
  route pathnames only; API errors are recorded to `error_events` without
  bodies or query strings.

### 21. Analytics results cached by portfolio id — A01, High (latent) — fixed

Found during C8, after this audit.

**Evidence.** Thirteen routes — the twelve under `/api/analytics/[pid]/*` that
cache, and `/api/compare/history` — computed with the signed-in user's
Supabase client, so RLS decided what went into the result, then stored it under
a key made of the portfolio id alone (`analytics:risk:<pid>`). `withCache` reads
the key before anything touches the database.

**Risk.** With Upstash configured — the recommendation of finding 15 — the
first person to open a portfolio's analytics fills the cache, and any signed-in
user who requests that portfolio id afterwards is served the result: positions,
weights, value, returns of a private portfolio, without RLS running for them.
Caching is disabled while the Upstash variables are unset, which is the case
today, so nothing was exposed. It would have been switched on by following this
document.

**Solution.** Every such key now includes the caller (`analytics:risk:<user>:<pid>`),
so a cached value is only ever returned to the identity RLS computed it for.
`tests/lib/cache/cache-key-scope.test.ts` scans every route's `withCache`,
`cacheGet` and `cacheSet` keys and fails when one lacks `user.id` without being
a public market or discovery key; it flags all twelve analytics routes against
the previous code. Background jobs were already safe: `jobKey()` hashes the user
id, and `analytics_jobs` rows are owner-only under RLS.

## Re-running the checks

```bash
npm run test:run -- tests/lib/api/cron-auth.test.ts tests/lib/security
npm audit --audit-level=high
curl -sI https://project-tri0w.vercel.app/login | grep -i content-security-policy
```

Database: the Supabase security advisor (`get_advisors`), and the role
simulations used here — run inside a transaction that ends by raising an
exception so nothing is committed:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<user uuid>","role":"authenticated"}', true);
set local role authenticated;
update profiles set is_verified = true where user_id = auth.uid(); -- expect: permission denied
rollback;
```
