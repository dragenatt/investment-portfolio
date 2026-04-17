'use client'

import { use, useMemo } from 'react'
import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Avatar } from '@/components/ui/avatar'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Lock, Eye, GitCompareArrows, Heart, ArrowLeft } from 'lucide-react'
import { useLike } from '@/lib/hooks/use-social'
import { useTranslation } from '@/lib/i18n'

type PortfolioData = {
  id: string
  name: string
  description?: string
  currency: string
  visibility: string
  show_amounts: boolean
  show_positions: boolean
  show_allocation: boolean
  user_id: string
  owner?: {
    email: string
    username?: string
    display_name?: string
    avatar_url?: string
  }
  positions?: Array<{
    id: string
    symbol: string
    asset_type: string
    quantity: number
    avg_cost: number
    currency: string
  }>
  like_count?: number
}

export default function PublicPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation()
  const { id } = use(params)
  const { data: portfolio, isLoading, error } = useSWR<PortfolioData>(
    `/api/portfolio/${id}`,
    apiFetcher
  )
  const { isLiked, toggle: toggleLike, isLoading: likingLoading } = useLike(id)

  const symbols = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions
      .filter(p => p.quantity > 0)
      .map(p => p.symbol)
  }, [portfolio])

  const { data: livePrices } = useLivePrices(symbols)

  const positionsWithPrices = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions
      .filter(p => p.quantity > 0)
      .map(pos => {
        const liveData = livePrices?.[pos.symbol]
        const currentPrice = liveData?.price ?? pos.avg_cost
        const marketValue = pos.quantity * currentPrice
        const costBasis = pos.quantity * pos.avg_cost
        const pnl = marketValue - costBasis
        const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0
        return {
          ...pos,
          currentPrice,
          marketValue,
          costBasis,
          pnl,
          pnlPct,
          changePct: liveData?.changePct ?? 0,
        }
      })
      .sort((a, b) => b.marketValue - a.marketValue)
  }, [portfolio, livePrices])

  const summary = useMemo(() => {
    let totalValue = 0
    let totalCost = 0
    for (const pos of positionsWithPrices) {
      totalValue += pos.marketValue
      totalCost += pos.costBasis
    }
    const totalReturn = totalValue - totalCost
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0
    return { totalValue, totalCost, totalReturn, totalReturnPct }
  }, [positionsWithPrices])

  const allocation = useMemo(() => {
    const map: Record<string, number> = {}
    for (const pos of positionsWithPrices) {
      map[pos.asset_type] = (map[pos.asset_type] || 0) + pos.marketValue
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

  if (error || !portfolio) {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Lock className="h-10 w-10 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">Portafolio no disponible</h2>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Este portafolio es privado o no existe.
            </p>
            <Link href="/discover">
              <Button variant="outline" className="rounded-xl gap-2">
                <ArrowLeft className="h-4 w-4" />
                Volver a Descubrir
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const showAmounts = portfolio.show_amounts !== false
  const showPositions = portfolio.show_positions !== false
  const showAllocation = portfolio.show_allocation !== false
  const ownerName = portfolio.owner?.display_name || portfolio.owner?.username || portfolio.owner?.email || 'Anónimo'

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/discover" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Descubrir
      </Link>

      {/* Header: Owner + Portfolio info */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12 rounded-full flex-shrink-0 bg-primary/10">
            {portfolio.owner?.avatar_url ? (
              <img src={portfolio.owner.avatar_url} alt={ownerName} className="h-full w-full object-cover rounded-full" />
            ) : (
              <span className="text-lg font-bold text-primary">{ownerName[0]?.toUpperCase()}</span>
            )}
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{portfolio.name}</h1>
            <Link
              href={`/profile/${portfolio.owner?.username || portfolio.owner?.email}`}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              por {ownerName}
            </Link>
            {portfolio.description && (
              <p className="text-sm text-muted-foreground mt-1">{portfolio.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={toggleLike}
            disabled={likingLoading}
          >
            <Heart className={`h-4 w-4 ${isLiked ? 'fill-red-500 text-red-500' : ''}`} />
            {portfolio.like_count ?? 0}
          </Button>
          <Link href={`/compare?add=${id}`}>
            <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
              <GitCompareArrows className="h-4 w-4" />
              Comparar
            </Button>
          </Link>
        </div>
      </div>

      {/* Performance summary */}
      {showAmounts && (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t.portfolio.total_value}</p>
              <p className="text-3xl sm:text-4xl font-bold font-mono tracking-tight">
                <FormattedAmount value={summary.totalValue} />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">{t.portfolio.total_return}</p>
              <Badge
                variant="secondary"
                className={
                  summary.totalReturn >= 0
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                }
              >
                {summary.totalReturn >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                <FormattedAmount value={summary.totalReturn} showSign colorize />
                <span className="mx-1">|</span>
                <PercentageChange value={summary.totalReturnPct} />
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {symbols.length} posiciones
            </div>
          </div>
        </div>
      )}

      {/* Positions + Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {showPositions && (
          <div className="lg:col-span-2">
            <Card className="rounded-2xl border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Posiciones</CardTitle>
              </CardHeader>
              <CardContent>
                {positionsWithPrices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Sin posiciones</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-semibold uppercase">Símbolo</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase">Precio</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase">Cambio</TableHead>
                        {showAmounts && (
                          <>
                            <TableHead className="text-right text-xs font-semibold uppercase">Valor</TableHead>
                            <TableHead className="text-right text-xs font-semibold uppercase">P&L</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positionsWithPrices.map(pos => {
                        const isPositive = pos.changePct >= 0
                        return (
                          <TableRow key={pos.id}>
                            <TableCell>
                              <Link href={`/market/${encodeURIComponent(pos.symbol)}`} className="font-mono font-semibold text-sm hover:underline">
                                {pos.symbol}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              ${pos.currentPrice.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`text-xs font-medium ${isPositive ? 'text-gain' : 'text-loss'}`}>
                                {isPositive ? '+' : ''}{pos.changePct.toFixed(2)}%
                              </span>
                            </TableCell>
                            {showAmounts && (
                              <>
                                <TableCell className="text-right font-mono text-sm">
                                  <FormattedAmount value={pos.marketValue} />
                                </TableCell>
                                <TableCell className="text-right">
                                  <PercentageChange value={pos.pnlPct} className="text-xs font-medium justify-end" />
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {showAllocation && (
          <ErrorBoundary>
            <AllocationDonut data={allocation} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
