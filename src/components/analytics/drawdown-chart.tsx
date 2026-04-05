'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceDot,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardDescription } from '@/components/ui/card'
import { getChartTheme, formatAxisTick } from '@/lib/utils/chart-config'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { TrendingDown } from 'lucide-react'

type Props = {
  dates: string[]
  values: number[]
  maxDrawdown: number
  maxDrawdownDate: string
  isLoading?: boolean
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-mono font-semibold text-[#ef4444]">
        {payload[0].value.toFixed(2)}%
      </p>
    </div>
  )
}

export function DrawdownChart({
  dates,
  values,
  maxDrawdown,
  maxDrawdownDate,
  isLoading,
}: Props) {
  if (isLoading) return <SkeletonChart />

  if (!dates.length || !values.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Drawdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="p-3 rounded-2xl bg-muted/50 mb-3">
            <TrendingDown className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            No hay datos de drawdown disponibles
          </p>
        </CardContent>
      </Card>
    )
  }

  const theme = getChartTheme()

  const chartData = dates.map((date, i) => ({
    date,
    drawdown: values[i],
  }))

  const maxDrawdownIndex = dates.indexOf(maxDrawdownDate)
  const gradientId = 'drawdown-gradient'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Drawdown</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Max: {maxDrawdown.toFixed(2)}% ({maxDrawdownDate})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" {...theme.xAxis} />
            <YAxis
              {...theme.yAxis}
              tickFormatter={(v) => formatAxisTick(v, 'percent')}
              domain={['dataMin', 0]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: '#ef4444', strokeWidth: 0 }}
            />
            {maxDrawdownIndex >= 0 && (
              <ReferenceDot
                x={maxDrawdownDate}
                y={maxDrawdown}
                r={5}
                fill="#ef4444"
                stroke="var(--card)"
                strokeWidth={2}
                label={{
                  value: `${maxDrawdown.toFixed(1)}%`,
                  position: 'top',
                  className: 'text-[10px] font-mono fill-[#ef4444]',
                  offset: 10,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
