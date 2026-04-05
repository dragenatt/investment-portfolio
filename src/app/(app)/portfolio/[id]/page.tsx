'use client'

import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { useTransactions } from '@/lib/hooks/use-transactions'
import { useCurrency } from '@/lib/hooks/use-currency'
import { usePortfolioAlerts } from '@/lib/hooks/use-analytics'
import { PositionsTable } from '@/components/portfolio/positions-table'
import { PositionPnLTable } from '@/components/dashboard/position-pnl-table'
import { ConcentrationAlerts } from '@/components/portfolio/concentration-alerts'
import { useTrade } from '@/lib/contexts/trade-context'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { BarChart3, List, Download, TrendingUp, TrendingDown, Plus } from 'lucide-react'
import { transactionsToCSV, positionsToCSV, downloadFile } from '@/lib/utils/export'
import type { ExportTransaction, ExportPosition } from '@/lib/utils/export'
import { useTranslation } from '@/lib/i18n'

export default function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation()
  const { id } = use(params)
  const { openTrade } = useTrade()
  const { data: portfolio, isLoading } = usePortfolio(id)
  const { data: transactions } = useTransactions(id)
  const { data: alerts, mutate: mutateAlerts } = usePortfolioAlerts(id)
  const { convert } = useCurrency()

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
        name: liveData?.name || pos.name || pos.symbol,
        currentPrice: liveData?.price ?? pos.avg_cost,
        priceCurrency: liveData?.currency || pos.currency || 'USD',
        changePct: liveData?.changePct ?? 0,
      }
    })
  }, [portfolio, livePrices])

  // Enriched positions for PositionPnLTable
  // NOTE: Do NOT convert currencies here — FormattedAmount handles conversion at render time.
  // Pass raw values in their original currency to avoid double-conversion.
  const enrichedPositions = useMemo(() => {
    if (!positionsWithPrices.length) return []
    return positionsWithPrices
      .filter((pos: { quantity: number }) => pos.quantity > 0)
      .map((pos: { id: string; symbol: string; name?: string; asset_type: string; quantity: number; avg_cost: number; currency: string; currentPrice: number; priceCurrency: string; changePct: number }) => {
        const currentPrice = pos.currentPrice
        const avgCost = pos.avg_cost
        const marketValue = pos.quantity * currentPrice
        const costBasis = pos.quantity * avgCost
        const pnlAbsolute = marketValue - costBasis
        const pnlPercent = costBasis > 0 ? (pnlAbsolute / costBasis) * 100 : 0
        const changePct = pos.changePct ?? 0
        const dailyChange = marketValue * (changePct / 100)
        const priceCurrency = pos.priceCurrency || pos.currency || 'USD'

        return {
          id: pos.id,
          symbol: pos.symbol,
          name: pos.name,
          asset_type: pos.asset_type,
          quantity: pos.quantity,
          avg_cost: avgCost,
          currency: priceCurrency,
          current_price: currentPrice,
          market_value: marketValue,
          pnl_absolute: pnlAbsolute,
          pnl_percent: pnlPercent,
          daily_change: dailyChange,
          daily_change_pct: changePct,
          sparkline_7d: [] as number[],
          is_stale: livePrices != null && !livePrices[pos.symbol],
        }
      })
  }, [positionsWithPrices, livePrices])

  const allocation = useMemo(() => {
    if (!positionsWithPrices.length) return []
    const map: Record<string, number> = {}
    for (const pos of positionsWithPrices) {
      if (pos.quantity > 0) {
        const priceCur = pos.priceCurrency || pos.currency || 'USD'
        const converted = convert(pos.currentPrice, priceCur)
        map[pos.asset_type] = (map[pos.asset_type] || 0) + pos.quantity * converted
      }
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [positionsWithPrices, convert])

  // Performance summary calculations
  const summary = useMemo(() => {
    const active = positionsWithPrices.filter((p: { quantity: number }) => p.quantity > 0)
    let totalValue = 0
    let totalCost = 0
    let dayChange = 0

    for (const pos of active) {
      const priceCur = pos.priceCurrency || pos.currency || 'USD'
      const costCur = pos.currency || 'USD'
      const currentPrice = pos.currentPrice ?? pos.avg_cost
      const priceConverted = convert(currentPrice, priceCur)
      const costConverted = convert(pos.avg_cost, costCur)
      const posValue = pos.quantity * priceConverted
      totalValue += posValue
      totalCost += pos.quantity * costConverted
      // Day change: use changePct from live prices
      const changePct = pos.changePct ?? 0
      dayChange += posValue * (changePct / 100)
    }

    const totalGain = totalValue - totalCost
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0
    const dayChangePct = (totalValue - dayChange) > 0 ? (dayChange / (totalValue - dayChange)) * 100 : 0

    return { totalValue, totalCost, totalGain, totalGainPct, dayChange, dayChangePct }
  }, [positionsWithPrices, convert])

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

  if (!portfolio) return <p className="text-muted-foreground">{t.portfolio.portfolio_not_found}</p>

  return (
    <div className="space-y-6">
      {/* Header: Portfolio name + action buttons */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">{portfolio.name}</h1>
          {portfolio.description && <p className="text-muted-foreground">{portfolio.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center justify-center rounded-xl text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 h-8 px-3 gap-1"
            onClick={() => openTrade({ portfolioId: id })}
          >
            <Plus className="h-4 w-4" /> {t.trade.new_transaction}
          </button>
          <Link href={`/portfolio/${id}/transactions`}>
            <Button className="rounded-xl" variant="outline" size="sm"><List className="h-4 w-4 mr-1" /> {t.portfolio.transactions}</Button>
          </Link>
          <Link href={`/portfolio/${id}/analytics`}>
            <Button className="rounded-xl" variant="outline" size="sm"><BarChart3 className="h-4 w-4 mr-1" /> {t.portfolio.analytics}</Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 gap-1">
              <Download className="h-4 w-4" /> {t.dashboard.export}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t.portfolio.export_data}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportTransactions}>
                {t.dashboard.export_transactions_csv}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPositions}>
                {t.dashboard.export_positions_csv}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Concentration alerts */}
      {alerts && alerts.length > 0 && (
        <ErrorBoundary>
          <ConcentrationAlerts
            alerts={alerts}
            onDismiss={async (alertId) => {
              await fetch(`/api/portfolio/${id}/alerts/${alertId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dismissed: true }),
              })
              mutateAlerts()
            }}
          />
        </ErrorBoundary>
      )}

      {/* Performance summary */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
          {/* Total value */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">{t.portfolio.total_value}</p>
            <p className="text-3xl sm:text-4xl font-bold font-mono tracking-tight">
              <FormattedAmount value={summary.totalValue} />
            </p>
          </div>

          {/* Day return */}
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">{t.portfolio.today_return}</p>
              <Badge
                variant="secondary"
                className={
                  summary.dayChange >= 0
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15'
                }
              >
                {summary.dayChange >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                <FormattedAmount value={summary.dayChange} showSign colorize />
                <span className="mx-1">|</span>
                <PercentageChange value={summary.dayChangePct} />
              </Badge>
            </div>
          </div>

          {/* Total return */}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">{t.portfolio.total_return}</p>
            <Badge
              variant="secondary"
              className={
                summary.totalGain >= 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15'
              }
            >
              {summary.totalGain >= 0 ? (
                <TrendingUp className="h-3 w-3 mr-1" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-1" />
              )}
              <FormattedAmount value={summary.totalGain} showSign colorize />
              <span className="mx-1">|</span>
              <PercentageChange value={summary.totalGainPct} />
            </Badge>
          </div>
        </div>
      </div>

      {/* Main content: positions table + allocation donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <PositionPnLTable positions={enrichedPositions} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <AllocationDonut data={allocation} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
