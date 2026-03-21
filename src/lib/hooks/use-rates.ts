import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function useRates() {
  return useSWR<Record<string, number>>('/api/rates', fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 minutes
    fallbackData: { USD: 1, MXN: 17.5, EUR: 0.92 },
  })
}
