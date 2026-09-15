# Result metadata (P2-10)

Every important financial result carries a `_meta` object that answers eight
questions about itself. The structure lives in `src/lib/services/result-metadata.ts`;
the interface shows it under each result as **"¿De dónde sale este resultado?"**
(`src/components/analytics/audit-trail.tsx`).

| # | Question | Field |
|---|---|---|
| 1 | What data did it use? | `data.description`, `data.symbols`, `data.excluded` |
| 2 | What period? | `period.from`, `period.to`, `period.observations`, `period.cadence` |
| 3 | What assumptions? | `assumptions[]` — each with a `source` (a citation, a register entry or "convención") |
| 4 | Which model version? | `model.id`, `model.version` (from `MODEL_VERSIONS`) |
| 5 | Which benchmark? | `benchmark` — `null` when the result is not compared with an index |
| 6 | Which risk-free rate? | `riskFreeRate` — currency, rate, publisher, as-of date, whether it is the documented fallback; `null` when not used |
| 7 | When was it computed? | `computedAt` (ISO, UTC) |
| 8 | Real or cached data? | `data.priceSource` for the market data (`stored`, `provider`, `mixed`, `none`) and `cache.served` for the result itself (`computed` or `cache`, with its TTL) |

A field that does not apply is `null`, never omitted: "no benchmark was used"
must not look like "the benchmark was not recorded".

## Where it is attached

- Every route under `/api/analytics/[pid]` and every background-job calculation
  (`src/lib/jobs/kinds/*`). `tests/lint/result-metadata.test.ts` fails when one
  does not build metadata.
- Results computed from `loadRiskInputs` (risk sources, health, diagnostic,
  scenario engine) use `riskInputsMetadata()`, so the window, the price tiers,
  the benchmark and the rate are recorded the same way for all of them.

## How "cached" is decided

- **Market data.** `fetchAdjustedPriceHistory` reports `stored` when the stored
  history answered alone, `mixed` when it was completed from a provider (missing
  sessions, a holding with no history) and `provider` when a provider answered
  everything. `loadPriceMapWithSource` does the same for the book reconstruction.
- **The result.** Routes cache through `withAuditedCache` (or `withCacheInfo`
  when only the inputs are cached). A result served from the cache keeps the
  `computedAt` of the moment it was calculated and says `cache.served: "cache"`.
  A plain `withCache` on an analytics route fails the lint test, because it
  would store "computed" and repeat it forever. A completed background job
  handed back without running again is marked `cache` by the jobs API.

## Versions

Bump a model's entry in `MODEL_VERSIONS` whenever a change moves its numbers.
Three are owned by their engines and imported: `advisor` (`ADVISOR_MODEL_VERSION`),
`scenarioEngine` (`SCENARIO_ENGINE_VERSION`) and `factors` (`CONSTRUCTION_VERSION`).
