'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/lib/hooks/use-currency'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { PortfolioActions } from './portfolio-actions'
import Link from 'next/link'

type Props = {
  id: string
  name: string
  description?: string
  positions: Array<{ symbol: string; quantity: number; avg_cost: number; asset_type: string; currency?: string }>
  livePrices?: Record<string, { price: number; currency?: string }> | null
  onMutate?: () => void
}

export function PortfolioCard({ id, name, description, positions, livePrices, onMutate }: Props) {
  const { convert } = useCurrency()
  const activePositions = positions.filter(p => p.quantity > 0)
  const totalValue = activePositions.reduce((sum, p) => {
    const liveData = livePrices?.[p.symbol]
    const price = liveData?.price ?? p.avg_cost
    const priceCur = liveData?.currency || p.currency || 'USD'
    return sum + p.quantity * convert(price, priceCur)
  }, 0)
  const totalCost = activePositions.reduce((sum, p) => sum + p.quantity * convert(p.avg_cost, p.currency || 'USD'), 0)
  const gainPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0

  return (
    <Card className="rounded-2xl border-border shadow-sm card-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Link href={`/portfolio/${id}`} className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate cursor-pointer hover:underline">{name}</CardTitle>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary">{activePositions.length} posiciones</Badge>
            {onMutate && (
              <PortfolioActions id={id} name={name} description={description} onMutate={onMutate} />
            )}
          </div>
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <Link href={`/portfolio/${id}`} className="cursor-pointer">
        <CardContent>
          <p className="text-2xl font-bold"><FormattedAmount value={totalValue} /></p>
          {totalCost > 0 && (
            <p className="text-sm">
              <PercentageChange value={gainPct} />
            </p>
          )}
        </CardContent>
      </Link>
    </Card>
  )
}
