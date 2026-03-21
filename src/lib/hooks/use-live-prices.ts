import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useLivePrices(symbols: string[]) {
  const unique = [...new Set(symbols)].sort()
  const key = unique.length > 0 ? unique.join(',') : null

  return useSWR(
    key ? `/api/market/batch?symbols=${encodeURIComponent(key)}` : null,
    fetcher,
    { refreshInterval: 30000 }
  )
}
