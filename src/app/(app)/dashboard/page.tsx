'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { PortfolioChart } from '@/components/dashboard/portfolio-chart'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { TopMovers } from '@/components/dashboard/top-movers'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { useMemo, useState } from 'react'
import { usePortfolioHistory } from '@/lib/hooks/use-portfolio-history'

export default function DashboardPage() {
  const { data: portfolios, isLoading } = usePortfolios()
  const [chartRange, setChartRange] = useState('30')
  const { data: chartData, isLoading: chartLoading } = usePortfolioHistory(chartRange)

  const allSymbols = useMemo(() => {
    if (!portfolios) return []
    const symbols: string[] = []
    for (const p of portfolios) {
      for (const pos of p.positions || []) {
        if (pos.quantity > 0) symbols.push(pos.symbol)
      }
    }
    return symbols
  }, [portfolios])

  const { data: livePrices } = useLivePrices(allSymbols)

  const stats = useMemo(() => {
    if (!portfolios) return null

    let totalValue = 0
    let totalCost = 0
    let positionCount = 0
    const allocationMap: Record<string, number> = {}
    const movers: Array<{ symbol: string; name: string; price: number; changePct: number; currency: string }> = []

    for (const portfolio of portfolios) {
      for (const pos of portfolio.positions || []) {
        if (pos.quantity > 0) {
          const livePrice = livePrices?.[pos.symbol]?.price ?? pos.avg_cost
          const value = pos.quantity * livePrice
          totalValue += value
          totalCost += pos.quantity * pos.avg_cost
          positionCount++
          allocationMap[pos.asset_type] = (allocationMap[pos.asset_type] || 0) + value
          if (livePrices?.[pos.symbol]) {
            movers.push({
              symbol: pos.symbol,
              name: pos.symbol,
              price: livePrices[pos.symbol].price,
              changePct: livePrices[pos.symbol].changePct,
              currency: pos.currency || 'USD',
            })
          }
        }
      }
    }

    const totalReturn = totalValue - totalCost
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

    const allocation = Object.entries(allocationMap).map(([name, value]) => ({ name, value }))
    const sortedMovers = [...movers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    const topMovers = sortedMovers.slice(0, 5)

    const bestGainer = [...movers].sort((a, b) => b.changePct - a.changePct)[0]
    const bestPosition = bestGainer && bestGainer.changePct !== 0
      ? { symbol: bestGainer.symbol, changePct: bestGainer.changePct }
      : undefined

    return { totalValue, totalReturn, totalReturnPct, positionCount, allocation, topMovers, bestPosition }
  }, [portfolios, livePrices])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <ErrorBoundary>
        <KpiCards
          totalValue={stats?.totalValue ?? 0}
          totalReturn={stats?.totalReturn ?? 0}
          totalReturnPct={stats?.totalReturnPct ?? 0}
          positionCount={stats?.positionCount ?? 0}
          bestPosition={stats?.bestPosition}
          todayReturn={undefined}
          todayReturnPct={undefined}
        />
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PortfolioChart
              data={chartData ?? []}
              isLoading={chartLoading}
              onPeriodChange={setChartRange}
            />
          </ErrorBoundary>
        </div>
        <div className="lg:col-span-1">
          <ErrorBoundary>
            <AllocationDonut data={stats?.allocation ?? []} />
          </ErrorBoundary>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ErrorBoundary>
          <TopMovers movers={stats?.topMovers ?? []} />
        </ErrorBoundary>
        <ErrorBoundary>
          <RecentActivity />
        </ErrorBoundary>
      </div>
    </div>
  )
}
