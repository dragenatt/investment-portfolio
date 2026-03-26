import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useMarketSearch(query: string) {
  return useSWR(
    query.length >= 2 ? `/api/market/search?q=${encodeURIComponent(query)}` : null,
    apiFetcher,
    { dedupingInterval: 300 }
  )
}

export function useQuote(symbol: string | null) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}` : null,
    apiFetcher,
    { refreshInterval: 30000 }
  )
}

export function usePriceHistory(symbol: string | null, range: string = '1mo') {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/history?range=${range}` : null,
    apiFetcher
  )
}
