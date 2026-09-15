'use client'

// The symbol comparison chart, moved out of /market/compare unchanged so it can
// load on demand (C3): recharts no longer sits in that page's first-load bundle.

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { getChartTheme } from '@/lib/utils/chart-config'
import { ChartFigure } from '@/components/charts/chart-figure'
import { formatChartPercent, seriesTable } from '@/lib/utils/chart-accessibility'

function CompareTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="chart-tooltip">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium">{entry.dataKey}</span>
          <span className="font-financial ml-auto">
            {entry.value >= 0 ? '+' : ''}
            {entry.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export function CompareReturnsChart({
  chartData,
  symbols,
  colors,
}: {
  chartData: Array<Record<string, unknown>>
  symbols: string[]
  colors: readonly string[]
}) {
  const theme = getChartTheme()
  const COLORS = colors
  const last = chartData[chartData.length - 1]
  const summary =
    chartData.length > 0
      ? `Rendimiento acumulado de ${symbols.join(', ')} desde ${String(chartData[0].date)}. Al ${String(last.date)}: ${symbols
          .map((sym) => `${sym} ${typeof last[sym] === 'number' ? formatChartPercent(last[sym] as number) : 'n/d'}`)
          .join(', ')}.`
      : 'Rendimiento acumulado de los símbolos comparados.'
  const table = seriesTable(chartData, 'Rendimiento acumulado por fecha', ['Fecha', ...symbols], (row) => [
    String(row.date),
    ...symbols.map((sym) => (typeof row[sym] === 'number' ? formatChartPercent(row[sym] as number) : '—')),
  ])
  return (
    <ChartFigure summary={summary} table={table} fill>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer={false} data={chartData}>
          <XAxis
            dataKey="date"
            {...theme.xAxis}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            {...theme.yAxis}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            content={<CompareTooltip />}
            cursor={{
              stroke: 'var(--muted-foreground)',
              strokeWidth: 1,
              strokeDasharray: '4 4',
            }}
          />
          {symbols.map((sym, i) => (
            <Line
              key={sym}
              type="monotone"
              dataKey={sym}
              stroke={COLORS[i]}
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: COLORS[i],
                stroke: 'var(--card)',
                strokeWidth: 2,
              }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFigure>
  )
}
