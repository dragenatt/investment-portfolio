'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { assetsBySector } from '@/lib/data/asset-universe'

/**
 * Browse the curated ~100-asset universe grouped by sector. Each asset links to
 * its detail page (chart + technical signal + fundamentals). Static list — no
 * price fetch here, so it renders instantly.
 */
export function SectorBrowser() {
  const groups = assetsBySector()

  return (
    <div className="space-y-6">
      {groups.map(({ sector, assets }) => (
        <div key={sector}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold">{sector}</h3>
            <span className="text-xs text-muted-foreground">{assets.length}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {assets.map((a) => (
              <Link key={a.symbol} href={`/market/${encodeURIComponent(a.symbol)}`}>
                <Card className="card-hover cursor-pointer h-full">
                  <CardContent className="p-3">
                    <p className="font-mono font-semibold text-sm">{a.symbol}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.name}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
