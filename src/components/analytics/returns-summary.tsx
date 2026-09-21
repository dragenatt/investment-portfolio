'use client'

import { Card, CardContent } from '@/components/ui/card'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Calculator, TrendingUp, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { changeTone, formatSignedPercent, toneColor } from '@/lib/utils/change-tone'
import { mwrForDisplay } from '@/lib/services/returns'

type Props = {
  simple: number
  /** Null means "not enough history to say" — shown as such, never as 0.00%. */
  twr: number | null
  mwr: number | null
  period: string
  /** How long the money has been invested, weighted by size (returns route). */
  capitalAgeDays?: number | null
  /**
   * The days the TWR measured when that is less than the period (returns
   * route, twr_days). Null or absent when it covers the period.
   */
  twrDays?: number | null
  isLoading?: boolean
}

type MetricDef = {
  key: string
  label: string
  tooltipTerm: string
  subtitle: string
  icon: LucideIcon
  value: number | null
  /** What the small label under the figure says; the period by default. */
  span?: string
}

// Zero and anything that rounds to 0.00% is neutral, not a gain (C9). No
// figure at all is neutral too.
function colorForValue(value: number | null) {
  return value == null ? 'var(--muted-foreground)' : toneColor(changeTone(value, 2))
}

function bgForValue(value: number | null) {
  if (value == null) return 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)'
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

/** A span in days, the way a reader says it. */
function daysLabel(days: number): string {
  const whole = Math.max(1, Math.round(days))
  return whole === 1 ? '1 día' : `${whole} días`
}

export function ReturnsSummary({ simple, twr, mwr, period, capitalAgeDays, twrDays, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ReturnCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // Under a year the money-weighted return is shown for the span the capital
  // has actually been invested, not raised to an annual rate (GIPS). The card
  // said "+115.67%" for a book three days old and up 0.63%.
  const moneyWeighted = mwrForDisplay(mwr, capitalAgeDays)

  const metrics: MetricDef[] = [
    {
      key: 'simple',
      label: 'Retorno Simple',
      tooltipTerm: 'Retorno Simple',
      subtitle: 'Ganancia directa sobre tu inversión',
      icon: Calculator,
      value: simple,
      // Unrealised, on what is still held, against what it cost: it runs from
      // each purchase, not over the period chosen above, and said "1Y" anyway.
      span: 'desde la compra',
    },
    {
      key: 'twr',
      label: 'TWR',
      tooltipTerm: 'TWR',
      subtitle: twr == null ? 'Aún no hay historia suficiente para medirlo' : 'Rendimiento de la estrategia, sin importar depósitos',
      icon: TrendingUp,
      value: twr,
      // Labelled with the period, a TWR over the last two days of a young book
      // read as a year's return beside a simple return covering all of it.
      span: twr != null && twrDays != null ? `en ${daysLabel(twrDays)}` : undefined,
    },
    {
      key: 'mwr',
      label: 'MWR',
      tooltipTerm: 'MWR',
      subtitle:
        moneyWeighted == null
          ? 'Aún no hay historia suficiente para medirlo'
          : 'Tu rendimiento real, considerando cuándo depositaste',
      icon: Wallet,
      value: moneyWeighted?.value ?? null,
      span:
        moneyWeighted && !moneyWeighted.annualised && moneyWeighted.days != null
          ? `en ${daysLabel(moneyWeighted.days)} · sin anualizar`
          : undefined,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {metrics.map((metric) => {
        const Icon = metric.icon
        const color = colorForValue(metric.value)
        const bgColor = bgForValue(metric.value)

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
                className="font-bold font-financial"
                style={{ fontSize: '22px', color }}
              >
                {metric.value == null ? '--' : formatSignedPercent(metric.value, 2)}
              </p>

              <p
                style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)', marginTop: '4px' }}
              >
                {metric.subtitle}
              </p>

              <div style={{ marginTop: '6px' }}>
                <span
                  className="inline-flex items-center font-financial px-2 py-0.5"
                  style={{
                    borderRadius: '999px',
                    fontSize: '12px',
                    border: `1px solid ${color}`,
                    backgroundColor: bgColor,
                    color,
                  }}
                >
                  {metric.value == null ? '--' : formatSignedPercent(metric.value, 2)}
                </span>
              </div>

              <p
                className="mt-2"
                style={{ fontSize: '11px', fontWeight: 500, color: 'var(--muted-foreground)' }}
              >
                {metric.span ?? period}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
