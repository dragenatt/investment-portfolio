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

// The shapes the route returns, from the engine that builds them — not written
// out a second time here to drift.
export type PositionTradeHistory = import('@/lib/services/trade-history').PositionHistory
export type TradeHistoryTotals = import('@/lib/services/trade-history').HistoryTotals

/** trade-history.ts over every position: realised vs unrealised, per currency. */
export function useTradeHistory(portfolioId: string | null) {
  return useSWR<{ positions: PositionTradeHistory[]; totals: TradeHistoryTotals[] }>(
    portfolioId ? `/api/portfolio/${portfolioId}/trade-history` : null,
    apiFetcher,
  )
}
