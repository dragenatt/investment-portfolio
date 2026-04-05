'use client'

import { Card, CardContent } from '@/components/ui/card'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  CalendarRange,
  Trophy,
  AlertTriangle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Props = {
  totalValue: number
  totalCost: number
  totalReturn: number
  totalReturnPct: number
  dailyChange: number
  dailyChangePct: number
  weeklyChange: number
  weeklyChangePct: number
  bestPosition: { symbol: string; pnl_percent: number } | null
  worstPosition: { symbol: string; pnl_percent: number } | null
  isLoading?: boolean
}

type CardDef = {
  label: string
  icon: LucideIcon
  value: React.ReactNode
  subtitle: React.ReactNode
  color: string
  bgColor: string
  blobColor: string
}

function PnlCardSkeleton() {
  return (
    <Card className="relative overflow-hidden premium-card">
      <CardContent className="p-4 relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-7 w-28 mb-1" />
        <Skeleton className="h-5 w-16 mt-1" />
      </CardContent>
    </Card>
  )
}

function PillBadge({ value, pct }: { value?: number; pct?: number }) {
  const ref = pct ?? value ?? 0
  const isPositive = ref >= 0

  return (
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
      <PercentageChange value={pct ?? value} className="text-xs" />
    </span>
  )
}

function colorForValue(value: number) {
  return value >= 0 ? 'var(--good)' : 'var(--bad)'
}

function bgForValue(value: number) {
  return value >= 0
    ? 'color-mix(in srgb, var(--good) 10%, transparent)'
    : 'color-mix(in srgb, var(--bad) 10%, transparent)'
}

export function PnlCards({
  totalValue,
  totalCost,
  totalReturn,
  totalReturnPct,
  dailyChange,
  dailyChangePct,
  weeklyChange,
  weeklyChangePct,
  bestPosition,
  worstPosition,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <PnlCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  const cards: CardDef[] = [
    // 1 — Valor Total
    {
      label: 'Valor Total',
      icon: TrendingUp,
      value: <FormattedAmount value={totalValue} />,
      subtitle: (
        <span
          style={{ fontSize: '13px', fontWeight: 650, color: 'var(--muted-foreground)' }}
        >
          Costo: <FormattedAmount value={totalCost} />
        </span>
      ),
      color: 'var(--brand)',
      bgColor: 'color-mix(in srgb, var(--brand) 10%, transparent)',
      blobColor: 'var(--brand)',
    },
    // 2 — P&L Total
    {
      label: 'P&L Total',
      icon: totalReturn >= 0 ? TrendingUp : TrendingDown,
      value: <FormattedAmount value={totalReturn} showSign />,
      subtitle: <PillBadge pct={totalReturnPct} />,
      color: colorForValue(totalReturn),
      bgColor: bgForValue(totalReturn),
      blobColor: colorForValue(totalReturn),
    },
    // 3 — Cambio Diario
    {
      label: 'Cambio Diario',
      icon: Calendar,
      value: <FormattedAmount value={dailyChange} showSign />,
      subtitle: <PillBadge pct={dailyChangePct} />,
      color: colorForValue(dailyChange),
      bgColor: bgForValue(dailyChange),
      blobColor: colorForValue(dailyChange),
    },
    // 4 — Cambio Semanal
    {
      label: 'Cambio Semanal',
      icon: CalendarRange,
      value: <FormattedAmount value={weeklyChange} showSign />,
      subtitle: <PillBadge pct={weeklyChangePct} />,
      color: colorForValue(weeklyChange),
      bgColor: bgForValue(weeklyChange),
      blobColor: colorForValue(weeklyChange),
    },
    // 5 — Mejor Posicion
    {
      label: 'Mejor Posicion',
      icon: Trophy,
      value: bestPosition ? (
        <span>{bestPosition.symbol}</span>
      ) : (
        <span style={{ color: 'var(--muted-foreground)' }}>--</span>
      ),
      subtitle: bestPosition ? (
        <PillBadge pct={bestPosition.pnl_percent} />
      ) : (
        <span style={{ fontSize: '13px', fontWeight: 650, color: 'var(--muted-foreground)' }}>
          Sin posiciones
        </span>
      ),
      color: bestPosition ? 'var(--good)' : 'var(--muted-foreground)',
      bgColor: bestPosition
        ? 'color-mix(in srgb, var(--good) 10%, transparent)'
        : 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)',
      blobColor: bestPosition ? 'var(--good)' : 'var(--muted-foreground)',
    },
    // 6 — Peor Posicion
    {
      label: 'Peor Posicion',
      icon: AlertTriangle,
      value: worstPosition ? (
        <span>{worstPosition.symbol}</span>
      ) : (
        <span style={{ color: 'var(--muted-foreground)' }}>--</span>
      ),
      subtitle: worstPosition ? (
        <PillBadge pct={worstPosition.pnl_percent} />
      ) : (
        <span style={{ fontSize: '13px', fontWeight: 650, color: 'var(--muted-foreground)' }}>
          Sin posiciones
        </span>
      ),
      color: worstPosition ? 'var(--bad)' : 'var(--muted-foreground)',
      bgColor: worstPosition
        ? 'color-mix(in srgb, var(--bad) 10%, transparent)'
        : 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)',
      blobColor: worstPosition ? 'var(--bad)' : 'var(--muted-foreground)',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.label} className="relative overflow-hidden premium-card">
            {/* Decorative gradient blob */}
            <div
              className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
              style={{ background: card.blobColor }}
            />
            <CardContent className="p-4 relative z-10">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="p-1.5 rounded-lg"
                  style={{ backgroundColor: card.bgColor }}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: card.color }} />
                </div>
                <span
                  className="font-extrabold uppercase"
                  style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
                >
                  {card.label}
                </span>
              </div>
              <p
                className="font-bold"
                style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', letterSpacing: '-0.02em' }}
              >
                {card.value}
              </p>
              <div style={{ marginTop: '4px' }}>
                {card.subtitle}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
