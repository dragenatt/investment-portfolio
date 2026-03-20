'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/lib/hooks/use-currency'
import Link from 'next/link'

type Props = {
  id: string
  name: string
  description?: string
  positions: Array<{ quantity: number; avg_cost: number; asset_type: string }>
}

export function PortfolioCard({ id, name, description, positions }: Props) {
  const { format } = useCurrency()
  const activePositions = positions.filter(p => p.quantity > 0)
  const totalValue = activePositions.reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)

  return (
    <Link href={`/portfolio/${id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{name}</CardTitle>
            <Badge variant="secondary">{activePositions.length} posiciones</Badge>
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold font-mono">{format(totalValue, 'USD')}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
