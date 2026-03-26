import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useRates() {
  return useSWR<Record<string, number>>('/api/rates', apiFetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 minutes
    fallbackData: { USD: 1, MXN: 17.5, EUR: 0.92 },
  })
}
