'use client'

import { Card, CardContent } from '@/components/ui/card'
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Trophy, Minus } from 'lucide-react'
import { useCurrency } from '@/lib/hooks/use-currency'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  bestPosition?: { symbol: string; changePct: number }
  todayReturn?: number
  todayReturnPct?: number
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, bestPosition, todayReturn, todayReturnPct }: Props) {
  const { format } = useCurrency()

  const cards = [
    {
      label: 'Valor Total',
      value: format(totalValue, 'USD'),
      sub: `${positionCount} posiciones`,
      icon: DollarSign,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Hoy',
      value: todayReturn != null ? `${todayReturn >= 0 ? '+' : ''}${format(Math.abs(todayReturn), 'USD')}` : '--',
      sub: todayReturnPct != null ? `${todayReturnPct >= 0 ? '+' : ''}${todayReturnPct.toFixed(2)}%` : '--',
      icon: todayReturn == null ? Minus : todayReturn >= 0 ? TrendingUp : TrendingDown,
      color: todayReturn == null ? 'text-muted-foreground' : todayReturn >= 0 ? 'text-gain' : 'text-loss',
      bgColor: todayReturn == null ? 'bg-muted' : todayReturn >= 0 ? 'bg-gain/10' : 'bg-loss/10',
    },
    {
      label: 'Ganancia Total',
      value: `${totalReturn >= 0 ? '+' : ''}${format(Math.abs(totalReturn), 'USD')}`,
      sub: `${totalReturn >= 0 ? '+' : ''}${(totalReturnPct ?? 0).toFixed(2)}%`,
      icon: BarChart3,
      color: totalReturn >= 0 ? 'text-gain' : 'text-loss',
      bgColor: totalReturn >= 0 ? 'bg-gain/10' : 'bg-loss/10',
    },
    {
      label: 'Mejor Posicion',
      value: bestPosition?.symbol || '--',
      sub: bestPosition ? `${(bestPosition.changePct ?? 0) >= 0 ? '+' : ''}${(bestPosition.changePct ?? 0).toFixed(2)}%` : '--',
      icon: Trophy,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.label} className="rounded-2xl border-border shadow-sm hover:-translate-y-0.5 transition-transform">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
              <div className={`p-1.5 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
            </div>
            <p className="text-xl font-bold font-mono">{card.value}</p>
            <p className={`text-xs mt-1 ${card.color}`}>{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
