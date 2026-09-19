// The contract between each /api/analytics/[pid]/* route and the screens that
// read it (task 5.3).
//
// Two bugs of one kind reached production in the same week: the income tab and
// the sector breakdown each read a field the route did not send, because the
// shape was written twice — once where the route built it, once where the hook
// declared it — and nothing compared the two. Here it is written once. Every
// hook type in use-analytics.ts is inferred from these schemas, so a screen that
// reads a field the contract lacks does not compile; and the contract tests
// (tests/contracts) call every route handler and parse what it returns against
// the same schema, so a route that stops sending a field fails a test.
//
// Payloads a route builds field by field are described field by field. Parts
// that are a service's result passed through whole (a RiskSources, a
// PortfolioHealth) are described by that service's type, and checked at run
// time for every key the type requires: `shape` lists them, and the compiler
// refuses a list that misses one, so a new required field cannot be forgotten.
//
// Client-safe: zod and type-only imports.

import { z } from 'zod'
import type { ResultMetadata } from '@/lib/services/result-metadata'
import type { HoldingSlice } from '@/lib/services/allocation-breakdown'
import type { RiskSources } from '@/lib/services/risk-sources'
import type { PortfolioHealth } from '@/lib/services/portfolio-health'
import type { PortfolioDiagnostic } from '@/lib/services/portfolio-diagnostic'
import type { EstimateReliability, PortfolioScenarioRequest, ScenarioResult } from '@/lib/services/scenario-engine'
import type { TemporalAttribution } from '@/lib/services/temporal-attribution'
import type { ModelComparison } from '@/lib/services/model-comparison'
import type { ScenarioComparison } from '@/lib/services/scenario-comparison'
import type { PortfolioBacktestResult } from '@/lib/services/backtest'
import type { CurrencyExposure, GeographicExposure, SectorExposure } from '@/lib/services/exposure'
import type { StressResult } from '@/lib/services/stress-testing'

// ─── Service-typed parts ─────────────────────────────────────────────────────

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A service's result, typed as that service's type and checked for every key
 * the type requires. `keys` must name each required key — the compiler rejects
 * a list that misses one or names one the type does not have.
 */
export function shape<T>(name: string, keys: { [K in RequiredKeys<T>]: true }) {
  const required = Object.keys(keys)
  return z.custom<T>((value) => isRecord(value) && required.every((key) => key in value), {
    message: `${name}: faltan campos de ${required.join(', ')}`,
  })
}

/**
 * The same, for a route that answers either the service's whole result or a
 * `message` saying why there is none: the screen reads it as a Partial and
 * shows the message when there is one. Without a message, every required key
 * must be there.
 */
export function resultOrMessage<T>(name: string, keys: { [K in RequiredKeys<T>]: true }) {
  const required = Object.keys(keys)
  return z.custom<Partial<T>>(
    (value) => isRecord(value) && (typeof value.message === 'string' || required.every((key) => key in value)),
    { message: `${name}: sin mensaje, faltan campos de ${required.join(', ')}` },
  )
}

/** Where a result comes from (P2-10). */
export const ResultMetadataSchema = shape<ResultMetadata>('ResultMetadata', {
  model: true,
  computedAt: true,
  data: true,
  period: true,
  assumptions: true,
  benchmark: true,
  riskFreeRate: true,
  cache: true,
})

const meta = ResultMetadataSchema.optional()

/** `{ message }`: a route saying why there is no result. */
export const MessageSchema = z.object({ message: z.string() })

const benchmarkRef = z.object({ symbol: z.string(), name: z.string() })
const weightRow = z.object({ symbol: z.string(), weight: z.number() })
const riskFreeRate = z.object({ currency: z.string(), annual_pct: z.number(), source: z.string(), is_fallback: z.boolean() })

// ─── returns ─────────────────────────────────────────────────────────────────

export const ReturnsSummarySchema = z.object({
  simple: z.number(),
  twr: z.number().nullable(),
  mwr: z.number().nullable(),
  period: z.string(),
  /** Size-weighted average age of the invested capital, in days. */
  capital_age_days: z.number().nullable().optional(),
  /** The currency every figure is in: the portfolio's base currency. */
  currency: z.string().optional(),
  /** Holdings whose exchange rate was unknown and were left unconverted. */
  unconverted: z.array(z.string()).optional(),
})

export const CalendarYearSchema = z.object({
  year: z.number(),
  months: z.array(z.number().nullable()),
  total: z.number(),
})

export const ReturnsDataSchema = z.object({
  _meta: meta,
  summary: ReturnsSummarySchema,
  calendar: z.array(CalendarYearSchema),
})

