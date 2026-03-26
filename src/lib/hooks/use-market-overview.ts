import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useMarketOverview() {
  return useSWR('/api/market/overview', apiFetcher, {
    refreshInterval: 60_000,
  })
}
