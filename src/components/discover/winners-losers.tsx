'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSignedPercent } from '@/lib/utils/change-tone'
import type { DailyMover } from '@/lib/services/discover'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, TrendingDown, Flame, Snowflake } from 'lucide-react'

// Public PORTFOLIOS that rose and fell most since yesterday. This component
// was written for assets — a symbol, a price, a daily change — while its route
// has always returned portfolios, so every row showed "--", had no key, and
// linked to /market/undefined.
type Props = {
  winners: DailyMover[]
  losers: DailyMover[]
  isLoading?: boolean
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 py-2.5 px-1${i > 0 ? ' border-t border-border' : ''}`}
        >
          <Skeleton className="h-4 w-5 rounded" />
          <Skeleton className="h-4 w-12 rounded" />
          <Skeleton className="h-4 flex-1 rounded" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-8">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Sin datos disponibles
      </p>
    </div>
  )
}

function MoverRow({
  mover,
  rank,
  variant,
  isFirst,
}: {
  mover: DailyMover
  rank: number
  variant: 'winner' | 'loser'
  isFirst: boolean
}) {
  const router = useRouter()
  const isPositive = variant === 'winner'
  const href = `/portfolio/${mover.portfolio_id}/public`

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${mover.name}, ${formatSignedPercent(mover.change_pct, 2)} hoy`}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          router.push(href)
        }
      }}
      className={`group flex items-center gap-3 py-2.5 px-1 cursor-pointer transition-colors hover:bg-muted/50${!isFirst ? ' border-t border-border' : ''}`}
    >
      {/* Rank */}
      <span
        className="text-xs font-financial flex-shrink-0 w-5 text-center"
        style={{ color: 'var(--muted-foreground)' }}
      >
        #{rank}
      </span>

      {/* Portfolio */}
      <span className="text-sm font-semibold truncate flex-1 min-w-0">
        {mover.name}
      </span>

      {/* Change pill */}
      <span
        className="inline-flex items-center gap-1 font-financial px-2 py-0.5 flex-shrink-0"
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
        {formatSignedPercent(mover.change_pct, 2)}
        {isPositive ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )}
      </span>
    </div>
  )
}

export function WinnersLosers({ winners, losers, isLoading }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Winners */}
      <Card className="overflow-hidden premium-card">
        <CardHeader className="pb-2">
          <CardTitle
            className="flex items-center gap-2 font-extrabold uppercase"
            style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
          >
            <div
              className="p-1 rounded-md"
              style={{ backgroundColor: 'color-mix(in srgb, var(--good) 12%, transparent)' }}
            >
              <Flame className="h-3.5 w-3.5" style={{ color: 'var(--good)' }} />
            </div>
            Ganadores del día
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {isLoading ? (
            <SkeletonRows />
          ) : winners.length === 0 ? (
            <EmptyState />
          ) : (
            winners.slice(0, 5).map((mover, idx) => (
              <MoverRow
                key={mover.portfolio_id}
                mover={mover}
                rank={idx + 1}
                variant="winner"
                isFirst={idx === 0}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Losers */}
      <Card className="overflow-hidden premium-card">
        <CardHeader className="pb-2">
          <CardTitle
            className="flex items-center gap-2 font-extrabold uppercase"
            style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
          >
            <div
              className="p-1 rounded-md"
              style={{ backgroundColor: 'color-mix(in srgb, var(--bad) 12%, transparent)' }}
            >
              <Snowflake className="h-3.5 w-3.5" style={{ color: 'var(--bad)' }} />
            </div>
            Perdedores del día
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {isLoading ? (
            <SkeletonRows />
          ) : losers.length === 0 ? (
            <EmptyState />
          ) : (
            losers.slice(0, 5).map((mover, idx) => (
              <MoverRow
                key={mover.portfolio_id}
                mover={mover}
                rank={idx + 1}
                variant="loser"
                isFirst={idx === 0}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
