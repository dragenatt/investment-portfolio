'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import {
  getChartTheme,
  SERIES_PALETTE,
  LINE_WIDTH,
  ACTIVE_DOT_RADIUS,
  MARK_RING_WIDTH,
} from '@/lib/utils/chart-config'
import { Activity } from 'lucide-react'
import type { RiskData } from '@/lib/hooks/use-analytics'
import { ChartFigure } from '@/components/charts/chart-figure'
import { formatChartDate, seriesTable } from '@/lib/utils/chart-accessibility'

/**
 * Risk over time, rather than one number for the whole history.
 *
 * A single volatility figure answers "how bumpy has this been on average",
 * which is almost never the question. The question is whether it is getting
 * worse, and only a moving window can answer that.
 *
 * Volatility, Sharpe and correlation are three different measures on three
 * different scales, so they are three CHARTS (one selected at a time), never
 * two y-axes on one plot. A dual-axis chart lets the author choose where the
 * lines cross, which is a way of asserting a relationship the data may not have.
 */

type Metric = 'volatility' | 'sharpe' | 'correlation'

const METRICS: Array<{
  id: Metric
  label: string
  key: 'volatility_pct' | 'sharpe' | 'correlation'
  suffix: string
  digits: number
  description: string
}> = [
  {
    id: 'volatility',
    label: 'Volatilidad',
    key: 'volatility_pct',
    suffix: '%',
    digits: 1,
    description: 'Cuanto se mueve tu cartera, anualizado. Subiendo = periodo mas agitado.',
  },
  {
    id: 'sharpe',
    label: 'Sharpe',
    key: 'sharpe',
    suffix: '',
    digits: 2,
    description: 'Rendimiento por unidad de riesgo. Negativo = rindes menos que la tasa libre de riesgo.',
  },
  {
    id: 'correlation',
    label: 'Correlacion',
    key: 'correlation',
    suffix: '',
    digits: 2,
    description: 'Que tanto te mueves con el índice. Cerca de 1 = prácticamente lo replicas.',
  },
]

type Props = {
  rolling: RiskData['rolling_risk']
  isLoading?: boolean
}

type Row = { date: string; value: number | null }

function RollingTooltip({
  active,
  payload,
  label,
  suffix,
  digits,
}: {
  active?: boolean
  payload?: Array<{ payload: Row }>
  label?: string
  suffix: string
  digits: number
}) {
  if (!active || !payload?.length) return null
  const value = payload[0].payload.value
  return (
    <div className="chart-tooltip">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-financial font-semibold text-foreground">
        {value === null ? 'n/d' : `${value.toFixed(digits)}${suffix}`}
      </p>
    </div>
  )
}

export function RollingRiskChart({ rolling, isLoading }: Props) {
  const [metric, setMetric] = useState<Metric>('volatility')
  const theme = getChartTheme()
  const spec = METRICS.find((m) => m.id === metric)!

  const header = (
    <CardHeader>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Riesgo en el tiempo
          </CardTitle>
          {rolling && (
            <CardDescription className="text-xs">
              Ventana movil de {rolling.window_label} · {rolling.observations_used} puntos
              {rolling.benchmark_symbol ? ` · vs ${rolling.benchmark_symbol}` : ''}
            </CardDescription>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {METRICS.map((option) => {
            // Correlation only exists when a benchmark lined up with the book.
            const disabled =
              option.id === 'correlation' && !rolling?.points.some((p) => p.correlation !== null)
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => setMetric(option.id)}
                aria-pressed={metric === option.id}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  metric === option.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </CardHeader>
  )

  if (isLoading) {
    return (
      <Card>
        {header}
        <CardContent>
          <SkeletonChart />
        </CardContent>
      </Card>
    )
  }

  if (!rolling || rolling.points.length === 0) {
    return (
      <Card>
        {header}
        <CardContent className="flex flex-col items-center justify-center py-10">
          <div className="p-3 rounded-2xl bg-muted/50 mb-3">
            <Activity className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Hacen falta al menos unos meses de historial para medir el riesgo con una ventana movil.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Warmup points carry null and are dropped rather than plotted as zero. A
  // window that has not filled has no value, and a zero would read as "calm".
  const rows: Row[] = rolling.points
    .map((point) => ({ date: point.date, value: point[spec.key] }))
    .filter((row) => row.value !== null)

  const showZeroLine = metric !== 'volatility'

  const fmt = (v: number | null) => (v === null ? 'n/d' : `${v.toFixed(spec.digits)}${spec.suffix}`)
  const values = rows.map((row) => row.value as number)
  const summary =
    rows.length > 0
      ? `${spec.label} con ventana móvil de ${rolling.window_label}, de ${formatChartDate(rows[0].date)} a ${formatChartDate(
          rows[rows.length - 1].date,
        )}: último valor ${fmt(values[values.length - 1])}, mínimo ${fmt(Math.min(...values))}, máximo ${fmt(Math.max(...values))}.${
          metric === 'volatility' && rolling.stress_periods.length > 0
            ? ` ${rolling.stress_periods.length} periodos de estrés, listados debajo.`
            : ''
        }`
      : `${spec.label}: sin valores todavía.`
  const table = seriesTable(rows, `${spec.label} por fecha`, ['Fecha', spec.label], (row) => [
    formatChartDate(row.date),
    fmt(row.value),
  ])

  return (
    <Card>
      {header}
      <CardContent className="space-y-3">
        <ChartFigure summary={summary} table={table}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart accessibilityLayer={false} data={rows}>
              <defs>
                <linearGradient id="rolling-risk-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_PALETTE[0]} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={SERIES_PALETTE[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...theme.grid} />
              <XAxis
                dataKey="date"
                {...theme.xAxis}
                minTickGap={40}
                tickFormatter={(d: string) => d.slice(2, 7)}
              />
              <YAxis
                {...theme.yAxis}
                width={52}
                domain={showZeroLine ? ['auto', 'auto'] : [0, 'auto']}
                tickFormatter={(v: number) => `${v.toFixed(spec.digits === 2 ? 1 : 0)}${spec.suffix}`}
              />
              <Tooltip
                content={<RollingTooltip suffix={spec.suffix} digits={spec.digits} />}
                cursor={theme.crosshair}
              />

              {/* Stretches where this book's own volatility ran far above its own
                  normal. Descriptive only: it says the past was turbulent, never
                  that the next stretch will be. */}
              {metric === 'volatility' &&
                rolling.stress_periods.map((period) => (
                  <ReferenceArea
                    key={period.fromDate}
                    x1={period.fromDate}
                    x2={period.toDate}
                    fill="var(--warn)"
                    fillOpacity={0.1}
                    stroke="var(--warn)"
                    strokeOpacity={0.35}
                    strokeDasharray="3 3"
                  />
                ))}

              <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill="url(#rolling-risk-fill)"
                isAnimationActive={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={SERIES_PALETTE[0]}
                strokeWidth={LINE_WIDTH}
                dot={false}
                isAnimationActive={false}
                activeDot={{
                  r: ACTIVE_DOT_RADIUS,
                  fill: SERIES_PALETTE[0],
                  stroke: 'var(--card)',
                  strokeWidth: MARK_RING_WIDTH,
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>

        <p className="text-[11px] text-muted-foreground">{spec.description}</p>

        {metric === 'volatility' && rolling.stress_periods.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-muted/40 p-3">
            <p className="text-xs font-medium text-foreground">
              Periodos de estres detectados ({rolling.stress_periods.length})
            </p>
            {rolling.stress_periods.map((period) => (
              <p key={period.fromDate} className="text-[11px] text-muted-foreground leading-relaxed">
                {period.label}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
