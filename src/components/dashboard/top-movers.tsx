'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { formatPercent } from '@/lib/utils/numbers'
import { TrendingUp } from 'lucide-react'

type Mover = { symbol: string; name: string; price: number; change: number; changePct: number; currency: string }

/** Tiny inline sparkline SVG — decorative, based on changePct direction */
function MiniSparkline({ positive }: { positive: boolean }) {
  const color = positive ? 'var(--good, #10b981)' : 'var(--bad, #ef4444)'
  const d = positive
    ? 'M0 12 L4 10 L8 11 L12 7 L16 8 L20 4 L24 3'
    : 'M0 3 L4 5 L8 4 L12 8 L16 7 L20 11 L24 12'
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" fill="none" className="flex-shrink-0">
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TopMovers({ movers }: { movers: Mover[] }) {
  return (
    <Card
      className="overflow-hidden"
      style={{ borderRadius: '16px', border: '1px solid var(--hair)', background: 'var(--paper)' }}
    >
      <CardHeader className="pb-2">
        <CardTitle
          className="font-extrabold uppercase"
          style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted)' }}
        >
          Mayores Movimientos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {movers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="p-3 rounded-xl mb-3" style={{ backgroundColor: 'color-mix(in srgb, var(--brand) 10%, transparent)' }}>
              <TrendingUp className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            </div>
            <p className="text-sm font-medium mb-1">Sin movimientos</p>
            <p className="text-xs max-w-[200px]" style={{ color: 'var(--muted)' }}>
              Agrega posiciones a tu portafolio para ver los activos con mayor movimiento del día.
            </p>
          </div>
        )}
        {movers.map((m, idx) => {
          const isPositive = (m.change ?? 0) >= 0
          return (
            <div
              key={m.symbol}
              className="flex items-center justify-between py-2.5 px-1"
              style={idx > 0 ? { borderTop: '1px solid var(--hair)' } : undefined}
            >
              {/* Symbol + Name */}
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">{m.symbol}</span>
                {m.name && (
                  <span className="text-xs truncate" style={{ color: 'var(--muted)', fontWeight: 650 }}>
                    {m.name}
                  </span>
                )}
              </div>

              {/* Price + Change + Sparkline */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <FormattedAmount value={m.price} from={m.currency} className="text-sm font-mono" />
                <span
                  className="inline-flex items-center font-mono px-2 py-0.5"
                  style={{
                    borderRadius: '999px',
                    fontSize: '12px',
                    border: `1px solid ${isPositive ? 'var(--good)' : 'var(--bad)'}`,
                    backgroundColor: isPositive
                      ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                    color: isPositive ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  {isPositive ? '+' : ''}{formatPercent(m.changePct)}
                </span>
                <MiniSparkline positive={isPositive} />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
