# Market data quality

Every risk number in InvestTracker is only as good as the price series
underneath it, and a bad series does not announce itself. A missing week
quietly shrinks measured volatility. An unadjusted split shows up as a -75%
day. A stalled feed reports a flat line as an asset with no risk.

`src/lib/services/data-quality.ts` inspects a series before anyone measures
anything on it and returns a score out of 100 plus the specific problems it
found.

```
GET /api/market/AAPL/data-quality
```

## The engine is advisory

**Nothing here blocks a calculation.** A score of 30/100 does not hide the
Sharpe ratio; it tells the reader the Sharpe ratio was computed on a series with
a three-week hole in it, and lets them weigh it accordingly.

That is a deliberate choice. The alternative — returning `null` below a
threshold — empties the dashboard for exactly the assets a learner is most
likely to be curious about (recent listings, thin markets, anything outside US
large caps). Roadmap rule #8 forbids letting an *invalid* number reach the
interface: `NaN`, `Infinity`, a probability above 1. A number computed from
imperfect but real data is not invalid, it is uncertain, and the honest
treatment of uncertainty is to label it.

## What it detects

| Code | Severity | What it means |
|---|---|---|
| `no-data` | critical | No history at all. Nothing can be computed. |
| `missing-close` | warning / critical | Days with no closing price. Returns across them are skipped. |
| `non-positive-close` | critical | A zero or negative price. No traded asset has one; this is a feed error. |
| `duplicate-date` | warning | A date appearing twice. Double-counts a return and inflates volatility. |
| `calendar-gap` | warning / critical | More than 5 calendar days between bars. Hides the moves inside the gap. |
| `extreme-move` | warning | A move past ±50% that snaps back — a bad print. |
| `suspected-split` | critical | A clean multiple-of-price jump that *persists*. See below. |
| `stale` | warning / critical | The newest bar is over a week old. |
| `short-history` | info / critical | Fewer than 20 usable observations. Volatility and beta are not meaningful yet. |
| `flat-line` | critical | The price never changes. Opt-in (`requireMovement`), since some instruments genuinely do not trade daily. |

### Splits versus bad prints

Both look like an enormous one-day move, and they need opposite responses: a
split is real and the *series* is wrong, a bad print is noise and the *day* is
wrong. They are told apart by what happens next. A split leaves the price at a
new level, so the following day is normal; a glitch snaps back. The engine
therefore checks the day after the jump, and only calls it a split when the
ratio also lands within 2% of a common corporate-action ratio (2:1, 3:1, 4:1,
1:10 and so on — see the threshold limitation under Corporate actions).

## Scoring

Every issue carries a penalty; the score is `100 - Σ penalties`, floored at 0.
Penalties are capped per issue so one pervasive problem cannot mask several
distinct ones — a series with a hundred missing closes *and* an unadjusted split
must report both.

| Score | Grade |
|---|---|
| 95-100 | excellent |
| 80-94 | good |
| 60-79 | fair |
| 1-59 | poor |
| 0 | unusable |

The function is pure and deterministic: the same bars always produce the same
report. `asOf` is injected rather than read from the clock, so staleness checks
are reproducible in tests and in scheduled jobs.

## Corporate actions (P0-7)

A stock split is not a market move, but a raw price series cannot tell the
difference. NVDA's 10:1 split in June 2024 reads as a -90% day, which then
dominates volatility, ruins the Sharpe ratio, invents a max drawdown and
miscalibrates every Monte Carlo drawn from those returns.

`src/lib/services/corporate-actions.ts` fixes this in two ways, in order of
preference.

### 1. Use the provider's adjusted close

`yahooHistory` previously read only `indicators.quote[0]` from the Yahoo chart
response and ignored the `indicators.adjclose` array sitting next to it. It now
carries `adjClose` through, and when every bar has one the whole series is taken
as-is — Yahoo has already adjusted for both splits and dividends.

Twelve Data and Finnhub are not asked for adjusted series on their free tiers, so
they fall through to the second route.

### 2. Derive the split adjustment from raw prices

`price_history` stores raw OHLC, but a split can still be undone from the raw
series alone, because it leaves a signature a market move does not: a clean,
persistent, multiple-of-price step.

Each price before a detected split is divided by that split's ratio, compounding
backwards through multiple splits, so the newest price stays exactly as quoted
and the history is restated in today's share terms — the convention every data
vendor uses. Pairing adjusted historical prices with today's share count is what
keeps a synthetic portfolio value continuous across the split: a holder of 100
shares at $400 became a holder of 400 shares at $100, and the book never changed
value.

