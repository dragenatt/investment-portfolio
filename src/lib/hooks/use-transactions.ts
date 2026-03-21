import useSWR from 'swr'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

export type Transaction = {
  id: string
  position_id: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string
  notes: string | null
  position: {
    portfolio_id: string
    symbol: string
  }
}

export function useTransactions(portfolioId: string | null) {
  return useSWR<Transaction[]>(
    portfolioId ? `/api/transaction?pid=${portfolioId}` : null,
    fetcher
  )
}
