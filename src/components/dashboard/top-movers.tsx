'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PriceDisplay } from '@/components/market/price-display'
import { TrendingUp } from 'lucide-react'

type Mover = { symbol: string; name: string; price: number; change: number; changePct: number; currency: string }

export function TopMovers({ movers }: { movers: Mover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Top Movers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {movers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="p-3 rounded-xl bg-primary/10 mb-3">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium mb-1">Sin movimientos</p>
            <p className="text-xs text-muted-foreground max-w-[200px]">Agrega posiciones a tu portafolio para ver los activos con mayor movimiento del dia.</p>
          </div>
        )}
        {movers.map(m => (
          <div key={m.symbol} className="flex items-center justify-between rounded-lg card-hover px-1">
            <div>
              <p className="font-medium text-sm">{m.symbol}</p>
            </div>
            <PriceDisplay price={m.price} change={m.change} changePct={m.changePct} currency={m.currency} size="sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
