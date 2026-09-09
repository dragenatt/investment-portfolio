# Financial assumptions

Every number the Financial Engine uses that is *not* observed from the user's own
data is an assumption, and every assumption here carries a source, a unit and a
date. Anything that cannot name its source does not belong in a calculation.

This document is the central register the roadmap's P0-20 calls for.

**The rule: nothing that cannot name its source belongs in a calculation.** A
figure is one of three things, and the difference matters more than the number:

- **Observed** — measured from the user's own data or a publisher's feed.
- **Assumed** — a modelling choice, defensible but chosen. Must carry its
  reasoning here.
- **Configured** — supplied by the operator through an environment variable.

Every assumption below says which it is, in what unit, on what basis, and which
modules consume it.

## Register at a glance

| Assumption | Value | Unit | Kind | Where |
|---|---|---|---|---|
| Risk-free rate | per currency, live | annual fraction | observed → configured → assumed | `risk-free-rate.ts` |
| Trading days per year | 252 | days | assumed (convention) | `analytics.ts`, `snapshots.ts`, risk route |
| Expected return, conservative | 4% | annual fraction | assumed | `RENDIMIENTOS` |
| Expected return, moderate | 7% | annual fraction | assumed | `RENDIMIENTOS` |
| Expected return, aggressive | 11% | annual fraction | assumed | `RENDIMIENTOS` |
| Volatility, conservative | 5% | annual fraction | assumed | `VOLATILIDADES` |
| Volatility, moderate | 10% | annual fraction | assumed | `VOLATILIDADES` |
| Volatility, aggressive | 16% | annual fraction | assumed | `VOLATILIDADES` |
| Advisor target confidence | 75% | probability | assumed | advisor page |
| Advisor simulations | 1,000 | count | assumed | advisor page |
| Simulated return floor | -99% | annual fraction | assumed (guard) | `advisor.ts` |
| Covariance window | 252 | days | assumed | `monte-carlo.ts` |
| Default benchmark | SPY | symbol | assumed | `benchmarks.ts` |
| Inflation | — | — | **not modelled** | — |
| Commissions and spreads | — | — | **not modelled** | — |
| Taxes | — | — | **not modelled** | — |

Sections below give the reasoning for each.

---

## Risk-free rate

**What it is.** The return an investor could earn with no risk, in their own
currency. Sharpe, Sortino and Jensen's alpha all subtract it before judging a
portfolio, so it is not cosmetic: a rate that is too low flatters every
portfolio, and a rate borrowed from another currency makes the comparison
meaningless.

**Why it is per currency.** Short-term sovereign rates diverge widely. Measuring
a peso portfolio against a US T-Bill yield credits it with an excess return it
never earned; measuring a dollar portfolio against CETES buries a good result.
`getRiskFreeRate(currency)` resolves the rate for the currency the portfolio is
denominated in.

**Unit.** Annual, expressed as a fraction — `0.0425` is 4.25%. This matches
`analytics.ts`. Environment variables are the exception and take a percentage
(`RISK_FREE_RATE_MXN=7.45`), because that is how the publishers write it.

### Sources, in the order they are tried

