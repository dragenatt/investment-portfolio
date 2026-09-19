import useSWR from 'swr'
import type { z } from 'zod'
import type { Ranking } from '@/lib/services/discover'
import { apiFetcher } from '@/lib/api/fetcher'
import { useJob } from './use-job'
import type * as Contract from '@/lib/contracts/analytics'

// Every payload type below is inferred from the route's contract
// (src/lib/contracts/analytics.ts), not declared here: the contract tests hold
// each route to the same schema, so what a screen reads and what the route
// sends are one definition (task 5.3).
type Of<S extends z.ZodType> = z.infer<S>

// --- Returns ---
export type ReturnsSummary = Of<typeof Contract.ReturnsSummarySchema>
export type CalendarYear = Of<typeof Contract.CalendarYearSchema>
export type ReturnsData = Of<typeof Contract.ReturnsDataSchema>

export function useReturns(pid: string | null) {
  return useSWR<ReturnsData>(
    pid ? `/api/analytics/${pid}/returns` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Risk ---
export type RiskData = Of<typeof Contract.RiskDataSchema>

export function useRisk(pid: string | null) {
  return useSWR<RiskData>(
    pid ? `/api/analytics/${pid}/risk` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Monte Carlo ---
export type MonteCarloBandData = Of<typeof Contract.MonteCarloBandSchema>
export type MonteCarloData = Of<typeof Contract.MonteCarloDataSchema>

// Monte Carlo, factors and optimisation run as background jobs (C1): the hook
// starts the job and polls it, and the component still gets { data, isLoading }.
export function useMonteCarlo(pid: string | null, weeks = 52) {
  return useJob<MonteCarloData>('monteCarlo', pid, { weeks }, {
    refreshInterval: 600_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/monte-carlo?weeks=${weeks}` : undefined,
  })
}

// --- Attribution ---
export type AttributionSector = Of<typeof Contract.AttributionSectorSchema>
export type AttributionData = Of<typeof Contract.AttributionDataSchema>

export function useAttribution(pid: string | null) {
  return useSWR<AttributionData>(
    pid ? `/api/analytics/${pid}/attribution` : null,
    apiFetcher,
    { refreshInterval: 3600_000 }
  )
}

// --- Contribution over time (P2-4) ---
export type TemporalAttributionData = Of<typeof Contract.TemporalAttributionDataSchema>

export function useTemporalAttribution(pid: string | null, granularity: string, period: string) {
  return useSWR<TemporalAttributionData>(
    pid ? `/api/analytics/${pid}/attribution/temporal?granularity=${granularity}&period=${period}` : null,
    apiFetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )
}

// --- Risk sources (P2-5) ---
export type RiskSourcesData = Of<typeof Contract.RiskSourcesDataSchema>

export function useRiskSources(pid: string | null) {
  return useSWR<RiskSourcesData>(pid ? `/api/analytics/${pid}/risk-sources` : null, apiFetcher, {
    revalidateOnFocus: false,
  })
}

// --- Portfolio Health (P2-7) ---
export type HealthData = Of<typeof Contract.HealthDataSchema>

export function useHealth(pid: string | null) {
  return useSWR<HealthData>(pid ? `/api/analytics/${pid}/health` : null, apiFetcher, { revalidateOnFocus: false })
}

// --- Portfolio diagnostic (P2-8) ---
export type DiagnosticData = Of<typeof Contract.DiagnosticDataSchema>

export function useDiagnostic(pid: string | null) {
  return useSWR<DiagnosticData>(pid ? `/api/analytics/${pid}/diagnostic` : null, apiFetcher, { revalidateOnFocus: false })
}

// --- Scenario engine (P2-9) ---
export type ScenarioEngineData = Of<typeof Contract.ScenarioEngineDataSchema>

export function useScenarioEngine(pid: string | null, query: string) {
  return useSWR<ScenarioEngineData>(pid ? `/api/analytics/${pid}/scenario-engine?${query}` : null, apiFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  })
}

// --- Income ---
export type IncomeData = Of<typeof Contract.IncomeDataSchema>

export function useIncome(pid: string | null) {
  return useSWR<IncomeData>(
    pid ? `/api/analytics/${pid}/income` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}

// --- Allocation ---

/**
 * One slice of the book, however it was grouped. The label is `name` for both
 * breakdowns; see AllocationSliceSchema for the bug that naming it once fixed.
 */
export type AllocationSlice = Of<typeof Contract.AllocationSliceSchema>
export type AllocationData = Of<typeof Contract.AllocationDataSchema>

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

export type FactorLoading = Of<typeof Contract.FactorLoadingSchema>
export type FactorsData = Of<typeof Contract.FactorsDataSchema>

export function useFactors(pid: string | null) {
  return useJob<FactorsData>('factors', pid, {}, {
    refreshInterval: 1_800_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/factors` : undefined,
  })
}

// --- Efficient frontier and allocation strategies (P1-31 / P1-32) ---

export type FrontierPoint = Of<typeof Contract.FrontierPointSchema>
export type OptimizationData = Of<typeof Contract.OptimizationDataSchema>

export function useOptimization(pid: string | null) {
  return useJob<OptimizationData>('optimization', pid, {}, {
    refreshInterval: 1_800_000,
    fallbackUrl: pid ? `/api/analytics/${pid}/optimization` : undefined,
  })
}

/**
 * The optimisation run again with the user's Black-Litterman opinions (4.7).
 * Synchronous: opinions do not fit a job's numeric params. Null key — no
 * request — when there are none, so the job's result stands.
 */
export function useOptimizationWithViews(pid: string | null, views: import('@/lib/services/black-litterman').ViewInput[]) {
  const key = pid && views.length > 0 ? `/api/analytics/${pid}/optimization?views=${encodeURIComponent(JSON.stringify(views))}` : null
  return useSWR<OptimizationData>(key, apiFetcher, { revalidateOnFocus: false, keepPreviousData: true })
}

// --- Scenario comparison (E2) ---

export type { ScenarioComparison, ScenarioMetrics, ScenarioExplanation } from '@/lib/services/scenario-comparison'

export type ScenarioComparisonData = Of<typeof Contract.ScenarioComparisonDataSchema>

export function useScenarioComparison(pid: string | null, query: string) {
  return useSWR<ScenarioComparisonData>(
    pid ? `/api/analytics/${pid}/scenarios?${query}` : null,
    apiFetcher,
    // Keep the table on screen while a new selection loads.
    { keepPreviousData: true, revalidateOnFocus: false }
  )
}

// --- Rebalance (P0-12 / P1-10) ---

export type RebalanceInputs = Of<typeof Contract.RebalanceInputsSchema>

/** The inputs the rebalance panel runs rebalance.ts on, in the browser. */
export function useRebalanceInputs(pid: string | null) {
  return useSWR<RebalanceInputs | { message: string }>(
    pid ? `/api/analytics/${pid}/rebalance` : null,
    apiFetcher,
    { refreshInterval: 900_000 },
  )
}

// --- Portfolio backtest (P1-17) ---

export type PortfolioBacktestData = Of<typeof Contract.PortfolioBacktestDataSchema>

/**
 * Five rebalancing schedules over the book's history, as a background job
 * (4.8) — the same job_id and polling path Monte Carlo and factors use, so a
 * slow provider cannot hold a request open past the platform's limit. The
 * synchronous route stays as the fallback where jobs are unavailable.
 */
export function usePortfolioBacktest(pid: string | null, costPct = 0.1) {
  return useJob<PortfolioBacktestData | { message: string }>('backtest', pid, { costPct }, {
    fallbackUrl: pid ? `/api/analytics/${pid}/backtest?cost=${costPct}` : undefined,
  })
}

// --- Exposure (P1-19 / P1-20) ---

export type ExposureData = Of<typeof Contract.ExposureDataSchema>

export function useExposure(pid: string | null) {
  return useSWR<ExposureData | { message: string }>(
    pid ? `/api/analytics/${pid}/exposure` : null,
    apiFetcher,
    { refreshInterval: 900_000 },
  )
}

// --- Historical stress test (P1-30) ---

export type StressData = Of<typeof Contract.StressDataSchema>

/**
 * Dated crises applied to the current book, as a background job (4.8): decades
 * of history per holding from a slow provider is exactly the work the job
 * runner exists for. The synchronous route stays as the fallback.
 */
export function useStress(pid: string | null) {
  return useJob<StressData | { message: string }>('stress', pid, {}, {
    fallbackUrl: pid ? `/api/analytics/${pid}/stress` : undefined,
  })
}