// ─── risk ────────────────────────────────────────────────────────────────────

const series = z.object({ dates: z.array(z.string()), values: z.array(z.number()) })

export const RiskDataSchema = z.object({
  _meta: meta,
  current: z.object({
    risk_score: z.number(),
    sharpe_ratio: z.number(),
    /** Null when the book never had a down day: no downside deviation to divide by. */
    sortino_ratio: z.number().nullable(),
    max_drawdown: z.number(),
    max_drawdown_date: z.string(),
    volatility: z.number(),
    beta: z.number(),
    alpha: z.number(),
    calmar_ratio: z.number(),
    var_95: z.number(),
    tracking_error: z.number(),
    information_ratio: z.number(),
  }),
  drawdown_series: series,
  /** How many genuinely separate bets the book runs, beside the HHI it is confused with. */
  independence: z
    .object({
      holdings: z.number(),
      effective_bets: z.number(),
      components_for_90pct: z.number(),
      hhi: z.number(),
      hhi_effective_holdings: z.number().nullable(),
      summary: z.string(),
      components: z.array(
        z.object({
          index: z.number(),
          variance_explained_pct: z.number(),
          cumulative_pct: z.number(),
          loadings: z.array(z.object({ symbol: z.string(), loading: z.number() })),
        }),
      ),
    })
    .nullable(),
  bar_cadence: z.object({ daysPerBar: z.number(), periodsPerYear: z.number(), label: z.string() }).optional(),
  risk_free_rate: riskFreeRate.extend({ as_of: z.string().nullable() }).optional(),
  tail_risk: z
    .object({
      confidence: z.number(),
      observations: z.number(),
      historicalPct: z.number().nullable(),
      parametricPct: z.number().nullable(),
      cornishFisherPct: z.number().nullable(),
      conditionalPct: z.number().nullable(),
      skewness: z.number().nullable(),
      excessKurtosis: z.number().nullable(),
      interpretation: z.string(),
    })
    .nullable()
    .optional(),
  benchmark: z
    .object({
      symbol: z.string(),
      name: z.string(),
      currency: z.string(),
      available: z.boolean(),
      active_return_pct: z.number(),
      /** Null when beta, alpha, tracking error and IR could not be measured. */
      explanations: z.unknown().nullable(),
    })
    .optional(),
  dataPoints: z.number().optional(),
  rolling_risk: z
    .object({
      window_bars: z.number(),
      window_label: z.string(),
      observations_used: z.number(),
      benchmark_symbol: z.string().nullable(),
      points: z.array(
        z.object({
          date: z.string(),
          volatility_pct: z.number().nullable(),
          sharpe: z.number().nullable(),
          correlation: z.number().nullable(),
        }),
      ),
      stress_periods: z.array(
        z.object({
          fromDate: z.string(),
          toDate: z.string(),
          peakVolatilityPct: z.number(),
          medianVolatilityPct: z.number(),
          multipleOfNormal: z.number(),
          label: z.string(),
        }),
      ),
    })
    .nullable(),
  message: z.string().optional(),
})

// ─── monte-carlo ─────────────────────────────────────────────────────────────

export const MonteCarloBandSchema = z.object({ week: z.number(), p10: z.number(), p50: z.number(), p90: z.number() })

export const MonteCarloDataSchema = z.object({
  _meta: meta,
  /** The currency every amount is in: the portfolio's. Absent from results computed before it was stated. */
  currency: z.string().optional(),
  unconverted: z.array(z.string()).optional(),
  current_value: z.number(),
  weeks: z.number(),
  simulations: z.number(),
  bands: z.array(MonteCarloBandSchema),
  expected_value: z.number(),
  var_95: z.object({ pct: z.number(), amount: z.number() }),
  assets: z.array(weightRow),
  dataPoints: z.number(),
  message: z.string().optional(),
})

// ─── attribution ─────────────────────────────────────────────────────────────

export const AttributionSectorSchema = z.object({
  sector: z.string(),
  portfolio_weight: z.number(),
  benchmark_weight: z.number(),
  portfolio_return: z.number(),
  benchmark_return: z.number(),
  allocation_effect: z.number(),
  selection_effect: z.number(),
  interaction_effect: z.number(),
  total_effect: z.number(),
})

export const AttributionDataSchema = z.object({
  _meta: meta,
  sectors: z.array(AttributionSectorSchema),
  total: z.object({
    allocation_effect: z.number(),
    selection_effect: z.number(),
    interaction_effect: z.number(),
    total_excess: z.number(),
  }),
})

// ─── attribution/temporal (P2-4) ─────────────────────────────────────────────

