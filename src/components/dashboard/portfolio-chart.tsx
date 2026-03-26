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
    <div
      className="rounded-lg backdrop-blur-sm px-3 py-2 shadow-lg"
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
    >
      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {new Date(String(label)).toLocaleDateString('es-MX', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      <p
        className="font-bold font-mono"
        style={{ fontFamily: 'var(--font-serif)', fontSize: '14px', letterSpacing: '-0.02em' }}
      >
        ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
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
  const { isPositive, startValue, lastPoint } = useMemo(() => {
    if (!data || data.length < 2) return { isPositive: true, startValue: 0, lastPoint: null }
    const first = data[0].value
    const last = data[data.length - 1].value
    return { isPositive: last >= first, startValue: first, lastPoint: data[data.length - 1] }
  }, [data])

  const lineColor = isPositive ? 'var(--good, #10b981)' : 'var(--bad, #ef4444)'
  const lineColorHex = isPositive ? '#10b981' : '#ef4444'
  const gradientId = 'heroChartGradient'
  const glowId = 'chartLineGlow'

  return (
    <div className="space-y-3 premium-card p-4">
      {/* Chart area — clean sparkline look */}
      {isLoading ? (
        <div className="h-[250px] flex items-center justify-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Cargando datos...
        </div>
      ) : data.length === 0 ? (
        <div className="h-[250px] flex items-center justify-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Agrega transacciones para ver el rendimiento
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColorHex} stopOpacity={0.20} />
                <stop offset="100%" stopColor={lineColorHex} stopOpacity={0} />
              </linearGradient>
              <filter id={glowId}>
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={lineColorHex} floodOpacity="0.4" />
              </filter>
            </defs>
            <XAxis
              dataKey="date"
              {...theme.xAxis}
              hide
            />
            <YAxis {...theme.yAxis} hide />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: 'var(--muted-foreground)',
                strokeWidth: 1,
                strokeDasharray: '4 4',
              }}
            />
            {startValue > 0 && (
              <ReferenceLine y={startValue} stroke="var(--border)" strokeDasharray="3 3" />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={lineColorHex}
              fill={`url(#${gradientId})`}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: lineColorHex, stroke: 'var(--paper, #fff)', strokeWidth: 2 }}
              style={{ filter: `url(#${glowId})` }}
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
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={
              period === p
                ? {
                    backgroundColor: isPositive
                      ? 'color-mix(in srgb, var(--good) 15%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 15%, transparent)',
                    color: isPositive ? 'var(--good)' : 'var(--bad)',
                  }
                : {
                    color: 'var(--muted-foreground)',
                  }
            }
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
