import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useMarketSearch(query: string) {
  return useSWR(
    query.length >= 2 ? `/api/market/search?q=${encodeURIComponent(query)}` : null,
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
