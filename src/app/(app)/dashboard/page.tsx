'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { usePortfolioStats } from '@/lib/hooks/use-portfolio-stats'
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { PortfolioChart } from '@/components/dashboard/portfolio-chart'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { TopMovers } from '@/components/dashboard/top-movers'
import { WelcomeEmptyState } from '@/components/dashboard/welcome-empty-state'
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { useMemo, useState } from 'react'
import { usePortfolioHistory } from '@/lib/hooks/use-portfolio-history'
import { useTranslation } from '@/lib/i18n'

export default function DashboardPage() {
  const { t } = useTranslation()
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

  const hasPortfolio = (portfolios?.length ?? 0) > 0
  const hasPosition = allSymbols.length > 0

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonChart />
      </div>
    )
  }

  // Empty state for brand new users
  if (!hasPortfolio) {
    return (
      <div className="space-y-6">
        <WelcomeEmptyState />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Onboarding checklist — visible until all steps complete or dismissed */}
      <OnboardingChecklist
        hasPortfolio={hasPortfolio}
        hasPosition={hasPosition}
        hasAdvisorProfile={false}
      />

      {/* KPI hero */}
      <ErrorBoundary>
        <KpiCards
          totalValue={stats.totalValue}
          totalReturn={stats.totalReturn}
          totalReturnPct={stats.totalReturnPct}
          positionCount={stats.positionCount}
          bestPosition={stats.bestPosition}
          todayReturn={stats.todayReturn}
          todayReturnPct={stats.todayReturnPct}
          totalCost={stats.totalCost}
        />
      </ErrorBoundary>

      {/* Chart */}
      <ErrorBoundary>
        <PortfolioChart
          data={chartData ?? []}
          isLoading={chartLoading}
          onPeriodChange={setChartRange}
        />
      </ErrorBoundary>

      {/* Allocation + Top Movers side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ErrorBoundary>
          <AllocationDonut data={stats.allocation} />
        </ErrorBoundary>
        <ErrorBoundary>
          <TopMovers movers={stats.topMovers} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
