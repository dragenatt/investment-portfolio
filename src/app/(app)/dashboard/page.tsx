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
import { OnboardingTour } from '@/components/shared/onboarding-tour'
import { useMemo, useState } from 'react'
import { usePortfolioHistory } from '@/lib/hooks/use-portfolio-history'
import { ArrowRightLeft, Bell, Download, FileJson, FileText } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTrade } from '@/lib/contexts/trade-context'
import { useTranslation } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export default function DashboardPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const { data: portfolios, isLoading } = usePortfolios()
  const { openTrade } = useTrade()
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

  const handleExport = (format: 'csv_positions' | 'csv_transactions' | 'json') => {
    if (!portfolios || portfolios.length === 0) {
      toast.error(t.dashboard.no_portfolios)
      return
    }

    const portfolioId = portfolios[0].id
    const url = `/api/portfolio/${portfolioId}/export?format=${format}`
    window.open(url, '_blank')
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
        <SkeletonChart />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <OnboardingTour />

      {/* Editorial header + quick action pills */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-1">
          <h1
            className="font-bold tracking-tight font-serif"
            style={{ fontSize: 'clamp(24px, 3vw, 40px)', letterSpacing: '-0.03em' }}
          >
            {t.dashboard.title}
          </h1>
          <p
            className="text-muted-foreground text-sm font-semibold max-w-[62ch]"
          >
            {t.dashboard.description}
          </p>
        </div>

        {/* Quick action pills */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="inline-flex items-center gap-2 border border-border rounded-full px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors btn-press"
            onClick={() => openTrade()}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            {t.dashboard.transaction}
            <kbd
              className="hidden sm:inline-flex items-center font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground"
            >
              T
            </kbd>
          </button>
          <button
            className="inline-flex items-center gap-2 border border-border rounded-full px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors btn-press"
          >
            <Bell className="h-3.5 w-3.5" />
            {t.dashboard.alert}
            <kbd
              className="hidden sm:inline-flex items-center font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground"
            >
              A
            </kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                className="inline-flex items-center gap-2 border border-border rounded-full px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors btn-press"
              >
                <Download className="h-3.5 w-3.5" />
                {t.dashboard.export}
                <kbd
                  className="hidden sm:inline-flex items-center font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground"
                >
                  E
                </kbd>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('csv_positions')}>
                <FileText className="h-4 w-4" />
                {t.dashboard.export_positions_csv}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv_transactions')}>
                <FileText className="h-4 w-4" />
                {t.dashboard.export_transactions_csv}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <FileJson className="h-4 w-4" />
                {t.dashboard.export_all_json}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bento grid: portfolio summary (1.1fr) | market context (0.9fr) */}
      <div
        className="bento-grid stagger-enter"
      >
        {/* Left column — portfolio summary */}
        <div className="space-y-6">
          <ErrorBoundary>
            <div data-tour="hero-section">
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
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div data-tour="portfolio-chart">
              <PortfolioChart
                data={chartData ?? []}
                isLoading={chartLoading}
                onPeriodChange={setChartRange}
              />
            </div>
          </ErrorBoundary>

          {/* Action buttons row */}
          <div className="flex items-center gap-3">
            <Link
              href="/portfolio"
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors hover:bg-secondary text-center btn-press border border-border"
            >
              {t.dashboard.review_positions}
            </Link>
            <button
              onClick={() => {
                if (portfolios && portfolios.length > 0) {
                  router.push(`/portfolio/${portfolios[0].id}`)
                } else {
                  router.push('/portfolio')
                }
              }}
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors hover:bg-secondary btn-press border border-border"
            >
              {t.dashboard.risk_check}
            </button>
            <Link
              href="/advisor"
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors hover:bg-secondary text-center btn-press border border-border"
            >
              {t.dashboard.rebalance}
            </Link>
          </div>
        </div>

        {/* Right column — market context */}
        <div className="space-y-6">
          <ErrorBoundary>
            <AllocationDonut data={stats.allocation} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TopMovers movers={stats.topMovers} />
          </ErrorBoundary>
        </div>
      </div>

      <ErrorBoundary>
        <RecentActivity />
      </ErrorBoundary>
    </div>
  )
}
