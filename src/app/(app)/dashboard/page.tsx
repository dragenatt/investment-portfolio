'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { PortfolioChart } from '@/components/dashboard/portfolio-chart'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { TopMovers } from '@/components/dashboard/top-movers'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { useMemo } from 'react'
import { useCurrency } from '@/lib/hooks/use-currency'

export default function DashboardPage() {
  const { data: portfolios, isLoading } = usePortfolios()
  const { currency } = useCurrency()

  const stats = useMemo(() => {
    if (!portfolios) return null

    let totalValue = 0
    let totalCost = 0
    let positionCount = 0
    const allocationMap: Record<string, number> = {}

    for (const portfolio of portfolios) {
      for (const pos of portfolio.positions || []) {
        if (pos.quantity > 0) {
          const value = pos.quantity * pos.avg_cost // Will be replaced with live price
          totalValue += value
          totalCost += pos.quantity * pos.avg_cost
          positionCount++
          allocationMap[pos.asset_type] = (allocationMap[pos.asset_type] || 0) + value
        }
      }
    }

    const totalReturn = totalValue - totalCost
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

    const allocation = Object.entries(allocationMap).map(([name, value]) => ({ name, value }))

    return { totalValue, totalReturn, totalReturnPct, positionCount, allocation }
  }, [portfolios])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <ErrorBoundary>
        <KpiCards
          totalValue={stats?.totalValue ?? 0}
          totalReturn={stats?.totalReturn ?? 0}
          totalReturnPct={stats?.totalReturnPct ?? 0}
          positionCount={stats?.positionCount ?? 0}
          currency={currency}
        />
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PortfolioChart data={[]} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AllocationDonut data={stats?.allocation ?? []} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <TopMovers movers={[]} />
      </ErrorBoundary>
    </div>
  )
}
