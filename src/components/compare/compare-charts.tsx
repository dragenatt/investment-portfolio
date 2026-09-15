'use client'

// The comparison page's two charts, moved out of the page unchanged so they can
// load on demand (C3): recharts no longer sits in /compare's first-load bundle.

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'
import { ChartFigure } from '@/components/charts/chart-figure'
import { formatChartDate, formatChartNumber, seriesTable } from '@/lib/utils/chart-accessibility'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { getChartTheme } from '@/lib/utils/chart-config'

type ComparedPortfolio = { portfolioId: string; portfolioName: string }

export function CompareHistoryChart({
  chartData,
  history,
  colors,
}: {
  chartData: Array<Record<string, unknown>>
  history: ComparedPortfolio[]
  colors: readonly string[]
}) {
  const CHART_COLORS = colors
  const theme = getChartTheme()
  const names = history.map((h) => h.portfolioName)
  const last = chartData[chartData.length - 1]
  const summary =
    chartData.length > 0
      ? `Evolución de ${names.join(', ')} de ${formatChartDate(String(chartData[0].date))} a ${formatChartDate(String(last.date))}. Último valor: ${history
          .map((h, idx) => {
            const value = last[`portfolio_${idx}`]
            return `${h.portfolioName} ${typeof value === 'number' ? formatChartNumber(value) : 'n/d'}`
          })
          .join(', ')}.`
      : 'Evolución de los portafolios comparados.'
  const table = seriesTable(chartData, 'Valor de cada portafolio por fecha', ['Fecha', ...names], (row) => [
    formatChartDate(String(row.date)),
    ...history.map((_, idx) => {
      const value = row[`portfolio_${idx}`]
      return typeof value === 'number' ? formatChartNumber(value) : '—'
    }),
  ])
  return (
    <ChartFigure summary={summary} table={table} fill>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart accessibilityLayer={false} data={chartData}>
          <defs>
            {history.map((_, idx) => (
              <linearGradient key={idx} id={`gradient_${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[idx]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={CHART_COLORS[idx]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid {...theme.grid} />
          <XAxis
            dataKey="date"
            {...theme.xAxis}
            tickFormatter={(d) => new Date(d).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            style={{ fontSize: '11px' }}
            domain={['dataMin - 5', 'dataMax + 5']}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                labelFormatter={(d) => formatChartDate(String(d))}
                nameFormatter={(name) => history[parseInt(name.replace('portfolio_', ''))]?.portfolioName ?? name}
                valueFormatter={(value) => (typeof value === 'number' ? formatChartNumber(value) : '—')}
              />
            }
          />
          <Legend
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => {
              const idx = parseInt(String(value).replace('portfolio_', ''))
              return history[idx]?.portfolioName || value
            }}
          />
          {history.map((_, idx) => (
            <Area
              key={idx}
              type="monotone"
              dataKey={`portfolio_${idx}`}
              stroke={CHART_COLORS[idx]}
              fill={`url(#gradient_${idx})`}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFigure>
  )
}

export function CompareRadarChart({
  radarData,
  history,
  colors,
}: {
  radarData: Array<Record<string, unknown>>
  history: ComparedPortfolio[]
  colors: readonly string[]
}) {
  const CHART_COLORS = colors
  const theme = getChartTheme()
  const metrics = radarData.map((row) => String(row.metric))
  const radarSummary = `Comparación de ${history.map((h) => h.portfolioName).join(', ')} en ${metrics.length} métricas puntuadas de 0 a 100: ${metrics.join(', ')}.`
  const radarTable = {
    caption: 'Puntuación de 0 a 100 por métrica',
    columns: ['Métrica', ...history.map((h) => h.portfolioName)],
    rows: radarData.map((row) => [
      String(row.metric),
      ...history.map((_, idx) => {
        const value = row[`portfolio_${idx}`]
        return typeof value === 'number' ? formatChartNumber(value, 0) : '—'
      }),
    ]),
  }
  return (
    <ChartFigure summary={radarSummary} table={radarTable} fill>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart accessibilityLayer={false} data={radarData}>
          <PolarGrid stroke={theme.grid.stroke} />
          <PolarAngleAxis dataKey="metric" tick={theme.xAxis.tick} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ ...theme.yAxis.tick, fontSize: 10 }} stroke={theme.grid.stroke} />
          {history.map((h, idx) => (
            <Radar
              key={h.portfolioId}
              name={h.portfolioName}
              dataKey={`portfolio_${idx}`}
              stroke={CHART_COLORS[idx]}
              fill={CHART_COLORS[idx]}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))}
          <Legend
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => {
              const idx = parseInt(String(value).replace('portfolio_', ''))
              return history[idx]?.portfolioName || value
            }}
          />
          <Tooltip content={<ChartTooltipContent valueFormatter={(value) => (typeof value === 'number' ? formatChartNumber(value, 0) : '—')} />} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartFigure>
  )
}
