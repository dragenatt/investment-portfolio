import useSWR from 'swr'
import { useState, useCallback } from 'react'
import { apiFetcher } from '@/lib/api/fetcher'

export type ComparisonMetrics = {
  portfolioId: string
  portfolioName: string
  currentValue: number
  totalCost: number
  totalReturn: number
  returnPercent: number
  periodReturn: number
  periodReturnPct: number
  positionCount: number
  allocation: Record<string, number>
  topHoldings: Array<{ symbol: string; weight: number; value: number }>
  riskScore: number | null
  sharpeRatio: number | null
  volatility: number | null
  maxDrawdown: number | null
  beta: number | null
  alpha: number | null
  sortinoRatio: number | null
  winRate: number | null
  diversificationScore: number | null
  currency: string
}

export type ComparisonData = {
  period: string
  startDate: string
  endDate: string
  metrics: ComparisonMetrics[]
}

export type ComparisonHistory = {
  portfolioId: string
  portfolioName: string
  values: Array<{
    date: string
    normalizedValue: number
  }>
}

type Period = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

export function useComparison(portfolioIds: string[], period: Period = '1Y') {
  const params = new URLSearchParams({
    ids: portfolioIds.join(','),
    period
  })

  const { data, error, isLoading, mutate } = useSWR<ComparisonData>(
    portfolioIds.length > 0 ? `/api/compare?${params.toString()}` : null,
    apiFetcher
  )

  return { comparison: data, isLoading, error, mutate }
}

export function useSaveComparison() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const save = useCallback(
    async (portfolioIds: string[], name: string, description?: string) => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            portfolio_ids: portfolioIds,
            period: '1Y',
            metrics: ['return', 'sharpe', 'volatility', 'maxDrawdown', 'winRate']
          })
        })
        const json = await res.json()
        if (json.error) throw new Error(json.error)
        return json.data
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return { save, isLoading, error }
}

export function useComparisonHistory(
  portfolioIds: string[],
  period: Period = '1Y'
) {
  const params = new URLSearchParams({
    ids: portfolioIds.join(','),
    period
  })

  const { data, error, isLoading, mutate } = useSWR<ComparisonHistory[]>(
    portfolioIds.length > 0 ? `/api/compare/history?${params.toString()}` : null,
    apiFetcher
  )

  return { history: data ?? [], isLoading, error, mutate }
}
