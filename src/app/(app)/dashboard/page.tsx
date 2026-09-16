'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { usePortfolioStats } from '@/lib/hooks/use-portfolio-stats'
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { TopMovers } from '@/components/dashboard/top-movers'
import { WelcomeEmptyState } from '@/components/dashboard/welcome-empty-state'
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { ErrorDisplay } from '@/components/shared/error-display'
import { useMemo, useState } from 'react'
import { usePortfolioHistory } from '@/lib/hooks/use-portfolio-history'
import { useTranslation } from '@/lib/i18n'
import { PortfolioChart, AllocationDonut } from '@/components/charts/lazy-charts'
import { DataGate } from '@/components/shared/data-gate'

export default function DashboardPage() {
  const { t } = useTranslation()
  const { data: portfolios, isLoading, error, mutate } = usePortfolios()
  const [chartRange, setChartRange] = useState('30')
  const { data: chartData, isLoading: chartLoading, error: chartError, currency: chartCurrency, unconverted } = usePortfolioHistory(chartRange)

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

  // Keep the last known daily return so a momentary empty live-price refresh
  // doesn't make the "Hoy" figure vanish and then reappear. This is the React
  // "adjust state during render" pattern — no effect needed.
  const [stickyToday, setStickyToday] = useState<{ value?: number; pct?: number }>({})
  if (stats.todayReturn != null && stats.todayReturn !== stickyToday.value) {
    setStickyToday({ value: stats.todayReturn, pct: stats.todayReturnPct })
  }
  const todayReturn = stats.todayReturn ?? stickyToday.value
  const todayReturnPct = stats.todayReturnPct ?? stickyToday.pct

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

  // A failed request is not an empty account. Before this check, a 429 from
  // the rate limiter, a server error or an offline 503 with nothing saved told
  // someone with money invested to "create your first portfolio" (C5).
  if (error && !portfolios) {
    return (
      <div className="space-y-6">
        <ErrorDisplay
          error="No se pudieron cargar tus portafolios. Tus datos no se han perdido."
          onRetry={() => mutate()}
        />
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
          todayReturn={todayReturn}
          todayReturnPct={todayReturnPct}
          totalCost={stats.totalCost}
        />
      </ErrorBoundary>

      {/* Chart */}
      {/* A failed history load used to say "Agrega transacciones para ver el rendimiento" (C9). */}
      <DataGate error={chartError} hasData={!!chartData} what="la evolución del portafolio">
        <ErrorBoundary>
          <PortfolioChart
            data={chartData ?? []}
            isLoading={chartLoading}
            onPeriodChange={setChartRange}
            currency={chartCurrency}
            unconverted={unconverted}
          />
        </ErrorBoundary>
      </DataGate>

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
