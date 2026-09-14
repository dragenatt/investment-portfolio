'use client'

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import { getChartTheme, seriesColor, LINE_WIDTH, CHART_INK } from '@/lib/utils/chart-config'
import { formatByUnit } from '@/lib/utils/lab-format'
import type { ChartSpec } from '@/lib/services/lab'
import { ChartFigure } from '@/components/charts/chart-figure'
import { seriesTable } from '@/lib/utils/chart-accessibility'

/**
 * Draws any lab experiment from the chart description its result carries.
 *
 * One component for twelve experiments: the engine says what the axes are and
 * what unit each series is in, so this never has to know which lesson it is
 * showing — and a new experiment gets a chart without touching the page.
 */
export function ExperimentChart({
  chart,
  series,
}: {
  chart: ChartSpec
  series: Array<Record<string, number>>
}) {
  const theme = getChartTheme()

  if (series.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">
        Sin datos que graficar con estos parametros.
      </div>
    )
  }

  // Every series on one chart shares a y unit in practice; the first one's
  // unit labels the axis.
  const yUnit = chart.series[0]?.unit ?? 'number'
  const categorical = Boolean(chart.xCategories)
  const xTick = (value: number) =>
    categorical
      ? (chart.xCategories![series.findIndex((row) => row[chart.x] === value)] ?? String(value))
      : formatByUnit(value, chart.xUnit, 2)

  const unitOf = (key: string) => chart.series.find((s) => s.key === key)?.unit ?? yUnit
  const labelOf = (key: string) => chart.series.find((s) => s.key === key)?.label ?? key

  const common = (
    <>
      <CartesianGrid {...theme.grid} />
      <XAxis
        dataKey={chart.x}
        {...theme.xAxis}
        type={categorical || chart.kind === 'bar' ? 'category' : 'number'}
        domain={categorical || chart.kind === 'bar' ? undefined : ['dataMin', 'dataMax']}
        tickFormatter={xTick}
        minTickGap={16}
        label={{
          value: chart.xLabel,
          position: 'insideBottom',
          offset: -2,
          fontSize: 11,
          fill: CHART_INK.axis,
        }}
        height={40}
      />
      <YAxis
        {...theme.yAxis}
        width={yUnit === 'money' ? 84 : 56}
        domain={['auto', 'auto']}
        tickFormatter={(value: number) => formatByUnit(value, yUnit, yUnit === 'money' ? 0 : 1)}
      />
      <Tooltip
        cursor={chart.kind === 'line' ? theme.crosshair : { fill: 'var(--muted)', opacity: 0.4 }}
        contentStyle={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 11,
        }}
        labelFormatter={(value) =>
          typeof value === 'number' ? `${chart.xLabel}: ${xTick(value)}` : String(value)
        }
        formatter={(value, name) => [
          typeof value === 'number' ? formatByUnit(value, unitOf(String(name)), 2) : String(value),
          labelOf(String(name)),
        ]}
      />
      <Legend
        verticalAlign="top"
        height={28}
        formatter={(name) => labelOf(String(name))}
        wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
      />
      {chart.referenceY && (
        <ReferenceLine
          y={chart.referenceY.value}
          stroke={CHART_INK.axis}
          strokeDasharray="4 4"
          label={{
            value: chart.referenceY.label,
            position: 'insideTopRight',
            fontSize: 10,
            fill: CHART_INK.axis,
          }}
        />
      )}
    </>
  )

  const xText = (row: Record<string, number>, index: number) =>
    categorical ? (chart.xCategories![index] ?? String(row[chart.x])) : formatByUnit(row[chart.x], chart.xUnit, 2)
  const first = series[0]
  const last = series[series.length - 1]
  const summary = `${chart.kind === 'bar' ? 'Barras' : 'Líneas'} de ${chart.series.map((s) => s.label).join(', ')} según ${chart.xLabel}, de ${xText(
    first,
    0,
  )} a ${xText(last, series.length - 1)}. Al final: ${chart.series
    .map((s) => `${s.label} ${formatByUnit(last[s.key], s.unit, 2)}`)
    .join(', ')}.${chart.referenceY ? ` Línea de referencia: ${chart.referenceY.label}.` : ''}`
  const table = seriesTable(
    series.map((row, index) => ({ row, index })),
    `Datos del experimento: ${chart.series.map((s) => s.label).join(', ')}`,
    [chart.xLabel, ...chart.series.map((s) => s.label)],
    ({ row, index }) => [xText(row, index), ...chart.series.map((s) => formatByUnit(row[s.key], s.unit, 2))],
  )

  return (
    <ChartFigure summary={summary} table={table}>
      <ResponsiveContainer width="100%" height={280}>
        {chart.kind === 'bar' ? (
          <BarChart accessibilityLayer={false} data={series} margin={{ top: 4, right: 12, bottom: 8, left: 0 }}>
            {common}
            {chart.series.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={seriesColor(index) ?? CHART_INK.axis}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart accessibilityLayer={false} data={series} margin={{ top: 4, right: 12, bottom: 8, left: 0 }}>
            {common}
            {chart.series.map((s, index) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={seriesColor(index) ?? CHART_INK.axis}
                strokeWidth={LINE_WIDTH}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </ChartFigure>
  )
}
