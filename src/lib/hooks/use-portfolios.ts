import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function usePortfolios() {
  return useSWR('/api/portfolio', apiFetcher)
}

export function usePortfolio(id: string | null) {
  return useSWR(id ? `/api/portfolio/${id}` : null, apiFetcher)
}
