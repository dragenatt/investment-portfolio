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

| Project | File | Needs | Runs in CI |
|---|---|---|---|
| `public` | `e2e/public.spec.ts` | nothing | always |
| `setup` | `e2e/auth.setup.ts` | `E2E_EMAIL`, `E2E_PASSWORD` | only when the secrets exist |
| `authenticated` | `e2e/authenticated.spec.ts` | the session `setup` leaves | only when the secrets exist |

**The skips are the point.** A suite that passes because it never ran is worse
than no suite: it reports confidence nobody earned. Playwright lists every
skipped test with its reason, so a green CI run says exactly how much actually
executed.

Current state, verified locally against a real dev server with no credentials:

```
10 passed, 16 skipped
```

The sixteen skipped are the setup and the fifteen signed-in flows. They are
written and will run the moment credentials are configured; nobody should read
the green as covering them.

## How the signed-in half runs

`setup` signs in once through the real login form, saves the session to
`e2e/.auth/user.json` (git-ignored), and every signed-in spec starts from that
session instead of signing in again.

It also keeps a **synthetic book** in the test account — `E2E · cartera
sintética`: 10 AAPL, 5 MSFT and 3 VOO bought at round prices 400 days ago, so
every analytics window has history. It is created on the first run and reused
afterwards; its id is written to `e2e/.auth/book.json` for the analytics specs.
`E2E_PORTFOLIO_ID` still overrides it, but is no longer needed.

**It refuses a real account.** The signed-in specs create and delete portfolios
and goals. Everything the suite creates is named with the prefix `E2E`, so if
the account holds any portfolio without that prefix, `setup` fails with an
error saying so and nothing else runs. Pointing the suite at a personal account
by mistake stops there instead of writing into somebody's data.

Anything a spec creates — a portfolio, a goal saved from the advisor — is
deleted by that same spec, in a `finally`, whether it passed or not.

## Setting up the authenticated half

1. **Create a dedicated test user.** In the Supabase dashboard, *Authentication
   → Users → Add user → Create new user*, with *Auto Confirm User* checked.
   Use an address that is not a person's (for example a `+e2e` alias of a
   mailbox you control) and a long generated password. Give it no real data:
   the setup builds the synthetic book itself.

   Where: this project has one Supabase project, so the test user lives beside
   real users. Row-level security keeps its data apart from theirs and its
   portfolios are private by default, so it never shows in rankings. A Supabase
   preview branch would isolate it completely, at the cost of a paid branch
   and of seeding price history there too.

2. **Run it locally first**, before trusting CI with it:

   ```bash
   E2E_EMAIL=<test user> E2E_PASSWORD=<password> npm run test:e2e
   ```

   The first run creates the synthetic book. Expect every test to run and pass;
   a skip with credentials set means something is miswired.

3. **Add them as repository secrets** — never as variables, never in a file:

   ```bash
   gh secret set E2E_EMAIL
   ```

   ```bash
   gh secret set E2E_PASSWORD
   ```

   `gh secret set` asks for the value instead of taking it as an argument, so it
   never lands in shell history. CI already passes both to Playwright.

## Rotating the credentials

The test user holds nothing that cannot be rebuilt, so rotation is a
replacement rather than a password change:

1. Create a new test user as in step 1 above.
2. Run the suite locally with the new credentials; the setup builds its
   synthetic book.
3. Update both secrets with `gh secret set E2E_EMAIL` and
   `gh secret set E2E_PASSWORD`.
4. Delete the old user in *Authentication → Users*. Its portfolios, goals,
   notifications and history go with it (every user table cascades on delete).

Rotate when someone who knew the password leaves the project, if the password
ever appears anywhere but the secret store, or on whatever schedule the team
keeps for other credentials.

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

**The advisor end to end.** The questionnaire is answered step by step through
its labelled fields, and the result must report the advisor's fixed draw
(`semilla 20260912`, task 5.1). A second spec saves that plan as a goal linked to
the synthetic book and checks it shows in *Metas* with its pace classification,
then deletes it.

**The newer analytics surfaces.** The Asignación, Backtesting and *¿Qué pasaría
si?* tabs are opened on the synthetic book and checked for broken values, and
the notification tray and the change history are opened.

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
- **A goal's pace changing over time.** The goal spec checks that a saved goal
  is classified; watching the classification move needs time to pass or a
  back-dated goal, and that is covered by the unit tests of `classifyPace`.
