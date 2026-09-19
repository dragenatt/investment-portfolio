# API ↔ UI contracts

Two bugs of one kind reached production in the same week: the income tab and
the "Por Sector" breakdown each read a field their route did not send. Each
shape was written twice — where the route built it and where the hook declared
it — and 2,081 passing tests never compared the two. This is what compares
them now, for every `/api/analytics/[pid]/*` route.

## How it holds

| Piece | Where | What it catches |
|---|---|---|
| One schema per route | `src/lib/contracts/analytics.ts` | — (the single definition) |
| Hook types inferred from it | `src/lib/hooks/use-analytics.ts` | A screen reading a field the contract lacks **does not compile** |
| Every handler called and parsed | `tests/contracts/analytics-routes.test.ts` | A route that stops sending a field, renames it or changes its type **fails a test** |
| Coverage rules | `tests/lint/analytics-contracts.test.ts` | A new route without a contract; a URL built outside the hooks; a payload type written by hand |
| `shape<T>(name, keys)` | contracts module | A service type that gains a required field: the key list stops compiling until it is added, and the test then checks the route sends it |

Payloads a route builds field by field are described field by field. Parts
that are a service's result passed through whole — a `RiskSources`, a
`PortfolioHealth`, a `ScenarioResult` — are typed by the service's own type and
checked at run time for every key it requires.

## Proof that it would have caught 1.1

With the contract put back the way the hook declared the slice before task 1.1
(`bySector: { sector, value, pct }`), the route test fails:

```
allocation breaks its contract:
✖ Invalid input: expected string, received undefined
  → at bySector[0].sector
```

And with the page's pre-1.1 line restored (`bySector.map((s: { sector: string;
pct: number }) => … s.sector …)`), the build fails:

```
Property 'sector' is missing in type '{ name: string; value: number; pct: number; }'
but required in type '{ sector: string; pct: number; }'.
```

Either one alone would have stopped the bug.

## The environment the handlers run in

`tests/contracts/fake-env.ts`. Nothing leaves the process.

- **Supabase** is an in-memory client answering the query builder calls the
  routes make (filters, ordering, limits, `single`, column aliases such as
  `currency:base_currency`, pre-joined embeds such as `position:positions`).
- **The book** is synthetic: AAPL, MSFT and VOO in dollars and WALMEX.MX in
  pesos, in a peso-based portfolio, bought 700 days ago, with three recorded
  dividends. Two currencies on purpose — conversion paths are exercised.
- **Prices** are generated per symbol: a seeded lognormal walk since 2006,
  served as stored history (the last ~900 days), provider history
  (`market.getHistory`) and quotes (`market.getBatchQuotes`), so every route
  sees the same numbers.
- **The network** is cut: `fetch` throws, and Redis and the service-role key
  are unset. The risk-free rate falls back to its documented constant.

Each case also asserts the answer is a real result — frontier points, stress
episodes, backtest schedules — and not a "not enough data" message, which
would satisfy the contract without testing it.

## Adding a route

1. Describe what its screen reads in `src/lib/contracts/analytics.ts` and add
   it to `ANALYTICS_CONTRACTS` under its path segment.
2. Type its hook with `Of<typeof Contract.YourSchema>`.
3. Add a case to `ROUTES` in `tests/contracts/analytics-routes.test.ts`: the
   query its screen sends and what makes the answer a full one.

The lint test fails until step 1 is done, and `covers every contract` fails
until step 3 is.

## Routes with no screen

`benchmark` and `performance` are not requested by anything in the app, so
there is no reader to hold them to. They are listed in the lint test with the
reason; if a screen starts using one, it needs a contract first.

## What running it found

- The risk hook type promised `rolling_volatility`, which the route has not sent
  since rolling risk moved to `rolling_risk`. No screen read it; the type was
  wrong, and the contract no longer has it.
- `RiskMetrics` (`components/analytics/risk-metrics.tsx`) fetched the risk route
  with its own untyped fetcher and read `volatility`, `sharpe` and
  `maxDrawdown`, none of which the route sends. Nothing rendered it; it was
  deleted.

## What this does not check

- **Values.** A field present with the wrong number passes. The financial
  regression suite is what checks numbers.
- **Inside service types.** A passed-through service result is checked for its
  top-level keys; its nested types are held by the compiler, since route and
  screen share the service's type.
- **The "not enough data" branches.** Each route is exercised with a book that
  has enough history; the message branch is typed, not called.
