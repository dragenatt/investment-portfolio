import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useEvents(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/events` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}
