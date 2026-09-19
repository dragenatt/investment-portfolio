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
| Trading days per year | 252 | days | assumed (convention) | `src/lib/constants/financial-constants.ts` — every consumer imports it from there |
| Expected return, conservative | 4% | annual fraction | assumed | `RENDIMIENTOS` |
| Expected return, moderate | 7% | annual fraction | assumed | `RENDIMIENTOS` |
| Expected return, aggressive | 11% | annual fraction | assumed | `RENDIMIENTOS` |
| Volatility, conservative | 5% | annual fraction | assumed | `VOLATILIDADES` |
| Volatility, moderate | 10% | annual fraction | assumed | `VOLATILIDADES` |
| Volatility, aggressive | 16% | annual fraction | assumed | `VOLATILIDADES` |
| Advisor target confidence | 75% | probability | assumed | advisor page |
| Advisor simulations | 1,000 | count | assumed | advisor page |
| Simulated return floor | -99% | annual fraction | assumed (guard) | `advisor.ts`, `scenario-engine.ts` (`planDrift`) |
| Advisor process | the scenario engine's lognormal monthly step, drift ln(1 + r) | model | assumed | `scenario-engine.ts` (`planMonthFactor`) |
| Covariance window | 252 | days | assumed | `monte-carlo.ts` |
| Default benchmark | SPY | symbol | assumed | `benchmarks.ts` |
| Portfolio Health thresholds | nine components, 0–100 | score | cited limits + **educational convention** | `portfolio-health.ts` |
| Liquidity participation | 20% of daily volume | fraction | assumed (convention) | `portfolio-health.ts` |
| Scenario engine process | correlated GBM, monthly steps | model | assumed | `scenario-engine.ts` |
| Scenario engine paths | 1,000 per request (max 10,000) | count | assumed | `scenario-engine.ts` |
| Reliable history for a projection | 3 years | years | assumed (convention) | `scenario-engine.ts` |
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

### Currency of weights, amounts and returns

Every analytics result is in the **portfolio's base currency**, and says so
(`currency` on the payload, a "Moneda" assumption in `_meta`):

- **Weights and amounts** — a holding's value is its quantity × close converted
  at **today's** rate (`todaysSymbolFactors`, `valueBookInBase`). Until this was
  fixed the engines added quantity × close in each holding's own currency, so a
  book holding a dollar listing and a peso listing was weighted as though
  pesos were dollars, and every amount — the Monte Carlo cone, the scenario
  engine's capital, the allocation total, dividend income — was in no single
  currency while the screen labelled it with the portfolio's.
- **Risk figures** (volatility, beta, drawdown, the covariance behind the
  optimiser and the Monte Carlo) use each holding's return **in the currency it
  trades in**. Scaling a series by today's rate leaves its returns unchanged, so
  exchange-rate moves are not inside these figures — the convention the
  portfolio backtest and the stress test already used.
