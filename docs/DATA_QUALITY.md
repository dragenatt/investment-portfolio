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
ratio also lands within 2% of a common corporate-action ratio (2:1, 3:1, 3:2,
1:10 and so on).

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

**Status: the detector ships, the correction does not yet.**

`price_history` stores raw OHLC, and `yahooHistory` in `src/lib/services/market.ts`
reads only `indicators.quote[0]` from the Yahoo chart response — the
`indicators.adjclose` array sitting next to it is ignored. Neither
`twelve-data.ts` nor `finnhub.ts` requests adjusted series either.

The consequence is concrete: for any asset that split or paid a meaningful
dividend inside the window, returns, volatility, Sharpe, Sortino, beta, alpha,
drawdown and Monte Carlo calibration are all computed on prices that jump for
non-economic reasons. `suspected-split` exists to make that visible in the
meantime.

Until adjusted prices land, treat a `suspected-split` flag as meaning *the risk
metrics for this asset are wrong*, not merely uncertain.
