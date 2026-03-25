'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  marketCap: number | null
  peRatio: number | null
  eps: number | null
  dividendYield: number | null
  week52High: number | null
  week52Low: number | null
  currentPrice?: number
  analystRating: string | null
  analystTarget: number | null
}

function formatLargeNumber(n: number | null): string {
  if (n == null) return '--'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

export function FundamentalsGrid({
  marketCap, peRatio, eps, dividendYield,
  week52High, week52Low, currentPrice,
  analystRating, analystTarget,
}: Props) {
  const metrics = [
    { label: 'Cap. de Mercado', value: formatLargeNumber(marketCap) },
    { label: 'P/E Ratio', value: peRatio != null ? `${peRatio.toFixed(2)}x` : '--' },
    { label: 'EPS (TTM)', value: eps != null ? `$${eps.toFixed(2)}` : '--' },
    { label: 'Div. Yield', value: dividendYield != null ? `${dividendYield.toFixed(2)}%` : '--' },
    { label: '52W Alto', value: week52High != null ? `$${week52High.toFixed(2)}` : '--' },
    { label: '52W Bajo', value: week52Low != null ? `$${week52Low.toFixed(2)}` : '--' },
    { label: 'Consenso', value: analystRating ?? '--' },
    { label: 'Precio Obj.', value: analystTarget != null ? `$${analystTarget.toFixed(2)}` : '--' },
  ]

  const rangePercent = (week52High && week52Low && currentPrice)
    ? ((currentPrice - week52Low) / (week52High - week52Low)) * 100
    : null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Fundamentales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {metrics.map(m => (
            <div key={m.label}>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="font-semibold text-sm font-mono">{m.value}</p>
            </div>
          ))}
        </div>
        {rangePercent != null && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>${week52Low?.toFixed(2)}</span>
              <span>Rango 52 semanas</span>
              <span>${week52High?.toFixed(2)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(0, rangePercent))}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
