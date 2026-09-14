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

type ComparedPortfolio = { portfolioId: string; portfolioName: string }

export function CompareHistoryChart({
  chartData,
  history,
  colors,
}: {
  chartData: Array<Record<string, unknown>>
  history: ComparedPortfolio[]
  colors: string[]
}) {
  const CHART_COLORS = colors
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData}>
        <defs>
          {history.map((_, idx) => (
            <linearGradient key={idx} id={`gradient_${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS[idx]} stopOpacity={0.2} />
              <stop offset="95%" stopColor={CHART_COLORS[idx]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          stroke="var(--muted-foreground)"
          style={{ fontSize: '11px' }}
          tickFormatter={(d) => new Date(d).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        />
        <YAxis
          stroke="var(--muted-foreground)"
          style={{ fontSize: '11px' }}
          domain={['dataMin - 5', 'dataMax + 5']}
        />
        <Tooltip
          contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', fontSize: '12px' }}
          labelFormatter={(d) => new Date(d as string).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => {
            const idx = parseInt(String(name).replace('portfolio_', ''))
            const label = history[idx]?.portfolioName || name
            return [typeof value === 'number' ? `${value.toFixed(2)}` : value, label]
          }}
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
  )
}

export function CompareRadarChart({
  radarData,
  history,
  colors,
}: {
  radarData: Array<Record<string, unknown>>
  history: ComparedPortfolio[]
  colors: string[]
}) {
  const CHART_COLORS = colors
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={radarData}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        />
        <PolarRadiusAxis
          angle={30}
          domain={[0, 100]}
          tick={{ fontSize: 10 }}
          stroke="var(--border)"
        />
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
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  )
}
