import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function useTransactions(portfolioId: string | null) {
  return useSWR(portfolioId ? `/api/transaction?pid=${portfolioId}` : null, fetcher)
}
