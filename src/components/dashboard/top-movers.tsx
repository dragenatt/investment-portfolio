'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PriceDisplay } from '@/components/market/price-display'

type Mover = { symbol: string; name: string; price: number; change: number; changePct: number; currency: string }

export function TopMovers({ movers }: { movers: Mover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Top Movers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {movers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Agrega posiciones para ver tus top movers</p>
        )}
        {movers.map(m => (
          <div key={m.symbol} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{m.symbol}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[120px]">{m.name}</p>
            </div>
            <PriceDisplay price={m.price} change={m.change} changePct={m.changePct} currency={m.currency} size="sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
