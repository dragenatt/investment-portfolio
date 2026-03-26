import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export function useWatchlists() {
  return useSWR('/api/watchlist', apiFetcher)
}
