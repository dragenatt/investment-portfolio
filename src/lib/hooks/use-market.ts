import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useMarketSearch(query: string) {
  return useSWR(
    query.length >= 1 ? `/api/market/search?q=${encodeURIComponent(query)}` : null,
    fetcher,
    { dedupingInterval: 300 }
  )
}

export function useQuote(symbol: string | null) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 30000 }
  )
}

export function usePriceHistory(symbol: string | null, range: string = '1mo') {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/history?range=${range}` : null,
    fetcher
  )
}
