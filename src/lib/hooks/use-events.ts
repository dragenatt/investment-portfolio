import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useEvents(symbol: string) {
  return useSWR(
    symbol ? `/api/market/${encodeURIComponent(symbol)}/events` : null,
    fetcher,
    { refreshInterval: 600_000 }
  )
}
