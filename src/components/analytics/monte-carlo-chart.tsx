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
  Legend,
  CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getChartTheme,
  formatAxisTick,
  SERIES_PALETTE,
  LINE_WIDTH,
  ACTIVE_DOT_RADIUS,
  MARK_RING_WIDTH,
} from '@/lib/utils/chart-config'
import { formatCurrency } from '@/lib/utils/currency'
import { Waypoints } from 'lucide-react'
import { ChartFigure } from '@/components/charts/chart-figure'
import { seriesTable } from '@/lib/utils/chart-accessibility'

export type MonteCarloBand = {
  week: number
  p10: number
  p50: number
  p90: number
}

type Props = {
  /** Week 0 is today's value; the rest are the simulated percentiles, in money. */
  bands: MonteCarloBand[]
  currentValue: number
  currency?: string
  var95?: { pct: number; amount: number }
  simulations?: number
  /** Selected horizon. Pass onHorizonChange too to render the picker. */
  horizonWeeks?: number
  onHorizonChange?: (weeks: number) => void
  isLoading?: boolean
}

// P10, P50 and P90 are three statistics of ONE distribution, not three
// entities, so they share a hue and differ by weight and dash. Painting them
// as three identities would invite reading the optimistic band as a separate
// "series" someone could choose.
const CONE_COLOR = SERIES_PALETTE[0]
const MEDIAN_COLOR = SERIES_PALETTE[0]

const HORIZONS = [
  { weeks: 26, label: '6m' },
  { weeks: 52, label: '1a' },
  { weeks: 104, label: '2a' },
]

function CustomTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ payload: MonteCarloBand & { currentValue?: number } }>
  label?: number
  currency: string
}) {
  if (!active || !payload?.length) return null
  const band = payload[0].payload

  return (
    <div className="chart-tooltip space-y-1">
      <p className="text-xs text-muted-foreground">
        {label === 0 ? 'Hoy' : `Semana ${label}`}
      </p>
      <p className="text-[11px] font-financial text-muted-foreground">
        P90 (optimista) <span className="text-foreground">{formatCurrency(band.p90, currency)}</span>
      </p>
      <p className="text-sm font-financial font-semibold text-foreground flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: MEDIAN_COLOR }} />
        P50 {formatCurrency(band.p50, currency)}
      </p>
      <p className="text-[11px] font-financial text-muted-foreground">
        P10 (pesimista) <span className="text-foreground">{formatCurrency(band.p10, currency)}</span>
      </p>
      {typeof band.currentValue === 'number' && band.currentValue > 0 && (
        <p className="text-[11px] font-financial text-muted-foreground border-t pt-1 mt-1">
          Hoy <span className="text-foreground">{formatCurrency(band.currentValue, currency)}</span>
          {' \u00b7 '}
          <span className={band.p50 >= band.currentValue ? 'text-gain' : 'text-loss'}>
            {band.p50 >= band.currentValue ? '+' : ''}
            {(((band.p50 - band.currentValue) / band.currentValue) * 100).toFixed(1)}%
          </span>
        </p>
      )}
    </div>
  )
}

