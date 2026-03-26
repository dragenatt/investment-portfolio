import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

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
    apiFetcher
  )
}
