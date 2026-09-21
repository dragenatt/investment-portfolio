import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import { LIVE_POLL_MS } from '@/lib/services/live-prices'

export function useMarketSearch(query: string) {
  return useSWR(
    query.length >= 2 ? `/api/market/search?q=${encodeURIComponent(query)}` : null,
    apiFetcher,
    { dedupingInterval: 300 }
  )
}

/** One symbol's live quote, asked for as often as the dashboard asks for its prices. */
export function useQuote(symbol: string | null) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}` : null,
    apiFetcher,
    { refreshInterval: LIVE_POLL_MS, dedupingInterval: 2_000 }
  )
}

export function usePriceHistory(symbol: string | null, range: string = '1mo') {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/history?range=${range}` : null,
    apiFetcher
  )
}
