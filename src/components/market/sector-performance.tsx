'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type SectorData = {
  name: string
  symbol: string
  changePct: number
}

export function SectorPerformance({ sectors }: { sectors: SectorData[] }) {
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct)
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.changePct)), 0.01)

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Rendimiento por Sector (1D)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map(sector => {
          const isPositive = sector.changePct >= 0
          const width = (Math.abs(sector.changePct) / maxAbs) * 100

          return (
            <div key={sector.symbol} className="flex items-center gap-2">
              <span className="text-xs w-28 truncate text-muted-foreground">{sector.name}</span>
              <div className="flex-1 h-5 bg-muted/50 rounded-md overflow-hidden relative">
                <div
                  className={`h-full rounded-md transition-all ${isPositive ? 'bg-gain/20' : 'bg-loss/20'}`}
                  style={{ width: `${Math.max(2, width)}%` }}
                />
              </div>
              <span className={`text-xs font-mono w-16 text-right ${isPositive ? 'text-gain' : 'text-loss'}`}>
                {isPositive ? '+' : ''}{sector.changePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
