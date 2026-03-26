import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function usePortfolioHistory(range: string) {
  return useSWR<Array<{ date: string; value: number }>>(
    `/api/portfolio/history?range=${range}`,
    apiFetcher,
    { refreshInterval: 60_000 }
  )
}