export const TemporalAttributionDataSchema = z.intersection(
  shape<TemporalAttribution>('TemporalAttribution', {
    granularity: true,
    buckets: true,
    total: true,
    unmeasurable: true,
    unlinkable: true,
  }),
  z.object({
    _meta: meta,
    period: z.string(),
    from: z.string(),
    /** The currency the rebuilt book is in: the portfolio's. */
    currency: z.string().optional(),
    unconverted: z.array(z.string()).optional(),
  }),
)

// ─── risk-sources (P2-5) ─────────────────────────────────────────────────────

const window = z.object({ from: z.string(), to: z.string() })

export const RiskSourcesDataSchema = z.intersection(
  resultOrMessage<RiskSources>('RiskSources', {
    observations: true,
    portfolioVolatilityPct: true,
    byAsset: true,
    bySector: true,
    byComponent: true,
    byFactor: true,
    market: true,
    correlation: true,
    findings: true,
  }),
  z.object({
    _meta: meta,
    message: z.string().optional(),
    window: window
      .extend({ intervals_used: z.number(), intervals_available: z.number(), cadence: z.string() })
      .optional(),
    excluded_symbols: z.array(z.string()).optional(),
    omitted: z.object({ benchmark: z.string().optional(), factors: z.string().optional() }).optional(),
    benchmark: benchmarkRef.optional(),
  }),
)

// ─── health (P2-7) ───────────────────────────────────────────────────────────

export const HealthDataSchema = z.intersection(
  resultOrMessage<PortfolioHealth>('PortfolioHealth', {
    score: true,
    band: true,
    bandLabel: true,
    components: true,
    componentsScored: true,
    summary: true,
    caveat: true,
  }),
  z.object({
    _meta: meta,
    message: z.string().optional(),
    window: window.extend({ intervals_used: z.number(), cadence: z.string() }).optional(),
    excluded_symbols: z.array(z.string()).optional(),
    benchmark: benchmarkRef.optional(),
  }),
)

// ─── diagnostic (P2-8) ───────────────────────────────────────────────────────

export const DiagnosticDataSchema = z.intersection(
  resultOrMessage<PortfolioDiagnostic>('PortfolioDiagnostic', { answers: true, answered: true, caveat: true }),
  z.object({
    _meta: meta,
    risk_window: window.nullable().optional(),
    return_window: window.nullable().optional(),
    benchmark: benchmarkRef.optional(),
  }),
)

// ─── scenario-engine (P2-9) ──────────────────────────────────────────────────

export const ScenarioEngineDataSchema = z.object({
  _meta: meta,
  message: z.string().optional(),
  request: shape<PortfolioScenarioRequest>('PortfolioScenarioRequest', {
    allocation: true,
    horizonMonths: true,
    monthlyContribution: true,
    rebalance: true,
    inflation: true,
    custodyAnnualPct: true,
    commissionPct: true,
    shock: true,
    capital: true,
    expectedReturn: true,
  }).optional(),
  allocation: z.object({ preset: z.string(), name: z.string(), weights: z.array(weightRow) }).optional(),
  capital: z.number().optional(),
  /** The currency the capital and the bands are in: the portfolio's. */
  currency: z.string().optional(),
  benchmark: benchmarkRef.nullable().optional(),
  result: shape<ScenarioResult>('ScenarioResult', {
    nominal: true,
    real: true,
    final: true,
    drawdown: true,
    benchmark: true,
    model: true,
  }).optional(),
  estimates: shape<EstimateReliability>('EstimateReliability', {
    historyYears: true,
    historicalReturnPct: true,
    standardErrorPct: true,
    unreliable: true,
    note: true,
  })
    .nullable()
    .optional(),
  window: window.optional(),
})

// ─── income ──────────────────────────────────────────────────────────────────

export const IncomeDataSchema = z.object({
  _meta: meta,
  /** The currency every amount is in: the portfolio's. Absent from results computed before it was stated. */
  currency: z.string().optional(),
  unconverted: z.array(z.string()).optional(),
  totals: z.object({ mtd: z.number(), ytd: z.number(), all_time: z.number(), portfolio_yield: z.number() }),
  by_position: z.array(z.object({ symbol: z.string(), total: z.number(), count: z.number() })),
  monthly_history: z.array(z.object({ month: z.string(), amount: z.number() })),
})

// ─── allocation ──────────────────────────────────────────────────────────────

/**
 * One slice of the book, however it was grouped. The label is `name` for both
 * breakdowns, because the route builds `byType` and `bySector` the same way.
 * The page once read `s.sector` from a hand-written type that said so, and every
 * sector rendered with no label (task 1.1).
 */
