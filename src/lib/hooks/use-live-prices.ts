import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useLivePrices(symbols: string[]) {
  const unique = [...new Set(symbols)].sort()
  const key = unique.length > 0 ? unique.join(',') : null

  return useSWR(
    key ? `/api/market/batch?symbols=${encodeURIComponent(key)}` : null,
    apiFetcher,
    {
      refreshInterval: 60_000,          // refresh every 60s (was 30s)
      dedupingInterval: 30_000,         // deduplicate identical requests within 30s
      keepPreviousData: true,           // show stale data while revalidating
    }
  )
}
