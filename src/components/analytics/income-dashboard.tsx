'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { formatNumber } from '@/lib/utils/numbers'
import { getChartTheme, formatAxisTick } from '@/lib/utils/chart-config'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { DollarSign, Calendar, TrendingUp, Banknote } from 'lucide-react'

type Props = {
  totals: {
    mtd: number
    ytd: number
    all_time: number
    portfolio_yield: number
  }
  byPosition: Array<{
    symbol: string
    total: number
    count: number
  }>
  monthlyHistory: Array<{
    month: string
    amount: number
  }>
  isLoading?: boolean
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  accentVar,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  accentVar: string
}) {
  return (
    <Card className="relative overflow-hidden premium-card">
      <div
        className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
        style={{ background: `var(--${accentVar})` }}
      />
      <CardContent className="p-4 relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="p-1.5 rounded-lg"
            style={{ backgroundColor: `color-mix(in srgb, var(--${accentVar}) 10%, transparent)` }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: `var(--${accentVar})` }} />
          </div>
          <span
            className="font-extrabold uppercase"
            style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
          >
            {label}
          </span>
        </div>
        <p
          className="font-bold"
          style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', letterSpacing: '-0.02em' }}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
        {label}
      </p>
      <p className="text-sm font-bold font-mono" style={{ color: 'var(--good)' }}>
        ${formatNumber(payload[0].value)}
      </p>
    </div>
  )
}

export function IncomeDashboard({ totals, byPosition, monthlyHistory, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonChart />
        <SkeletonChart />
      </div>
    )
  }

  const hasData = totals.all_time > 0 || byPosition.length > 0

  if (!hasData) {
    return (
      <Card className="rounded-2xl border-border shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="p-4 rounded-2xl bg-primary/10 mb-4">
            <Banknote className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold text-lg mb-2">Sin dividendos</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            No hay dividendos registrados. Los dividendos aparecen automaticamente al registrar transacciones tipo &apos;dividend&apos;.
          </p>
        </CardContent>
      </Card>
    )
  }

  const theme = getChartTheme()
  const sortedPositions = [...byPosition].sort((a, b) => b.total - a.total)
  const maxTotal = sortedPositions[0]?.total || 1

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={Calendar}
          label="Ingreso MTD"
          value={<FormattedAmount value={totals.mtd} />}
          accentVar="good"
        />
        <SummaryCard
          icon={Calendar}
          label="Ingreso YTD"
          value={<FormattedAmount value={totals.ytd} />}
          accentVar="good"
        />
        <SummaryCard
          icon={DollarSign}
          label="Ingreso Total"
          value={<FormattedAmount value={totals.all_time} />}
          accentVar="good"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Yield del Portafolio"
          value={`${formatNumber(totals.portfolio_yield)}%`}
          accentVar="brand"
        />
      </div>

      {/* Monthly Income Chart */}
      {monthlyHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ingresos Mensuales</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyHistory}>
                <XAxis dataKey="month" {...theme.xAxis} />
                <YAxis {...theme.yAxis} tickFormatter={v => formatAxisTick(v, 'currency')} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--muted-foreground) 10%, transparent)' }} />
                <Bar dataKey="amount" fill={theme.colors.positive} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Income by Position */}
      {sortedPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ingresos por Posicion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sortedPositions.map(pos => {
                const share = pos.total / maxTotal
                return (
                  <div key={pos.symbol} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className="font-mono font-bold text-sm"
                          style={{ minWidth: '56px' }}
                        >
                          {pos.symbol}
                        </span>
                        <FormattedAmount value={pos.total} className="text-sm" />
                      </div>
                      <span
                        className="text-xs font-medium"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {pos.count} pago{pos.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(share * 100).toFixed(1)}%`,
                          backgroundColor: 'var(--good)',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
