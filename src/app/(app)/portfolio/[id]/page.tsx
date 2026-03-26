'use client'

import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { useTransactions } from '@/lib/hooks/use-transactions'
import { PositionsTable } from '@/components/portfolio/positions-table'
import { TransactionModal } from '@/components/portfolio/transaction-modal'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { use, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { BarChart3, List, Download } from 'lucide-react'
import { transactionsToCSV, positionsToCSV, downloadFile } from '@/lib/utils/export'
import type { ExportTransaction, ExportPosition } from '@/lib/utils/export'

export default function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: portfolio, isLoading } = usePortfolio(id)
  const { data: transactions } = useTransactions(id)

  const symbols = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions.filter((p: { quantity: number }) => p.quantity > 0).map((p: { symbol: string }) => p.symbol)
  }, [portfolio])

  const { data: livePrices } = useLivePrices(symbols)

  const positionsWithPrices = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions.map((pos: { symbol: string; quantity: number; avg_cost: number; currency?: string; [key: string]: unknown }) => {
      const liveData = livePrices?.[pos.symbol]
      return {
        ...pos,
        currentPrice: liveData?.price ?? pos.avg_cost,
        // The currency the live price is denominated in (from Yahoo)
        priceCurrency: liveData?.currency || pos.currency || 'USD',
        changePct: liveData?.changePct ?? 0,
      }
    })
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

  const handleExportTransactions = useCallback(() => {
    if (!transactions?.length) return
    const mapped: ExportTransaction[] = transactions.map((t) => ({
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      fees: t.fees,
      currency: t.currency,
      executed_at: t.executed_at,
      notes: t.notes,
      symbol: t.position?.symbol,
    }))
    const csv = transactionsToCSV(mapped)
    const name = portfolio?.name ?? 'portafolio'
    downloadFile(csv, `${name}_transacciones.csv`, 'text/csv')
  }, [transactions, portfolio?.name])

  const handleExportPositions = useCallback(() => {
    if (!positionsWithPrices?.length) return
    const mapped: ExportPosition[] = positionsWithPrices.map((p: { symbol: string; quantity: number; avg_cost: number; currentPrice?: number; currency?: string }) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avg_cost: p.avg_cost,
      currentPrice: p.currentPrice,
      currency: p.currency,
    }))
    const csv = positionsToCSV(mapped)
    const name = portfolio?.name ?? 'portafolio'
    downloadFile(csv, `${name}_posiciones.csv`, 'text/csv')
  }, [positionsWithPrices, portfolio?.name])

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
          <h1 className="text-3xl font-bold">{portfolio.name}</h1>
          {portfolio.description && <p className="text-muted-foreground">{portfolio.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link href={`/portfolio/${id}/transactions`}>
            <Button className="rounded-xl" variant="outline" size="sm"><List className="h-4 w-4 mr-1" /> Transacciones</Button>
          </Link>
          <Link href={`/portfolio/${id}/analytics`}>
            <Button className="rounded-xl" variant="outline" size="sm"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 gap-1">
              <Download className="h-4 w-4" /> Exportar
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Exportar datos</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportTransactions}>
                Transacciones (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPositions}>
                Posiciones (CSV)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
