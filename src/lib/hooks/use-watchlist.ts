import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useWatchlists() {
  return useSWR('/api/watchlist', fetcher)
}
