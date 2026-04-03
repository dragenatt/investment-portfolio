/**
 * Portfolio Comparison Service
 *
 * Re-exports comparison types and utility functions.
 * The actual computation is done by the snapshot engine (snapshots.ts)
 * and served via API routes (/api/compare, /api/compare/history).
 */

export type { ComparisonMetrics, ComparisonData, ComparisonHistory } from '@/lib/hooks/use-compare'

export type PortfolioSnapshot = {
  portfolioId: string
  portfolioName: string
  value: number
  totalReturn: number
  returnPercent: number
  timestamp: string
}

export type NormalizedHistory = {
  portfolioId: string
  portfolioName: string
  values: Array<{
    date: string
    normalizedValue: number
  }>
}

type Period = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

export function getPeriodDays(period: Period): number {
  const periods: Record<Period, number> = {
    '1M': 30,
    '3M': 90,
    '6M': 180,
    '1Y': 365,
    '5Y': 1825,
    'ALL': 10000
  }
  return periods[period]
}
