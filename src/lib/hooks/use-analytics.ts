import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

// --- Returns ---
export type ReturnsSummary = {
  simple: number
  twr: number
  mwr: number
  period: string
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
    sortino_ratio: number
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
  message?: string
}

export function useRisk(pid: string | null) {
  return useSWR<RiskData>(
    pid ? `/api/analytics/${pid}/risk` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
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
  rankings: Array<{ rank: number; portfolio_name: string; username: string; value: number }>
}

export function useLeaderboardHistory(category = 'return', period = '1M', days = 30) {
  return useSWR<LeaderboardHistoryEntry[]>(
    `/api/discover/leaderboard/history?category=${category}&period=${period}&days=${days}`,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}
