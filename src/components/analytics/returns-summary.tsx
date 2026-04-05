'use client'

import { Card, CardContent } from '@/components/ui/card'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'
import { formatNumber } from '@/lib/utils/numbers'
import { Skeleton } from '@/components/ui/skeleton'
import { Calculator, TrendingUp, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Props = {
  simple: number
  twr: number
  mwr: number
  period: string
  isLoading?: boolean
}

type MetricDef = {
  key: string
  label: string
  tooltipTerm: string
  subtitle: string
  icon: LucideIcon
  value: number
}

function colorForValue(value: number) {
  return value >= 0 ? 'var(--good)' : 'var(--bad)'
}

function bgForValue(value: number) {
  return value >= 0
    ? 'color-mix(in srgb, var(--good) 10%, transparent)'
    : 'color-mix(in srgb, var(--bad) 10%, transparent)'
}

function ReturnCardSkeleton() {
  return (
    <Card className="relative overflow-hidden premium-card">
      <CardContent className="p-4 relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-7 w-28 mb-1" />
        <Skeleton className="h-4 w-36 mt-2" />
        <Skeleton className="h-5 w-16 mt-2" />
      </CardContent>
    </Card>
  )
}

export function ReturnsSummary({ simple, twr, mwr, period, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ReturnCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  const metrics: MetricDef[] = [
    {
      key: 'simple',
      label: 'Retorno Simple',
      tooltipTerm: 'Retorno Simple',
      subtitle: 'Ganancia directa sobre tu inversion',
      icon: Calculator,
      value: simple,
    },
    {
      key: 'twr',
      label: 'TWR',
      tooltipTerm: 'TWR',
      subtitle: 'Rendimiento de la estrategia, sin importar depositos',
      icon: TrendingUp,
      value: twr,
    },
    {
      key: 'mwr',
      label: 'MWR',
      tooltipTerm: 'MWR',
      subtitle: 'Tu rendimiento real, considerando timing de depositos',
      icon: Wallet,
      value: mwr,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {metrics.map((metric) => {
        const Icon = metric.icon
        const color = colorForValue(metric.value)
        const bgColor = bgForValue(metric.value)
        const isPositive = metric.value >= 0

        return (
          <Card key={metric.key} className="relative overflow-hidden premium-card">
            {/* Decorative gradient blob */}
            <div
              className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
              style={{ background: color }}
            />
            <CardContent className="p-4 relative z-10">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="p-1.5 rounded-lg"
                  style={{ backgroundColor: bgColor }}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color }} />
                </div>
                <span
                  className="font-extrabold uppercase"
                  style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
                >
                  {metric.label}
                </span>
                <FinanceTooltip term={metric.tooltipTerm} />
              </div>

              <p
                className="font-bold"
                style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', letterSpacing: '-0.02em', color }}
              >
                {isPositive ? '+' : ''}{formatNumber(metric.value)}%
              </p>

              <p
                style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)', marginTop: '4px' }}
              >
                {metric.subtitle}
              </p>

              <div style={{ marginTop: '6px' }}>
                <span
                  className="inline-flex items-center font-mono px-2 py-0.5"
                  style={{
                    borderRadius: '999px',
                    fontSize: '12px',
                    border: `1px solid ${color}`,
                    backgroundColor: bgColor,
                    color,
                  }}
                >
                  {isPositive ? '+' : ''}{formatNumber(metric.value)}%
                </span>
              </div>

              <p
                className="mt-2"
                style={{ fontSize: '11px', fontWeight: 500, color: 'var(--muted-foreground)' }}
              >
                {period}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
