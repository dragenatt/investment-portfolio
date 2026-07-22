import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { TechnicalSignal } from '@/lib/services/signal'

export function useSignal(symbol: string) {
  return useSWR<TechnicalSignal>(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/signal` : null,
    apiFetcher,
    { refreshInterval: 600_000 }
  )
}
