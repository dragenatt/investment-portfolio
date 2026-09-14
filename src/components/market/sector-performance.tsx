'use client'

import Link from 'next/link'
import { changeTone, formatSignedPercent, toneTextClass } from '@/lib/utils/change-tone'

type SectorData = {
  name: string
  symbol: string
  changePct: number
}

export function SectorPerformance({ sectors }: { sectors: SectorData[] }) {
  const sorted = [...sectors].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.changePct ?? 0)), 0.01)

  return (
    <div className="space-y-2">
      {sorted.map(sector => {
        const pct = sector.changePct ?? 0
        const tone = changeTone(pct, 2)
        const width = (Math.abs(pct) / maxAbs) * 100

        return (
          <Link
            key={sector.symbol}
            href={`/market/${encodeURIComponent(sector.symbol)}`}
            className="group block"
          >
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
              <span className="text-xs font-medium w-32 truncate text-muted-foreground group-hover:text-foreground transition-colors">
                {sector.name}
              </span>
              <div className="flex-1 h-6 bg-muted/40 rounded-md overflow-hidden relative">
                <div
                  className={`h-full rounded-md transition-all duration-500 ${
                    tone === 'gain'
                      ? 'bg-gain/25 group-hover:bg-gain/35'
                      : tone === 'loss'
                        ? 'bg-loss/25 group-hover:bg-loss/35'
                        : 'bg-muted group-hover:bg-muted'
                  }`}
                  style={{ width: `${Math.max(3, width)}%` }}
                />
              </div>
              <span
                className={`text-xs font-mono font-semibold w-18 text-right ${
                  toneTextClass(tone)
                }`}
              >
                {formatSignedPercent(sector.changePct, 2)}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
