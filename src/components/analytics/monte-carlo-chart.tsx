'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getChartTheme, formatAxisTick } from '@/lib/utils/chart-config'
import { formatCurrency } from '@/lib/utils/currency'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { Waypoints } from 'lucide-react'

export type MonteCarloBand = {
  week: number
  p10: number
  p50: number
  p90: number
}

type Props = {
  /** Week 0 is today's value; weeks 1..52 are the simulated percentiles, in money. */
  bands: MonteCarloBand[]
  currentValue: number
  currency?: string
  var95?: { pct: number; amount: number }
  simulations?: number
  isLoading?: boolean
}

const CONE_COLOR = '#D97706'
const MEDIAN_COLOR = '#B45309'

function CustomTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ payload: MonteCarloBand }>
  label?: number
  currency: string
}) {
  if (!active || !payload?.length) return null
  const band = payload[0].payload

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md space-y-1">
      <p className="text-xs text-muted-foreground">
        {label === 0 ? 'Hoy' : `Semana ${label}`}
      </p>
      <p className="text-sm font-mono font-semibold" style={{ color: MEDIAN_COLOR }}>
        {formatCurrency(band.p50, currency)}
      </p>
      <p className="text-[11px] font-mono text-muted-foreground">
        P90 {formatCurrency(band.p90, currency)}
      </p>
      <p className="text-[11px] font-mono text-muted-foreground">
        P10 {formatCurrency(band.p10, currency)}
      </p>
    </div>
  )
}

export function MonteCarloChart({
  bands,
  currentValue,
  currency = 'MXN',
  var95,
  simulations,
  isLoading,
}: Props) {
  if (isLoading) return <SkeletonChart />

  if (!bands.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Proyección Monte Carlo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="p-3 rounded-2xl bg-muted/50 mb-3">
            <Waypoints className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            No hay historial suficiente para simular
          </p>
        </CardContent>
      </Card>
    )
  }

  const theme = getChartTheme()
  const gradientId = 'monte-carlo-cone'

  // Recharts draws a band when the dataKey resolves to a [low, high] pair.
  const chartData = bands.map((band) => ({
    ...band,
    cone: [band.p10, band.p90] as [number, number],
  }))

  const final = bands[bands.length - 1]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Proyección Monte Carlo</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {bands.length - 1} semanas
          {simulations ? ` · ${simulations.toLocaleString()} simulaciones` : ''}
          {' · '}
          Escenario medio {formatCurrency(final.p50, currency)}
          {var95 ? ` · VaR 95% ${var95.pct.toFixed(1)}%` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CONE_COLOR} stopOpacity={0.32} />
                <stop offset="100%" stopColor={CONE_COLOR} stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="week"
              {...theme.xAxis}
              interval={7}
              tickFormatter={(w: number) => (w === 0 ? 'Hoy' : `S${w}`)}
            />
            <YAxis
              {...theme.yAxis}
              width={80}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => formatAxisTick(v, 'currency')}
            />
            <Tooltip content={<CustomTooltip currency={currency} />} />
            <ReferenceLine
              y={currentValue}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="cone"
              stroke="none"
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="p50"
              stroke={MEDIAN_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: MEDIAN_COLOR, strokeWidth: 0 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
