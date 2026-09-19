# Documentation index

One line each, so a reader can find the right page without opening six.

## The financial model

| File | What it settles |
|---|---|
| [FINANCIAL_ASSUMPTIONS.md](FINANCIAL_ASSUMPTIONS.md) | Every assumption a number rests on: risk-free rates, trading days, the currency of weights, amounts and returns, covariance windows. |
| [ADVISOR_FINANCIAL_MODEL.md](ADVISOR_FINANCIAL_MODEL.md) | The advisor's model, worked through one example end to end. |
| [ADVISOR_MODEL_VERSIONING.md](ADVISOR_MODEL_VERSIONING.md) | What a saved projection carries, when to bump the model version, and the history of the changes that moved the numbers. |
| [RESULT_METADATA.md](RESULT_METADATA.md) | The `_meta` every result carries, the model versions, and which route answers what. |
| [BACKTEST_RESULTS.md](BACKTEST_RESULTS.md) | What the strategy backtests actually produced, including the strategies that lost. |
| [DATA_QUALITY.md](DATA_QUALITY.md) | Where prices come from, how splits and bad prints are handled, and how a stored quote is refreshed. |

## Testing and verification

| File | What it settles |
|---|---|
| [E2E_TESTING.md](E2E_TESTING.md) | The Playwright suite: what runs, what skips and why, the dedicated test user and how to rotate it. |
| [API_CONTRACTS.md](API_CONTRACTS.md) | How every analytics route is held to the shape its screen reads, and how to add one. |
| [PWA_TESTING.md](PWA_TESTING.md) | What ships as a PWA, the automated check, and the real-device checklist. |
| [LOAD_TEST_RESULTS.md](LOAD_TEST_RESULTS.md) | What the app does under load, and what the rate limits were set from. |
| [ACCESSIBILITY_AUDIT.md](ACCESSIBILITY_AUDIT.md) · [PERFORMANCE_AUDIT.md](PERFORMANCE_AUDIT.md) · [SECURITY_AUDIT.md](SECURITY_AUDIT.md) · [FINANCIAL_UX_AUDIT.md](FINANCIAL_UX_AUDIT.md) | Audits, with what was fixed and what stands. |
| [FINAL_DIAGNOSTIC.md](FINAL_DIAGNOSTIC.md) | The independent audit of 2026-09-16, as written, with its corrections appended. |

## Plans

| File | What it settles |
|---|---|
| [PLAN_COMPARATIVA_SOCIAL.md](PLAN_COMPARATIVA_SOCIAL.md) | The social comparison feature, as planned. |
| [superpowers/](superpowers/) | Earlier specs and plans, kept for the record. |

## Two names the roadmap used

The roadmap asked for a `TESTING.md` and a `BACKTESTING_RESULTS.md`. What
exists is [E2E_TESTING.md](E2E_TESTING.md) and
[BACKTEST_RESULTS.md](BACKTEST_RESULTS.md): the same two documents under
narrower names — the first covers the end-to-end suite (unit tests are
described where they live, in `tests/`), the second the backtest results. They
were not renamed, because the current names say more precisely what is inside;
this note is here so a reader following the roadmap finds them.
