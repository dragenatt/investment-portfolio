import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useFundamentals(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/fundamentals` : null,
    fetcher,
    { refreshInterval: 300_000 }
  )
}
