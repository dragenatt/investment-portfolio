# Financial assumptions

Every number the Financial Engine uses that is *not* observed from the user's own
data is an assumption, and every assumption here carries a source, a unit and a
date. Anything that cannot name its source does not belong in a calculation.

This document is the central register the roadmap's P0-20 calls for. Today it
covers the risk-free rate (P0-5); expected returns, inflation, costs, taxes,
horizons and scenarios get their sections as those tasks land.

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

### Known limitation

`computeBenchmarkStats` measures beta and alpha against SPY, a dollar
instrument, while the risk-free rate now follows the portfolio's own currency.
For a peso portfolio those two are not in the same currency, so its alpha mixes
a peso risk-free rate with a dollar benchmark. The rate is at least consistent
with the portfolio's own return series, which is the side alpha is judging.
Resolving this properly needs a benchmark denominated in the portfolio's
currency — that is roadmap task **P0-14 (benchmark configurable)**.

### What this replaced

Two contradictory hardcoded rates: `0.0425` in `snapshots.ts` (labelled "US
T-Bills approximate") and `0.10` in the risk endpoint (labelled CETES but
applied to every portfolio regardless of currency). The same portfolio could
therefore report two different Sharpe ratios depending on which surface asked.
