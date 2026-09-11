import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { HorizonReturn, AssetRiskMetrics } from '@/lib/services/asset-metrics'

export type AssetStats = {
  symbol: string
  message?: string
  observations?: number
  from_date?: string
  to_date?: string
  benchmark_symbol?: string
  risk_free_rate?: {
    currency: string
    annual_pct: number
    source: string
    is_fallback: boolean
  }
  performance?: HorizonReturn[]
  /** Null when the history is too short to measure risk from. */
  risk?: AssetRiskMetrics | null
}

export function useAssetStats(symbol: string) {
  return useSWR<AssetStats>(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/stats` : null,
    apiFetcher,
    { refreshInterval: 900_000 },
  )
}
