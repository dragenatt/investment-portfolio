import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useFundamentals(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/fundamentals` : null,
    apiFetcher,
    { refreshInterval: 300_000 }
  )
}
