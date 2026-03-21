import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export function usePortfolios() {
  return useSWR('/api/portfolio', fetcher)
}

export function usePortfolio(id: string | null) {
  return useSWR(id ? `/api/portfolio/${id}` : null, fetcher)
}
