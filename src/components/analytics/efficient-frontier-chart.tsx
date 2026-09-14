'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import {
  getChartTheme,
  SERIES_PALETTE,
  LINE_WIDTH,
  MARK_RING_WIDTH,
} from '@/lib/utils/chart-config'
import { Spline } from 'lucide-react'
import type { OptimizationData, FrontierPoint } from '@/lib/hooks/use-analytics'
import { ChartFigure } from '@/components/charts/chart-figure'

/**
 * The risk/return trade-off, with the book's own position marked on it.
 *
 * This is a SCATTER form: any two marks can end up side by side, so it obeys the
 * three-colour all-pairs cap rather than the eight-slot adjacent one. There are
 * exactly three marks — the frontier line, the best risk-adjusted mix, and where
 * the book actually sits — and that is not a coincidence, it is the cap.
 *
 * The caveat below the chart is not decoration. Markowitz is exact mathematics
 * on an input nobody can estimate well, and a curve this clean invites being
 * read as an instruction.
 */

type Props = {
  data?: OptimizationData
  isLoading?: boolean
}

type Mark = { volatilityPct: number; expectedReturnPct: number; label: string; kind: string }

function FrontierTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: (FrontierPoint & { label?: string; kind?: string }) | Mark }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as FrontierPoint & { label?: string }

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md space-y-1 max-w-60">
      {point.label && <p className="text-xs font-medium text-foreground">{point.label}</p>}
      <p className="text-sm font-mono text-foreground">
        {point.expectedReturnPct.toFixed(1)}% esperado
      </p>
      <p className="text-[11px] font-mono text-muted-foreground">
        {point.volatilityPct.toFixed(1)}% volatilidad
        {point.sharpe != null ? ` · Sharpe ${point.sharpe.toFixed(2)}` : ''}
      </p>
      {point.weights && (
        <p className="text-[11px] text-muted-foreground leading-relaxed border-t pt-1 mt-1">
          {point.weights
            .filter((w) => w.weight > 0.005)
            .sort((a, b) => b.weight - a.weight)
            .map((w) => `${w.symbol} ${(w.weight * 100).toFixed(0)}%`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

export function EfficientFrontierChart({ data, isLoading }: Props) {
  const theme = getChartTheme()
  const frontier = data?.efficient_frontier

  const header = (
    <CardHeader>
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        <Spline className="h-4 w-4" />
        Frontera eficiente
      </CardTitle>
      {data?.observations && (
        <CardDescription className="text-xs">
          {data.observations} dias ({data.from_date} a {data.to_date}) ·{' '}
          {data.symbols?.length ?? 0} posiciones
        </CardDescription>
      )}
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

  if (!frontier) {
    return (
      <Card>
        {header}
        <CardContent className="flex flex-col items-center justify-center py-10">
          <div className="p-3 rounded-2xl bg-muted/50 mb-3">
            <Spline className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {data?.message ?? 'Hacen falta al menos dos posiciones con historial comun para trazar una frontera.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const curve = frontier.points.map((point) => ({ ...point, label: 'Frontera' }))

  const maxSharpe: Mark[] = [
    {
      volatilityPct: frontier.maxSharpe.volatilityPct,
      expectedReturnPct: frontier.maxSharpe.expectedReturnPct,
      label: 'Mejor riesgo/rendimiento',
      kind: 'maxSharpe',
    },
  ]

  const current: Mark[] = frontier.current
    ? [
        {
          volatilityPct: frontier.current.volatilityPct,
          expectedReturnPct: frontier.current.expectedReturnPct,
          label: 'Tu cartera hoy',
          kind: 'current',
        },
      ]
    : []

  const point = (m: { volatilityPct: number; expectedReturnPct: number }) =>
    `${m.expectedReturnPct.toFixed(1)}% de rendimiento esperado con ${m.volatilityPct.toFixed(1)}% de volatilidad`
  const summary = `Frontera eficiente de ${curve.length} combinaciones. Mejor relación riesgo/rendimiento: ${point(
    frontier.maxSharpe,
  )}.${frontier.current ? ` Tu cartera hoy: ${point(frontier.current)}.` : ''}`
  const table = {
    caption: 'Puntos de la frontera eficiente',
    columns: ['Combinación', 'Volatilidad', 'Rendimiento esperado', 'Sharpe'],
    rows: [
      ...maxSharpe.map((m) => [m.label, `${m.volatilityPct.toFixed(1)}%`, `${m.expectedReturnPct.toFixed(1)}%`, '']),
      ...current.map((m) => [m.label, `${m.volatilityPct.toFixed(1)}%`, `${m.expectedReturnPct.toFixed(1)}%`, '']),
      ...curve.map((c, i) => [
        `Frontera ${i + 1}`,
        `${c.volatilityPct.toFixed(1)}%`,
        `${c.expectedReturnPct.toFixed(1)}%`,
        c.sharpe != null ? c.sharpe.toFixed(2) : '',
      ]),
    ],
  }

  return (
    <Card>
      {header}
      <CardContent className="space-y-3">
        <ChartFigure summary={summary} table={table}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart accessibilityLayer={false} data={curve} margin={{ top: 8, right: 16 }}>
              <CartesianGrid {...theme.grid} />
              <XAxis
                type="number"
                dataKey="volatilityPct"
                {...theme.xAxis}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                label={{
                  value: 'Riesgo (volatilidad anual)',
                  position: 'insideBottom',
                  offset: -4,
                  fontSize: 10,
                  fill: 'var(--muted-foreground)',
                }}
              />
              <YAxis
                type="number"
                dataKey="expectedReturnPct"
                {...theme.yAxis}
                width={52}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip content={<FrontierTooltip />} cursor={theme.crosshair} />
              <Legend
                verticalAlign="top"
                height={28}
                wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
              />

              <Line
                type="monotone"
                dataKey="expectedReturnPct"
                name="Frontera eficiente"
                stroke={SERIES_PALETTE[0]}
                strokeWidth={LINE_WIDTH}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
                legendType="plainline"
              />
              <Scatter
                data={maxSharpe}
                name="Mejor riesgo/rendimiento"
                dataKey="expectedReturnPct"
                fill={SERIES_PALETTE[1]}
                stroke="var(--card)"
                strokeWidth={MARK_RING_WIDTH}
                shape="diamond"
                isAnimationActive={false}
              />
              {current.length > 0 && (
                <Scatter
                  data={current}
                  name="Tu cartera hoy"
                  dataKey="expectedReturnPct"
                  fill={SERIES_PALETTE[2]}
                  stroke="var(--card)"
                  strokeWidth={MARK_RING_WIDTH}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>

        {frontier.improvement && (
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {frontier.improvement.summary}
            </p>
          </div>
        )}

        {/* Not decoration. The expected-return vector is the weakest input in
            finance and this curve is exquisitely sensitive to it. */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">{frontier.caveat}</p>
      </CardContent>
    </Card>
  )
}
