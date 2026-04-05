'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { formatPercent } from '@/lib/utils/numbers'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, TrendingDown, Flame, Snowflake } from 'lucide-react'

type Position = {
  symbol: string
  name: string
  daily_change_pct: number
  current_price: number
}

type Props = {
  winners: Position[]
  losers: Position[]
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

function PositionRow({
  position,
  rank,
  variant,
  isFirst,
}: {
  position: Position
  rank: number
  variant: 'winner' | 'loser'
  isFirst: boolean
}) {
  const router = useRouter()
  const isPositive = variant === 'winner'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/market/${position.symbol}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          router.push(`/market/${position.symbol}`)
        }
      }}
      className={`group flex items-center gap-3 py-2.5 px-1 cursor-pointer transition-colors hover:bg-muted/50${!isFirst ? ' border-t border-border' : ''}`}
    >
      {/* Rank */}
      <span
        className="text-xs font-mono flex-shrink-0 w-5 text-center"
        style={{ color: 'var(--muted-foreground)' }}
      >
        #{rank}
      </span>

      {/* Symbol */}
      <span className="text-sm font-bold font-mono flex-shrink-0 w-14 truncate">
        {position.symbol}
      </span>

      {/* Name */}
      <span
        className="text-xs truncate flex-1 min-w-0"
        style={{ color: 'var(--muted-foreground)', fontWeight: 650 }}
      >
        {position.name}
      </span>

      {/* Change pill */}
      <span
        className="inline-flex items-center gap-1 font-mono px-2 py-0.5 flex-shrink-0"
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
        {formatPercent(position.daily_change_pct)}
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
            Ganadores del Dia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {isLoading ? (
            <SkeletonRows />
          ) : winners.length === 0 ? (
            <EmptyState />
          ) : (
            winners.slice(0, 5).map((position, idx) => (
              <PositionRow
                key={position.symbol}
                position={position}
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
            Perdedores del Dia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {isLoading ? (
            <SkeletonRows />
          ) : losers.length === 0 ? (
            <EmptyState />
          ) : (
            losers.slice(0, 5).map((position, idx) => (
              <PositionRow
                key={position.symbol}
                position={position}
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