export function MonteCarloChart({
  bands,
  currentValue,
  currency = 'MXN',
  var95,
  simulations,
  horizonWeeks,
  onHorizonChange,
  isLoading,
}: Props) {
  const theme = getChartTheme()
  const gradientId = 'monte-carlo-cone'
  const hasData = bands.length > 0
  const final = hasData ? bands[bands.length - 1] : null

  // Roughly eight labels on the axis, whatever the horizon.
  const tickInterval = Math.max(0, Math.ceil(bands.length / 8) - 1)

  // Recharts draws a band when the dataKey resolves to a [low, high] pair.
  const chartData = bands.map((band) => ({
    ...band,
    cone: [band.p10, band.p90] as [number, number],
    currentValue,
  }))

  // The horizon picker lives in the header, so it stays put while a new
  // horizon loads instead of disappearing with the chart.
  const header = (
    <CardHeader>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium">Proyección Monte Carlo</CardTitle>
          {!isLoading && final && (
            <CardDescription className="text-xs text-muted-foreground">
              {bands.length - 1} semanas
              {simulations ? ` · ${simulations.toLocaleString()} trayectorias` : ''}
              {' · '}
              Escenario medio {formatCurrency(final.p50, currency)}
              {var95 ? ` · VaR 95% ${var95.pct.toFixed(1)}%` : ''}
            </CardDescription>
          )}
        </div>

        {onHorizonChange && (
          <div className="flex gap-1 shrink-0">
            {HORIZONS.map((horizon) => (
              <button
                key={horizon.weeks}
                type="button"
                onClick={() => onHorizonChange(horizon.weeks)}
                aria-pressed={horizonWeeks === horizon.weeks}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  horizonWeeks === horizon.weeks
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {horizon.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </CardHeader>
  )

  if (isLoading) {
    return (
      <Card>
        {header}
        <CardContent>
          <Skeleton className="h-[280px] w-full rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  if (!hasData) {
    return (
      <Card>
        {header}
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

  const summary = final
    ? `Proyección a ${bands.length - 1} semanas${simulations ? ` con ${simulations.toLocaleString('es-MX')} trayectorias simuladas` : ''}. Valor de hoy: ${formatCurrency(currentValue, currency)}. En la última semana, el escenario pesimista (P10) es ${formatCurrency(final.p10, currency)}, la mediana (P50) ${formatCurrency(final.p50, currency)} y el optimista (P90) ${formatCurrency(final.p90, currency)}. Es una simulación, no una predicción.`
    : 'Proyección Monte Carlo.'
  const table = seriesTable(
    bands,
    'Percentiles simulados por semana',
    ['Semana', 'P10 pesimista', 'P50 mediana', 'P90 optimista'],
    (band) => [
      band.week === 0 ? 'Hoy' : `Semana ${band.week}`,
      formatCurrency(band.p10, currency),
      formatCurrency(band.p50, currency),
      formatCurrency(band.p90, currency),
    ],
  )

  return (
    <Card>
      {header}
      <CardContent>
        <ChartFigure summary={summary} table={table}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart accessibilityLayer={false} data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CONE_COLOR} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={CONE_COLOR} stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid {...theme.grid} />
              <XAxis
                dataKey="week"
                {...theme.xAxis}
                interval={tickInterval}
                tickFormatter={(w: number) => (w === 0 ? 'Hoy' : `S${w}`)}
              />
              <YAxis
                {...theme.yAxis}
                width={80}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => formatAxisTick(v, 'currency')}
              />
              {/* Crosshair and tooltip: an HTML chart is interactive by default. */}
              <Tooltip content={<CustomTooltip currency={currency} />} cursor={theme.crosshair} />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="plainline"
                wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
              />
              {/* Where the book stands today, labelled so it is never read as a percentile. */}
              <ReferenceLine
                y={currentValue}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{
                  value: 'Hoy',
                  position: 'insideTopLeft',
                  fontSize: 10,
                  fill: 'var(--muted-foreground)',
                }}
              />
              <Area
                type="monotone"
                dataKey="cone"
                name="Rango P10-P90"
                stroke="none"
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                activeDot={false}
                legendType="rect"
              />
              <Line
                type="monotone"
                dataKey="p90"
                name="P90 optimista"
                stroke={CONE_COLOR}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.85}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="p50"
                name="P50 mediana"
                stroke={MEDIAN_COLOR}
                strokeWidth={LINE_WIDTH}
                dot={false}
                isAnimationActive={false}
                activeDot={{
                  r: ACTIVE_DOT_RADIUS,
                  fill: MEDIAN_COLOR,
                  stroke: 'var(--card)',
                  strokeWidth: MARK_RING_WIDTH,
                }}
              />
              <Line
                type="monotone"
                dataKey="p10"
                name="P10 pesimista"
                stroke={CONE_COLOR}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.85}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El 80% de las trayectorias simuladas termina entre P10 y P90. Es una simulación sobre
          rendimientos pasados, no una predicción: el 20% restante queda fuera del cono, y una
          crisis real no pide permiso a ninguna distribución.
        </p>
      </CardContent>
    </Card>
  )
}
