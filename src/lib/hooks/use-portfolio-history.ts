import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function usePortfolioHistory(range: string) {
  return useSWR<Array<{ date: string; value: number }>>(
    `/api/portfolio/history?range=${range}`,
    fetcher,
    { refreshInterval: 60_000 }
  )
}