export const AllocationSliceSchema = z.object({ name: z.string(), value: z.number(), pct: z.number() })

export const HoldingSliceSchema = shape<HoldingSlice>('HoldingSlice', {
  symbol: true,
  value: true,
  pct: true,
  freshness: true,
})

export const AllocationDataSchema = z.object({
  _meta: meta,
  byType: z.array(AllocationSliceSchema),
  bySector: z.array(AllocationSliceSchema),
  bySymbol: z.array(HoldingSliceSchema),
  total: z.number(),
  /** The currency every value is in: the portfolio's. Null for an empty book. */
  currency: z.string().nullable().optional(),
  unconverted: z.array(z.string()).optional(),
})

// ─── factors (P1-26 / P1-27) ─────────────────────────────────────────────────

export const FactorLoadingSchema = z.object({
  factor: z.string(),
  coefficient: z.number(),
  standardError: z.number(),
  tStat: z.number().nullable(),
  significant: z.boolean(),
})

export const FactorsDataSchema = z.object({
  _meta: meta,
  message: z.string().optional(),
  source: z.enum(['stored', 'built']).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  risk_free_rate: riskFreeRate.optional(),
  regression: z
    .object({
      alphaAnnualPct: z.number(),
      alphaTStat: z.number().nullable(),
      loadings: z.array(FactorLoadingSchema),
      rSquared: z.number(),
      adjustedRSquared: z.number(),
      residualVolatilityPct: z.number(),
      observations: z.number(),
    })
    .optional(),
  summary: z.string().optional(),
  definitions: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        symbols: z.array(z.string()),
        construction: z.string(),
        meaning: z.string(),
        isProxy: z.boolean(),
      }),
    )
    .optional(),
  omitted: z.array(z.object({ id: z.string(), missing: z.array(z.string()) })).optional(),
})

// ─── optimization (P1-31 / P1-32 / P2-3) ─────────────────────────────────────

export const FrontierPointSchema = z.object({
  expectedReturnPct: z.number(),
  volatilityPct: z.number(),
  sharpe: z.number().nullable(),
  weights: z.array(weightRow),
})

export const OptimizationDataSchema = z.object({
  _meta: meta,
  message: z.string().optional(),
  symbols: z.array(z.string()).optional(),
  observations: z.number().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  risk_free_rate: riskFreeRate.optional(),
  estimated_returns: z.array(z.object({ symbol: z.string(), annual_pct: z.number(), basis: z.string() })).nullable().optional(),
  efficient_frontier: z
    .object({
      points: z.array(FrontierPointSchema),
      minimumVariance: FrontierPointSchema,
      maxSharpe: FrontierPointSchema,
      current: FrontierPointSchema.nullable(),
      improvement: z
        .object({
          sameReturnVolatilityPct: z.number(),
          volatilitySavedPct: z.number(),
          sameRiskReturnPct: z.number(),
          returnGainedPct: z.number(),
          summary: z.string(),
        })
        .nullable(),
      riskFreeRatePct: z.number(),
      caveat: z.string(),
    })
    .nullable()
    .optional(),
  allocation_strategies: z
    .object({
      confidence: z.number(),
      observations: z.number(),
      strategies: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          rationale: z.string(),
          weights: z.array(weightRow),
          volatilityPct: z.number(),
          cvarPct: z.number(),
        }),
      ),
      caveat: z.string(),
    })
    .nullable()
    .optional(),
  model_comparison: shape<ModelComparison>('ModelComparison', {
    models: true,
    unavailable: true,
    current: true,
    weightSpread: true,
    blackLitterman: true,
    summary: true,
    caveat: true,
  })
    .nullable()
    .optional(),
  caveat: z.string().optional(),
})

// ─── scenarios (E2) ──────────────────────────────────────────────────────────

export const ScenarioComparisonDataSchema = z.object({
  _meta: meta,
  message: z.string().nullable().optional(),
  symbols: z.array(z.string()).optional(),
  observations: z.number().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  risk_free_rate: riskFreeRate.extend({ as_of: z.string().nullable() }).optional(),
  available: z.array(z.object({ id: z.string(), name: z.string(), rationale: z.string() })).optional(),
  request: z
    .object({ horizon_years: z.number(), include: z.array(z.string()), errors: z.array(z.string()) })
    .optional(),
  comparison: shape<ScenarioComparison>('ScenarioComparison', {
    horizonYears: true,
    simulations: true,
    seed: true,
    riskFreeRatePct: true,
    baselineId: true,
    scenarios: true,
    explanations: true,
    rejected: true,
    caveat: true,
  })
    .nullable()
    .optional(),
})

// ─── rebalance (P0-12 / P1-10) ───────────────────────────────────────────────

