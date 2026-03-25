'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/lib/hooks/use-currency'
import Link from 'next/link'

type Props = {
  id: string
  name: string
  description?: string
  positions: Array<{ symbol: string; quantity: number; avg_cost: number; asset_type: string; currency?: string }>
  livePrices?: Record<string, { price: number }> | null
}

export function PortfolioCard({ id, name, description, positions, livePrices }: Props) {
  const { format } = useCurrency()
  const activePositions = positions.filter(p => p.quantity > 0)
  const totalValue = activePositions.reduce((sum, p) => {
    const price = livePrices?.[p.symbol]?.price ?? p.avg_cost
    return sum + p.quantity * price
  }, 0)
  const totalCost = activePositions.reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)
  const gainPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0

  return (
    <Link href={`/portfolio/${id}`}>
      <Card className="rounded-2xl border-border shadow-sm hover:-translate-y-0.5 transition-transform cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{name}</CardTitle>
            <Badge variant="secondary">{activePositions.length} posiciones</Badge>
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold font-mono">{format(totalValue)}</p>
          {totalCost > 0 && (
            <p className={`text-sm font-mono ${gainPct >= 0 ? 'text-gain' : 'text-loss'}`}>
              {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(2)}%
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