| Currency | Source | Instrument | Credentials | Cadence |
|---|---|---|---|---|
| USD | [US Treasury Fiscal Data](https://fiscaldata.treasury.gov/) | Average interest rate, Treasury Bills | none | monthly |
| EUR | [ECB Data Portal](https://data.ecb.europa.eu/) | Euro short-term rate (€STR) | none | daily |
| MXN | [Banxico SIE](https://www.banxico.org.mx/SieAPIRest/) | CETES 28 días (series `SF43936`) | `BANXICO_API_TOKEN` | daily |
| MXN | [OECD SDMX](https://sdmx.oecd.org/) | Mexico 3-month interbank rate (`IR3TIB`) | none | monthly |

CETES is the rate Mexican investors actually price against, so Banxico goes
first — but it requires a free token. Without one the chain falls through to
OECD, which publishes the same country's short-term rate with no credentials, so
a peso portfolio still gets a peso rate out of the box.

### Fallbacks

1. **Publishers**, in the order above. A provider that errors, times out (4s),
   answers nothing, or answers something outside the plausible band is skipped.
2. **Environment**: `RISK_FREE_RATE_MXN`, `RISK_FREE_RATE_USD`,
   `RISK_FREE_RATE_EUR` — an annual percentage. Intended for offline development
   and for pinning a rate during a reproducible study.
3. **Documented constants**, below.

Results from step 2 or 3 are flagged `isFallback: true` and carry a `source`
string, so the interface can say the rate is stale rather than implying it is
live. The risk endpoint returns this as `risk_free_rate`.

### Documented constants

Last-resort values, each a real observation captured on **2026-09-08** from the
same publisher the matching provider queries. They go stale; the fallback flag
is what makes that visible.

| Currency | Value | As of | Source |
|---|---|---|---|
| USD | 3.788% | 2026-08-31 | US Treasury, average rate on Treasury Bills |
| EUR | 2.188% | 2026-09-07 | ECB, €STR |
| MXN | 6.79% | 2026-08 | OECD, Mexico 3-month interbank rate |

### Validation

A rate is accepted only when finite and within **-5% to 50%** annual. The lower
bound is not paranoia — the euro area held policy rates below zero from 2014 to
2022. The upper bound catches parsing accidents, such as reading a percentage as
a fraction.

### Caching

24 hours, keyed `risk-free-rate:<CCY>` through the existing `withCache` /
Upstash layer. These figures are published daily at best, so a shorter window
would only spend the publishers' rate limits.

### Currency and the benchmark

The risk-free rate follows the portfolio's currency, and since P0-14 the
benchmark is configurable per portfolio, so the two can now be made to agree.
They are not forced to: choosing SPY for a peso book still puts an exchange rate
inside its alpha. Every available benchmark records its own currency in
`BENCHMARKS`, and the risk endpoint reports which one the comparison used.

### What this replaced

Two contradictory hardcoded rates: `0.0425` in `snapshots.ts` (labelled "US
T-Bills approximate") and `0.10` in the risk endpoint (labelled CETES but
applied to every portfolio regardless of currency). The same portfolio could
therefore report two different Sharpe ratios depending on which surface asked.


---

## Trading days per year

**252, assumed.** The market convention for annualising a daily figure: roughly
365 days less weekends and holidays. Used to scale daily volatility (×√252) and
daily mean return (×252) throughout `analytics.ts`, `snapshots.ts` and the risk
endpoint.

It is a convention, not a measurement — the actual count varies by year and
exchange. What matters is that **one number is used everywhere**, because a
Sharpe ratio annualised on 252 and a volatility annualised on 250 do not
describe the same portfolio.

## Expected returns per profile

**4% / 7% / 11% annual, assumed.** `RENDIMIENTOS` in
`src/lib/utils/investment-profile.ts`.

These are long-run expectations for the model portfolios in `CARTERAS`, not
forecasts and not measurements. The ordering carries the real content: a book
that is 70% short-term government debt should not be expected to return what an
all-equity one does, and the advisor's whole point is showing a learner that the
higher number comes attached to the wider distribution.

**How to improve them.** Compute an expected return from the actual holdings
using the same price history the risk engine already reads, rather than a
per-profile constant. Until then they stay flagged as assumptions.

## Volatility per profile

**5% / 10% / 16% annual, assumed.** `VOLATILIDADES`, same file.

Before P0-21 the engine applied a flat **10% to all three profiles**, which is
the one number that cannot be right for all of them: it made the conservative
portfolio look about twice as risky as it is, and the aggressive one roughly
half. The three values are ordered by the composition in `CARTERAS` — mostly
government debt, balanced, all-equity including emerging markets.

Same improvement path as expected returns: derive them from the covariance of
the real holdings.

## Advisor target confidence

**75%, assumed.** `PROBABILIDAD_OBJETIVO` in the advisor page.

The confidence `aporteParaProbabilidadMeta` solves for. It is a choice about how
much margin to demand, not a fact — 50% would mean recommending the contribution
that reaches the goal in half of scenarios, which is what the previous
deterministic annuity solution effectively did and why its advice contradicted
itself.

## Advisor simulation count

**1,000 paths, assumed.** Enough for stable deciles without stalling the
browser. It is recorded in every result's `modelo` block because a probability
from 100 paths is not the same claim as one from 10,000.

## Simulated return floor

**-99% annual, assumed guard.** `MIN_ANNUAL_RETURN` in `advisor.ts`.

A long, unlevered position cannot lose more than everything, and
`Math.pow(1 + r, 1/12)` with `r` below -100% is `NaN` rather than a loss. The
floor is what keeps the monthly conversion away from a negative base.

## Covariance window

**252 trading days, assumed.** The lookback the Monte Carlo engine estimates
covariance over. One year balances "enough observations to estimate a
correlation" against "recent enough that the correlation still holds" —
correlations are not stable, and this is the parameter that decides how much
history is allowed to speak for today.

## Default benchmark

**SPY, assumed.** Used when a portfolio has not chosen one. See
`benchmark_symbol` (P0-14) — and note the currency caveat under the risk-free
rate: a peso portfolio measured against a dollar benchmark carries an exchange
rate inside its alpha.

---

# Not modelled

Naming these is part of the register. A reader who does not see inflation in a
projection should be told it is absent, not left to assume it was handled.

## Inflation

**Not modelled.** Every projection is in nominal terms. A plan reaching
$1,000,000 in 20 years reaches a million *pesos of that year*, which buys
materially less than a million today. This is the single largest unmodelled
factor in the advisor, and the roadmap addresses it under the education waves.

## Costs, commissions and spreads

**Not modelled.** All returns are gross. Real commissions, bid-ask spreads and
fund expense ratios reduce them, and rebalancing has a cost the rebalancing
engine currently prices at zero. Roadmap P1-22.

## Taxes

**Not modelled.** No ISR on gains, no withholding on interest or dividends.

## Dividends

**Not recoverable from the current data.** Everything measured is a *price*
return, not a *total* return — a dividend drops the price on the ex-date with no
signature distinguishing it from an ordinary down day. For a high-yield holding
this understates the return by roughly the dividend yield per year. See
`docs/DATA_QUALITY.md`.
