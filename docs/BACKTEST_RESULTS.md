# Backtest results

The roadmap asks for the technical signal to be run over at least ten
representative assets and the results documented honestly. This is that
document, and the honest result is unflattering.

## What was tested

`src/lib/services/signal.ts` — the RSI, moving-average and Bollinger signal the
app already shows on every asset page — walked forward through five years of
daily closes, decided one bar at a time, with each decision executed at the
*following* close.

| Setting | Value |
|---|---|
| Period | 5 years to 2026-09 (1,254 bars per asset) |
| Prices | Split- and dividend-adjusted (Yahoo `adjclose`) |
| Warmup | 200 bars, so the 200-day average exists before the first decision |
| Costs | 0.1% per side |
| Risk-free rate | 3.79% (US Treasury Bills) |
| Position | Long or flat. No shorting, no leverage, no partial sizing |

## Results

| Symbol | Strategy | Buy & hold | Difference | Trades | Hit rate | Time in market | Strategy maxDD | B&H maxDD |
|---|---|---|---|---|---|---|---|---|
| AAPL | 55.7% | 131.2% | **-75.5 pp** | 11 | 55% | 63% | 25.8% | 33.4% |
| MSFT | 2.7% | 95.6% | **-92.9 pp** | 12 | 42% | 57% | 28.5% | 34.5% |
| NVDA | 342.6% | 1343.1% | **-1000.6 pp** | 11 | 45% | 65% | 34.3% | 41.6% |
| JPM | 68.8% | 242.0% | **-173.2 pp** | 8 | 75% | 75% | 19.6% | 24.4% |
| XOM | 11.7% | 114.5% | **-102.9 pp** | 14 | 36% | 59% | 30.1% | 20.1% |
| JNJ | 72.3% | 70.2% | **+2.1 pp** | 9 | 56% | 57% | 14.9% | 17.4% |
| KO | 21.7% | 57.0% | **-35.3 pp** | 11 | 55% | 60% | 14.4% | 17.3% |
| SPY | 37.4% | 111.5% | **-74.1 pp** | 10 | 60% | 72% | 16.8% | 18.8% |
| QQQ | 40.1% | 158.6% | **-118.5 pp** | 10 | 50% | 69% | 22.1% | 22.8% |
| TSLA | 26.0% | 61.0% | **-35.0 pp** | 11 | 55% | 50% | 47.6% | 65.1% |

**Beat buy-and-hold: 1 of 10.** Median difference: **-75.5 percentage points**.

The single win — JNJ by 2.1 points over five years — is well inside the noise of
a 9-trade sample. It is not evidence of anything.

## Why it loses

It is out of the market roughly a third of the time. In a period when almost
every one of these assets rose substantially, sitting in cash for a third of it
is by itself enough to explain the gap, and no hit rate can make it back: even
JPM's 75% hit rate finished 173 points behind.

The hit rates are the more interesting number. They cluster around 50%, which is
what a signal with no predictive power looks like. A coin flip that is right half
the time and pays commission each way loses money slowly; this one loses to the
market quickly, because the market went up and it kept stepping off.

## The one thing it does do

Drawdown is lower on 9 of 10 assets. TSLA is the clearest case: 47.6% against
65.1%, so the signal did keep a holder out of the worst of it.

That is a real effect and it is worth naming, but it should not be oversold. The
trade is roughly 17 points of drawdown for 35 points of return on TSLA, and 8
points of drawdown for 1,000 points of return on NVDA. Nobody would knowingly
take the second trade.

## What this does NOT establish

- **That technical analysis does not work.** One indicator set, one parameter
  choice, ten US large caps, one five-year window that happened to be a strong
  bull market. A trend-following signal is expected to underperform in exactly
  that regime; the fair test is a period containing a sustained bear market.
- **That the signal is useless as information.** It is displayed as a summary of
  where an asset sits against its own moving averages, which it does accurately.
  What this measures is whether trading on it beats holding, and it does not.
- **That the numbers would repeat.** Five years is one sample. The walk-forward
  harness (`walkForward` in `backtest.ts`) exists precisely so that a strategy
  with tunable parameters cannot be fitted to a window and then reported as if
  it had been predicted.

## What the app should say

The signal must not be presented as a trading recommendation, because on this
evidence trading it would have cost a user most of their return. Presenting it
as a description of an asset's technical position, alongside the fact that
following it underperformed holding on 9 of these 10 assets, is the honest
framing.

## Reproducing this

```
GET /api/market/AAPL/backtest?range=5y&cost=0.1
```

Returns the same figures for any symbol, plus the trade list and both equity
curves. The portfolio equivalent is:

```
GET /api/analytics/<portfolio-id>/backtest?cost=0.1
```

which runs the current book back through history under every rebalancing
schedule. It deliberately does not name a winner: which schedule comes out ahead
depends on whether the tested period was mean-reverting or trending, and
reporting an accident of the sample as a recommendation is the same mistake this
document exists to avoid.
