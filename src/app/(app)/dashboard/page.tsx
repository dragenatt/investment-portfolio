'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { usePortfolioStats } from '@/lib/hooks/use-portfolio-stats'
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
  const stats = usePortfolioStats(portfolios, livePrices)

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
          totalValue={stats.totalValue}
          totalReturn={stats.totalReturn}
          totalReturnPct={stats.totalReturnPct}
          positionCount={stats.positionCount}
          bestPosition={stats.bestPosition}
          todayReturn={stats.todayReturn}
          todayReturnPct={stats.todayReturnPct}
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
            <AllocationDonut data={stats.allocation} />
          </ErrorBoundary>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ErrorBoundary>
          <TopMovers movers={stats.topMovers} />
        </ErrorBoundary>
        <ErrorBoundary>
          <RecentActivity />
        </ErrorBoundary>
      </div>
    </div>
  )
}
