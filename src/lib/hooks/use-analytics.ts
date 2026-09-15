import useSWR from 'swr'
import type { Ranking } from '@/lib/services/discover'
import type { RiskSources } from '@/lib/services/risk-sources'
import { apiFetcher } from '@/lib/api/fetcher'
import { useJob } from './use-job'
import type { ScenarioComparison } from '@/lib/services/scenario-comparison'

// --- Returns ---
export type ReturnsSummary = {
  simple: number
  twr: number | null
  mwr: number | null
  period: string
  /** Size-weighted average age of the invested capital, in days. */
  capital_age_days?: number | null
}

export type CalendarYear = {
  year: number
  months: (number | null)[]
  total: number
}

export type ReturnsData = {
  summary: ReturnsSummary
  calendar: CalendarYear[]
}

export function useReturns(pid: string | null) {
  return useSWR<ReturnsData>(
    pid ? `/api/analytics/${pid}/returns` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Risk ---
export type RiskData = {
  current: {
    risk_score: number
    sharpe_ratio: number
    /** Null when the book never had a down day: no downside deviation to divide by. */
    sortino_ratio: number | null
    max_drawdown: number
    max_drawdown_date: string
    volatility: number
    beta: number
    alpha: number
    calmar_ratio: number
    var_95: number
    tracking_error: number
    information_ratio: number
  }
  drawdown_series: { dates: string[]; values: number[] }
  rolling_volatility: { dates: string[]; values: number[] }
  /** How many genuinely separate bets the book runs, beside the HHI it is confused with. */
  independence: {
    holdings: number
    effective_bets: number
    components_for_90pct: number
    hhi: number
    hhi_effective_holdings: number | null
    summary: string
    components: Array<{
      index: number
      variance_explained_pct: number
      cumulative_pct: number
      loadings: Array<{ symbol: string; loading: number }>
    }>
  } | null
  bar_cadence?: { daysPerBar: number; periodsPerYear: number; label: string }
  risk_free_rate?: { currency: string; annual_pct: number; source: string; as_of: string | null; is_fallback: boolean }
  tail_risk?: {
    confidence: number
    observations: number
    historicalPct: number | null
    parametricPct: number | null
    cornishFisherPct: number | null
    conditionalPct: number | null
    skewness: number | null
    excessKurtosis: number | null
    interpretation: string
  } | null
  benchmark?: {
    symbol: string
    name: string
    currency: string
    available: boolean
    active_return_pct: number
    /** Null when beta, alpha, tracking error and IR could not be measured. */
    explanations: unknown | null
  }
  dataPoints?: number
  rolling_risk: {
    window_bars: number
    window_label: string
    observations_used: number
    benchmark_symbol: string | null
    points: Array<{
      date: string
      volatility_pct: number | null
      sharpe: number | null
      correlation: number | null
    }>
    stress_periods: Array<{
      fromDate: string
      toDate: string
      peakVolatilityPct: number
      medianVolatilityPct: number
      multipleOfNormal: number
      label: string
    }>
  } | null
  message?: string
}

export function useRisk(pid: string | null) {
  return useSWR<RiskData>(
    pid ? `/api/analytics/${pid}/risk` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Monte Carlo ---
export type MonteCarloBandData = {
  week: number
  p10: number
  p50: number
  p90: number
}

export type MonteCarloData = {
  current_value: number
  weeks: number
  simulations: number
  bands: MonteCarloBandData[]
  expected_value: number
  var_95: { pct: number; amount: number }
  assets: Array<{ symbol: string; weight: number }>
  dataPoints: number
  message?: string
}

// Monte Carlo, factors and optimisation run as background jobs (C1): the hook
// starts the job and polls it, and the component still gets { data, isLoading }.
export function useMonteCarlo(pid: string | null, weeks = 52) {
  return useJob<MonteCarloData>('monteCarlo', pid, { weeks }, {
    refreshInterval: 600_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/monte-carlo?weeks=${weeks}` : undefined,
  })
}

// --- Attribution ---
export type AttributionSector = {
  sector: string
  portfolio_weight: number
  benchmark_weight: number
  portfolio_return: number
  benchmark_return: number
  allocation_effect: number
  selection_effect: number
  interaction_effect: number
  total_effect: number
}

export type AttributionData = {
  sectors: AttributionSector[]
  total: {
    allocation_effect: number
    selection_effect: number
    interaction_effect: number
    total_excess: number
  }
}

export function useAttribution(pid: string | null) {
  return useSWR<AttributionData>(
    pid ? `/api/analytics/${pid}/attribution` : null,
    apiFetcher,
    { refreshInterval: 3600_000 }
  )
}

// --- Contribution over time (P2-4) ---
export type TemporalAttributionData = import('@/lib/services/temporal-attribution').TemporalAttribution & {
  period: string
  from: string
}

export function useTemporalAttribution(pid: string | null, granularity: string, period: string) {
  return useSWR<TemporalAttributionData>(
    pid ? `/api/analytics/${pid}/attribution/temporal?granularity=${granularity}&period=${period}` : null,
    apiFetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )
}

// --- Risk sources (P2-5) ---
export type RiskSourcesData = Partial<RiskSources> & {
  message?: string
  window?: { from: string; to: string; intervals_used: number; intervals_available: number; cadence: string }
  excluded_symbols?: string[]
  omitted?: { benchmark?: string; factors?: string }
  benchmark?: { symbol: string; name: string }
}

export function useRiskSources(pid: string | null) {
  return useSWR<RiskSourcesData>(pid ? `/api/analytics/${pid}/risk-sources` : null, apiFetcher, {
    revalidateOnFocus: false,
  })
}

// --- Income ---
export type IncomeData = {
  totals: {
    mtd: number
    ytd: number
    all_time: number
    portfolio_yield: number
  }
  by_position: Array<{
    symbol: string
    total: number
    count: number
  }>
  monthly_history: Array<{
    month: string
    amount: number
  }>
}

export function useIncome(pid: string | null) {
  return useSWR<IncomeData>(
    pid ? `/api/analytics/${pid}/income` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Allocation ---
export type AllocationData = {
  byType: Array<{ name: string; value: number; pct: number }>
  bySector: Array<{ sector: string; value: number; pct: number }>
  bySymbol: Array<{ symbol: string; value: number; pct: number; stale: boolean }>
  total: number
}

export function useAllocation(pid: string | null) {
  return useSWR<AllocationData>(
    pid ? `/api/analytics/${pid}/allocation` : null,
    apiFetcher,
    { refreshInterval: 300_000 }
  )
}

// --- Alerts ---
export type PortfolioAlert = {
  id: string
  portfolio_id: string
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

export function usePortfolioAlerts(pid: string | null) {
  return useSWR<PortfolioAlert[]>(
    pid ? `/api/portfolio/${pid}/alerts` : null,
    apiFetcher,
    { refreshInterval: 300_000 }
  )
}

// --- Winners/Losers ---
export type WinnersLosersData = {
  winners: Array<{ symbol: string; name: string; daily_change_pct: number; current_price: number }>
  losers: Array<{ symbol: string; name: string; daily_change_pct: number; current_price: number }>
}

export function useWinnersLosers() {
  return useSWR<WinnersLosersData>(
    '/api/discover/winners',
    apiFetcher,
    { refreshInterval: 300_000 }
  )
}

// --- Leaderboard History ---
export type LeaderboardHistoryEntry = {
  snapshot_date: string
  rankings: Ranking[]
}

export function useLeaderboardHistory(category = 'returns', days = 30) {
  return useSWR<LeaderboardHistoryEntry[]>(
    `/api/discover/leaderboard/history?category=${category}&days=${days}`,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Factor exposure (P1-26 / P1-27) ---

export type FactorLoading = {
  factor: string
  coefficient: number
  standardError: number
  tStat: number | null
  significant: boolean
}

export type FactorsData = {
  message?: string
  source?: 'stored' | 'built'
  from_date?: string
  to_date?: string
  risk_free_rate?: { currency: string; annual_pct: number; source: string; is_fallback: boolean }
  regression?: {
    alphaAnnualPct: number
    alphaTStat: number | null
    loadings: FactorLoading[]
    rSquared: number
    adjustedRSquared: number
    residualVolatilityPct: number
    observations: number
  }
  summary?: string
  definitions?: Array<{
    id: string
    name: string
    symbols: string[]
    construction: string
    meaning: string
    isProxy: boolean
  }>
  omitted?: Array<{ id: string; missing: string[] }>
}

export function useFactors(pid: string | null) {
  return useJob<FactorsData>('factors', pid, {}, {
    refreshInterval: 1_800_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/factors` : undefined,
  })
}

// --- Efficient frontier and allocation strategies (P1-31 / P1-32) ---

export type FrontierPoint = {
  expectedReturnPct: number
  volatilityPct: number
  sharpe: number | null
  weights: Array<{ symbol: string; weight: number }>
}

export type OptimizationData = {
  message?: string
  symbols?: string[]
  observations?: number
  from_date?: string
  to_date?: string
  risk_free_rate?: { currency: string; annual_pct: number; source: string; is_fallback: boolean }
  estimated_returns?: Array<{ symbol: string; annual_pct: number; basis: string }> | null
  efficient_frontier?: {
    points: FrontierPoint[]
    minimumVariance: FrontierPoint
    maxSharpe: FrontierPoint
    current: FrontierPoint | null
    improvement: {
      sameReturnVolatilityPct: number
      volatilitySavedPct: number
      sameRiskReturnPct: number
      returnGainedPct: number
      summary: string
    } | null
    riskFreeRatePct: number
    caveat: string
  } | null
  allocation_strategies?: {
    confidence: number
    observations: number
    strategies: Array<{
      id: string
      name: string
      rationale: string
      weights: Array<{ symbol: string; weight: number }>
      volatilityPct: number
      cvarPct: number
    }>
    caveat: string
  } | null
  caveat?: string
}

export function useOptimization(pid: string | null) {
  return useJob<OptimizationData>('optimization', pid, {}, {
    refreshInterval: 1_800_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/optimization` : undefined,
  })
}

// --- Scenario comparison (E2) ---

export type { ScenarioComparison, ScenarioMetrics, ScenarioExplanation } from '@/lib/services/scenario-comparison'

export type ScenarioComparisonData = {
  message?: string | null
  symbols?: string[]
  observations?: number
  from_date?: string
  to_date?: string
  risk_free_rate?: { currency: string; annual_pct: number; source: string; as_of: string | null; is_fallback: boolean }
  available?: Array<{ id: string; name: string; rationale: string }>
  request?: { horizon_years: number; include: string[]; errors: string[] }
  comparison?: ScenarioComparison | null
}

export function useScenarioComparison(pid: string | null, query: string) {
  return useSWR<ScenarioComparisonData>(
    pid ? `/api/analytics/${pid}/scenarios?${query}` : null,
    apiFetcher,
    // Keep the table on screen while a new selection loads.
    { keepPreviousData: true, revalidateOnFocus: false }
  )
}