Applied in `adjustSeriesBySymbol`, which the risk and Monte Carlo endpoints run
over everything they read from `price_history`. Raw prices are still what gets
cached; adjustment happens on read.

### What this cannot recover

**Splits smaller than the detection threshold.** Only a jump larger than 50% is
separable from an ordinary bad day. A 3:2 split moves the price by 33% and is
deliberately left alone — catching it would mean rescaling real crashes off a
false positive. Those need a provider adjusted close.

**Dividends.** A dividend also drops the price on the ex-date without destroying
value, but leaves no recognisable signature: a 0.5% drop is indistinguishable
from an ordinary down day. Recovering it needs the dividend record itself, which
none of the configured providers is asked for today.

The consequence is that everything measured here is a **price return, not a
total return**. For a high-yield holding that understates the return by roughly
the dividend yield per year and slightly overstates measured volatility.

**Ticker and exchange changes.** A symbol that changed ticker has its history
split across two symbols, and nothing in the current schema links them. The
`calendar-gap` and `short-history` flags are what surface this today.

### Telling a split from a bad print

Both look like an enormous one-day move and need opposite responses: a split is
real and the *series* is wrong, a bad print is noise and the *day* is wrong.
They are separated by what happens next — a split leaves the price at its new
level, a glitch snaps back — and a jump only counts as a split when it persists
*and* lands within 2% of a recognised corporate-action ratio.

One subtlety worth naming: a single bad print produces **two** jumps, the drop
and the bounce back. The bounce persists and often lands on a clean ratio, so
without special handling it gets read as a split and the entire history is
rescaled off one bad tick. A jump that undoes the anomaly immediately before it
is therefore skipped.

`classifyJumps` is the single implementation of this. The data quality report
and the correction call the same function, so they can never disagree about what
happened on a given day.

## How a stored quote gets refreshed

`current_prices` is the quote every screen falls back to and the table Realtime
streams from. Two things write it:

1. **A browser asking for the symbols on screen** (`/api/market/batch`), which
   publishes what moved so every other open tab updates without a request.
2. **The nightly snapshot job**, which already fetches a fresh quote for every
   held symbol to value the snapshots and now publishes those too
   (`quote-store.ts`).

Before (2), a holding nobody had open kept whatever price it was last looked at
with: held symbols were found 43 hours old on production while the ones on the
owner's screen were minutes old. Every holding now has a quote at most a day
old, and the freshness label (`freshness.ts`) says which it is.

The route used to answer for the first twenty symbols and drop the rest
silently, so a book with more holdings than that had no live price for the
remainder — and their stored quote never refreshed, because that route is what
writes it. It now fetches every symbol asked for, in batches of twenty (the
provider's own limit), up to the hundred that Realtime's filter can watch.

## Where a sector and a country come from

`company_data` is read by five screens — the allocation breakdown, the exposure
map, attribution, the optimiser's sector caps and the concentration
notification — and until 2026-09-20 **nothing ever wrote to it**. Production
held four rows, seeded by hand (AAPL, GOOGL, NVDA, VOO), so "Por Sector"
described four of thirty positions and the geography chart one country.

Two sources fill it now, nightly, for held symbols only:

1. **A written-down table** (`company-profiles.ts`), for instruments with no
   company behind them. An index is not a company, and an ETF's sector is its
   mandate rather than an industry — VNQ is Real Estate, GLD is Commodities,
   VOO is ETF, ^N225 is an Index domiciled in JP. Source: each fund's own
   factsheet, read 2026-09-20.
2. **Finnhub `/stock/profile2`** for everything else: free tier, already the
   fallback quote provider, and it answers with the industry and the country
   of the listing. Needs `FINNHUB_API_KEY`; without it only (1) applies.

The listing suffix has the last word on the country — `.MX` is Mexico, `.SA`
Brazil — because a US provider reporting a Mexican listing as American is
exactly the error the map would repeat. A symbol neither source covers is left
alone: "Unknown" is the truth about a ticker nobody can classify, and several
of the ones in production are not real tickers.

A profile is kept for 30 days, and an existing row is updated field by field so
the fundamentals stored alongside it (P/E, 52-week range, analyst targets)
survive the write.

### Symbols no provider knows

A symbol the provider chain cannot resolve never gets a row at all. On
production these are tickers written without the suffix the provider expects —
a BMV listing as `FEMSAUBD` rather than `FEMSAUBD.MX` — and instruments that
are not listings (`BITCOIN.XBT`). Their holdings are valued at average cost and
labelled "sin precio"; nothing is invented for them. Normalising a ticker as it
is entered would fix the first kind, and is not done today.
