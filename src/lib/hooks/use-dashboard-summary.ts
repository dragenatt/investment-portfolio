import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export type DashboardSummary = {
  total_value: number
  total_cost: number
  total_return: number
  total_return_pct: number
  daily_change: number
  daily_change_pct: number
  weekly_change: number
  weekly_change_pct: number
  best_position: { symbol: string; pnl_percent: number } | null
  worst_position: { symbol: string; pnl_percent: number } | null
}

export function useDashboardSummary() {
  return useSWR<DashboardSummary>(
    '/api/dashboard/summary',
    apiFetcher,
    { refreshInterval: 120_000 }
  )
}
