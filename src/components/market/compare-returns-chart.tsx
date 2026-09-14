'use client'

// The symbol comparison chart, moved out of /market/compare unchanged so it can
// load on demand (C3): recharts no longer sits in that page's first-load bundle.

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { getChartTheme } from '@/lib/utils/chart-config'

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
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium">{entry.dataKey}</span>
          <span className="font-mono ml-auto">
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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>
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
  )
}
