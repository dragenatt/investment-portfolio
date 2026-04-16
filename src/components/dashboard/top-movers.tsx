'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { formatPercent } from '@/lib/utils/numbers'
import { TrendingUp } from 'lucide-react'

type Mover = { symbol: string; name: string; price: number; change: number; changePct: number; currency: string }

export function TopMovers({ movers }: { movers: Mover[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Mayores Movimientos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {movers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <TrendingUp className="h-5 w-5 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Sin movimientos</p>
          </div>
        )}
        {movers.map((m, idx) => {
          const isPositive = (m.change ?? 0) >= 0
          return (
            <div
              key={m.symbol}
              className={`flex items-center justify-between py-2.5${idx > 0 ? ' border-t border-border' : ''}`}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">{m.name || m.symbol}</span>
                <span className="text-xs text-muted-foreground truncate">{m.symbol}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <FormattedAmount value={m.price} from={m.currency} className="text-sm font-mono" />
                <span
                  className="text-xs font-mono font-medium"
                  style={{ color: isPositive ? 'var(--good)' : 'var(--bad)' }}
                >
                  {isPositive ? '+' : ''}{formatPercent(m.changePct)}
                </span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
