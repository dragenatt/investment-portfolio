'use client'

import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { PositionsTable } from '@/components/portfolio/positions-table'
import { TransactionModal } from '@/components/portfolio/transaction-modal'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { Button } from '@/components/ui/button'
import { use, useMemo } from 'react'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'

export default function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: portfolio, isLoading } = usePortfolio(id)

  const symbols = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions.filter((p: { quantity: number }) => p.quantity > 0).map((p: { symbol: string }) => p.symbol)
  }, [portfolio])

  const { data: livePrices } = useLivePrices(symbols)

  const positionsWithPrices = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions.map((pos: { symbol: string; quantity: number; avg_cost: number; [key: string]: unknown }) => ({
      ...pos,
      currentPrice: livePrices?.[pos.symbol]?.price ?? pos.avg_cost,
      changePct: livePrices?.[pos.symbol]?.changePct ?? 0,
    }))
  }, [portfolio, livePrices])

  const allocation = useMemo(() => {
    if (!positionsWithPrices.length) return []
    const map: Record<string, number> = {}
    for (const pos of positionsWithPrices) {
      if (pos.quantity > 0) {
        map[pos.asset_type] = (map[pos.asset_type] || 0) + pos.quantity * pos.currentPrice
      }
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [positionsWithPrices])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonTable />
      </div>
    )
  }

  if (!portfolio) return <p className="text-muted-foreground">Portafolio no encontrado</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{portfolio.name}</h1>
          {portfolio.description && <p className="text-muted-foreground">{portfolio.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link href={`/portfolio/${id}/analytics`}>
            <Button variant="outline" size="sm"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</Button>
          </Link>
          <TransactionModal portfolioId={id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PositionsTable positions={positionsWithPrices} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AllocationDonut data={allocation} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