const targetWeights = z.record(z.string(), z.number()).nullable()

export const RebalanceInputsSchema = z.object({
  currency: z.string(),
  book_value: z.number(),
  holdings: z.array(z.object({ symbol: z.string(), value: z.number(), weight: z.number(), sector: z.string().nullable() })),
  cov: z.array(z.array(z.number())),
  expected_returns: z.array(z.number()),
  risk_free_rate: z.number(),
  asset_betas: z.array(z.number()).nullable(),
  benchmark: benchmarkRef,
  window,
  targets: z.object({ equal: targetWeights, drift: targetWeights, riskParity: targetWeights }),
  unconverted: z.array(z.string()),
  _meta: meta,
})

export const RebalanceResponseSchema = z.union([RebalanceInputsSchema, MessageSchema])

// ─── backtest (P1-17) ────────────────────────────────────────────────────────

export const PortfolioBacktestResultSchema = shape<PortfolioBacktestResult>('PortfolioBacktestResult', {
  finalValue: true,
  totalReturnPct: true,
  cagrPct: true,
  volatilityPct: true,
  sharpe: true,
  sortino: true,
  maxDrawdownPct: true,
  var95Pct: true,
  rebalanceCount: true,
  totalCosts: true,
  finalWeights: true,
  equityCurve: true,
  rebalance: true,
})

export const PortfolioBacktestDataSchema = z.object({
  weights: z.record(z.string(), z.number()),
  covered: z.array(z.string()),
  excluded: z.array(z.string()),
  cost_pct: z.number(),
  risk_free_rate: z.object({ annual_pct: z.number(), source: z.string() }),
  observations: z.number(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  schedules: z.array(PortfolioBacktestResultSchema),
  note: z.string(),
  _meta: meta,
})

export const PortfolioBacktestResponseSchema = z.union([PortfolioBacktestDataSchema, MessageSchema])

// ─── exposure (P1-19 / P1-20) ────────────────────────────────────────────────

export const ExposureDataSchema = z.object({
  base_currency: z.string(),
  sector: shape<SectorExposure>('SectorExposure', { buckets: true, hiddenConcentration: true }),
  geographic: shape<GeographicExposure>('GeographicExposure', { buckets: true, confidence: true, caveat: true }),
  currency: shape<CurrencyExposure>('CurrencyExposure', { buckets: true, basePct: true, foreignPct: true, summary: true }),
  unconverted: z.array(z.string()).optional(),
  _meta: meta,
})

export const ExposureResponseSchema = z.union([ExposureDataSchema, MessageSchema])

// ─── stress (P1-30) ──────────────────────────────────────────────────────────

export const StressResultSchema = z.intersection(
  shape<StressResult>('StressResult', {
    episode: true,
    coverage: true,
    observedWeightPct: true,
    benchmarkReturnPct: true,
    portfolioReturnPct: true,
    maxDrawdownPct: true,
    holdings: true,
    worst: true,
  }),
  z.object({ summary: z.string() }),
)

export const StressDataSchema = z.object({
  benchmark_symbol: z.string(),
  episodes_catalogued: z.number(),
  episodes_measured: z.number(),
  unmeasured: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })),
  granularity_note: z.string(),
  results: z.array(StressResultSchema),
  _meta: meta,
})

export const StressResponseSchema = z.union([StressDataSchema, MessageSchema])

// ─── The contract of each route ──────────────────────────────────────────────

/**
 * Every analytics route, by path segment, with the schema its screen reads.
 * `benchmark` and `performance` have no screen: nothing in the app requests
 * them, so there is nothing to hold them to (docs/API_CONTRACTS.md).
 */
export const ANALYTICS_CONTRACTS = {
  returns: ReturnsDataSchema,
  risk: RiskDataSchema,
  'monte-carlo': MonteCarloDataSchema,
  attribution: AttributionDataSchema,
  'attribution/temporal': TemporalAttributionDataSchema,
  'risk-sources': RiskSourcesDataSchema,
  health: HealthDataSchema,
  diagnostic: DiagnosticDataSchema,
  'scenario-engine': ScenarioEngineDataSchema,
  income: IncomeDataSchema,
  allocation: AllocationDataSchema,
  factors: FactorsDataSchema,
  optimization: OptimizationDataSchema,
  scenarios: ScenarioComparisonDataSchema,
  rebalance: RebalanceResponseSchema,
  backtest: PortfolioBacktestResponseSchema,
  exposure: ExposureResponseSchema,
  stress: StressResponseSchema,
} as const

export type AnalyticsRoute = keyof typeof ANALYTICS_CONTRACTS