- **Returns over time** (the returns tab's TWR and MWR, the value chart) convert
  each date at **its own** rate, so they do include exchange-rate moves: they
  answer "what did my money do in my currency".
- **Dividends** are converted at the rate of the day each was paid.

A holding whose quote currency or rate is unknown keeps its own unit and is
named in `unconverted` rather than dropped.

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

> **Delivered as documented since model 2.1.0.** Before that the advisor's
> monthly step divided the realised annual standard deviation by sqrt(12), so
> these figures were assumed but not produced: 5% behaved as 1.4%, 10% as 2.7%,
> 16% as 4.4%. See `docs/ADVISOR_MODEL_VERSIONING.md`.


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

**-99% annual, assumed guard.** `MIN_ANNUAL_RETURN` in `advisor.ts` for the
deterministic projection, `planDrift` in `scenario-engine.ts` for the
simulation.

A long, unlevered position cannot lose more than everything: `(1 + r)^(1/12)`
and `ln(1 + r)` with `r` below -100% are `NaN` rather than a loss. Since model
3.0.0 the simulated month is lognormal and cannot fall below -100% on its own;
the floor now only guards the stated annual return.

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

## Portfolio Health (P2-7)

**An educational score, not a standard.** `portfolio-health.ts` grades nine
aspects of how a portfolio is built, each from 0 to 100, and averages the ones
that have data (at least four are required for an overall score). Bands:
75 and above "Sólida", 50–74 "Mejorable", below 50 "Frágil". Every component is
linear between a full mark and a zero mark; what those marks rest on differs,
and the interface shows it next to each score.

| Component | Measured | 100 at | 0 at | Basis |
|---|---|---|---|---|
| Diversificación | effective independent bets (entropy of the covariance eigenvalues) | ≥ 5 | 1 | convention |
| Concentración | average of: largest single issuer; sum of single issuers above 5% | ≤ 10%; ≤ 40% | 40%; 100% | full marks from the UCITS 5/10/40 limits (Directive 2009/65/EC, art. 52), which are written for funds; the zero marks and the averaging are convention. ETFs and indices count as baskets, not issuers |
| Riesgo | annualised volatility ÷ benchmark volatility, same intervals | ≤ 1 | 2 | convention |
| Caídas | max drawdown ÷ benchmark max drawdown (weights held constant) | ≤ 1 | 2 | convention; when the benchmark fell less than 2%, absolute drawdown instead: ≤ 10% / 40% |
| Liquidez | share of measured value sellable within 3 business days trading at most 20% of average daily volume (20 sessions) | 100% | 0% | "highly liquid investment" of SEC Rule 22e-4 (3 business days); the 20% participation rate is convention. Indices are not tradable and are left out |
| Exposición sectorial | largest company sector, as a share of the whole book | ≤ 35% | 70% | 35% is the sector concentration threshold `exposure.ts` already uses; 70% is convention. Requires known sectors for ≥ 50% of the book |
| Exposición geográfica | largest region | ≤ 65% | 100% | reference: the United States is roughly 60–65% of MSCI ACWI, so a book no more concentrated than the global market scores full; exact marks are convention. Not scored when regions can only be guessed from currency |
| Exposición factorial | count of significant loadings of 0.5 or more on non-market factors | 0 | 3 | convention (34 points each) |
| Consistencia con el benchmark | annualised tracking error | ≤ 4% | ≥ 12% | reference: index-tracking funds run tracking errors of a few points and active management commonly 4–8%; exact marks are convention |

All measures are in-sample on the risk window (`loadRiskInputs`), with today's
weights. A component without the data it needs is **unavailable** and left
out of the average — never scored as zero or as perfect.

## Scenario engine (P2-9)

**One scenario definition and one simulator** (`scenario-engine.ts`) for every
projection: capital, weights, monthly contributions (optionally rising each
year), horizon, benchmark, risk model, costs, inflation, rebalancing policy and
shocks.

- **Process.** Each holding follows a geometric Brownian motion with correlated
  shocks, stepped monthly — the generator the portfolio Monte Carlo already uses
  (`forEachCorrelatedStep`), so a scenario and the cone agree on the same inputs.
- **Streams (2.0.0).** Each path draws from its own stream (`pathSeed`), so a
  longer horizon extends every path without redrawing a month. The advisor's
  plans run on the same draws and step (`planShocks`, `planMonthFactor`); a plan
  states an effective annual return, which becomes the drift `ln(1 + r)`.
- **Risk model.** From history by default: annualised mean, volatility and
  correlation of the holdings' daily returns. A user may set one expected annual
  return for every holding instead; volatility and correlation stay historical,
  and the result's `riskSource` says which was used.
- **Reliability.** The standard error of the annualised historical mean,
  σ / √years, is reported with every portfolio projection. Under 3 years of
  history, or with a standard error larger than half the mean, the projection is
  flagged as resting on an unreliable centre (convention).
- **Costs.** The cost model (`costs.ts`); nothing is charged unless given, and
  the result says the figures are gross. Commissions apply to money invested and
  to rebalancing turnover, custody as a monthly drag; capital-gains tax is
  reported as the tax on a liquidation at the horizon, not charged along the way.
- **Reproducibility.** The filled-in scenario is serialised canonically and
  hashed (FNV-1a) into a key; the key seeds the random stream when no seed is
  given. Key, seed, path count and engine version travel with every result.

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
