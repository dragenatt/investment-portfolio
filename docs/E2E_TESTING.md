# End-to-end testing

Unit tests prove a function computes what it should. They cannot prove the
number reaches the screen, that the page renders without throwing, or that a
sanitiser wired into the API boundary is actually holding in a running app.
That is what this suite is for.

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright's UI mode, for writing new specs
```

## The suite is deliberately split

| File | Needs | Runs in CI |
|---|---|---|
| `e2e/public.spec.ts` | nothing | always |
| `e2e/authenticated.spec.ts` | `E2E_EMAIL`, `E2E_PASSWORD` | only when the secrets exist |
| the analytics block inside it | also `E2E_PORTFOLIO_ID` | only when that exists too |

**The skips are the point.** A suite that passes because it never ran is worse
than no suite: it reports confidence nobody earned. Playwright lists every
skipped test with its reason, so a green CI run says exactly how much actually
executed.

Current state, verified locally against a real dev server:

```
10 passed, 9 skipped
```

The nine skipped are the signed-in flows. They are written and will run the
moment credentials are configured; nobody should read the green as covering
them.

## Setting up the authenticated half

1. Create a user in the Supabase project you point the tests at. Use a
   throwaway account on a **non-production** project — these tests create
   portfolios.
2. Give it a portfolio with at least a few holdings that have price history, so
   the analytics pages have something to compute.
3. Set the variables:

```bash
E2E_EMAIL=e2e@example.test
E2E_PASSWORD=...
E2E_PORTFOLIO_ID=<uuid of that portfolio>
```

In CI these are repository secrets of the same names.

## What is checked, beyond "does it load"

**No broken numbers.** `expectNoBrokenNumbers` scans the rendered page for
`NaN`, `Infinity`, `undefined` and `[object Object]`. These never throw — they
just render — and a reader who sees "NaN%" once stops trusting every other
figure on the page. Roadmap item 14 of P1-3 asks for this specifically.

**No console errors.** Every test runs through a fixture that fails if the
browser console logs an error or the page throws. It is the cheapest broad net
there is: a hydration mismatch, a failed fetch or a thrown handler surfaces
without anyone writing an assertion for it. Third-party noise the app cannot
control (favicons, `ResizeObserver`) is filtered out.

**The API guard, in a running app.** The analytics block asserts no endpoint
response contains `: NaN` or `: Infinity`. `success()` sanitises non-finite
numbers into null at the API boundary, and unit tests prove the sanitiser works
— this proves it is actually wired into the routes.

**Authorisation.** Every protected route is checked to redirect an anonymous
visitor to login. That is a security property, and it is the kind that breaks
silently when a layout is refactored.

**Responsiveness.** The login page is checked at 375px for horizontal overflow,
which is the failure mode that makes a page unusable on a phone without looking
broken on a laptop.

## Notes for writing new specs

- Import `test` and `expect` from `./helpers`, not from `@playwright/test`
  directly. The helper's `test` carries the console-error fixture.
- Prefer `getByRole` and `getByLabel` over CSS selectors: they survive styling
  changes and they fail when something stops being reachable by keyboard or by
  a screen reader, which is a bug worth failing on.
- The app is in Spanish and parts of it in English, so the matchers accept
  both — `/iniciar|entrar|sign in/i` rather than one language.
- `retries` is 1 in CI and 0 locally. A test that only passes on the retry is
  flaky, and locally that should be visible immediately rather than smoothed
  over.

## What this does NOT cover

- **Any browser other than Chromium.** Adding Firefox and WebKit is a one-line
  change to `playwright.config.ts`, at roughly triple the CI time.
- **Visual regressions.** No screenshot comparison. Playwright supports it; it
  needs a baseline committed per platform and it is a separate decision.
- **The signed-in flows, until credentials exist.** Stated again because it is
  the most important limitation on this page.
