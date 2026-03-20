'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatPercent } from '@/lib/utils/numbers'
import { TrendingUp, DollarSign, Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  currency: string
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, currency }: Props) {
  const { format } = useCurrency()
  const isPositive = totalReturn >= 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">{format(totalValue, currency)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Rendimiento Total</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={cn('text-2xl font-bold font-mono', isPositive ? 'text-green-600' : 'text-red-600')}>
            {format(totalReturn, currency)}
          </div>
          <p className={cn('text-xs', isPositive ? 'text-green-600' : 'text-red-600')}>
            {formatPercent(totalReturnPct)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Posiciones</CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">{positionCount}</div>
          <p className="text-xs text-muted-foreground">activos en portafolio</p>
        </CardContent>
      </Card>
    </div>
  )
}
