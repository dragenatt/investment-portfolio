import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useLivePrices(symbols: string[]) {
  const unique = [...new Set(symbols)].sort()
  const key = unique.length > 0 ? unique.join(',') : null

  return useSWR(
    key ? `/api/market/batch?symbols=${encodeURIComponent(key)}` : null,
    apiFetcher,
    { refreshInterval: 30000 }
  )
}
