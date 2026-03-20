import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function usePortfolios() {
  return useSWR('/api/portfolio', fetcher)
}

export function usePortfolio(id: string | null) {
  return useSWR(id ? `/api/portfolio/${id}` : null, fetcher)
}
