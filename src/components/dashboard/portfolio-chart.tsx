'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { useState, useMemo } from 'react'
import { getChartTheme } from '@/lib/utils/chart-config'

type DataPoint = { date: string; value: number }

const periods = ['1D', '1W', '1M', '3M', '1Y', 'MAX'] as const

const PERIOD_TO_RANGE: Record<string, string> = {
  '1D': '1',
  '1W': '7',
  '1M': '30',
  '3M': '90',
  '1Y': '365',
  'MAX': 'max',
}

type Props = {
  data: DataPoint[]
  isLoading?: boolean
  onPeriodChange?: (range: string) => void
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const value = payload[0].value
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">
        {new Date(String(label)).toLocaleDateString('es-MX', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      <p className="text-sm font-bold font-mono">${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
    </div>
  )
}

export function PortfolioChart({ data, isLoading, onPeriodChange }: Props) {
  const [period, setPeriod] = useState<string>('1M')
  const theme = getChartTheme()

  const handlePeriodChange = (p: string) => {
    setPeriod(p)
    onPeriodChange?.(PERIOD_TO_RANGE[p] || '30')
  }

  // Determine if performance is positive or negative
  const { isPositive, startValue } = useMemo(() => {
    if (!data || data.length < 2) return { isPositive: true, startValue: 0 }
    const first = data[0].value
    const last = data[data.length - 1].value
    return { isPositive: last >= first, startValue: first }
  }, [data])

  const lineColor = isPositive ? '#10b981' : '#ef4444'
  const gradientId = 'heroChartGradient'

  return (
    <div className="space-y-3">
      {/* Chart area — no card wrapper, integrated with hero */}
      {isLoading ? (
        <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
          Cargando datos...
        </div>
      ) : data.length === 0 ? (
        <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
          Agrega transacciones para ver el rendimiento
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={lineColor} stopOpacity={0.15} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              {...theme.xAxis}
              tickFormatter={(d: string) => {
                const date = new Date(d)
                return `${date.getDate()}/${date.getMonth() + 1}`
              }}
            />
            <YAxis {...theme.yAxis} hide />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: 'hsl(var(--muted-foreground))',
                strokeWidth: 1,
                strokeDasharray: '4 4',
              }}
            />
            {startValue > 0 && (
              <ReferenceLine y={startValue} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              fill={`url(#${gradientId})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: lineColor, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Timeframe toggle pills */}
      <div className="flex items-center justify-center gap-1">
        {periods.map(p => (
          <button
            key={p}
            onClick={() => handlePeriodChange(p)}
            className={`
              px-3 py-1.5 text-xs font-medium rounded-full transition-colors
              ${period === p
                ? `${isPositive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }
            `}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
