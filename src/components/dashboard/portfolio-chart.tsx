'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { useState, useMemo } from 'react'
import { getChartTheme } from '@/lib/utils/chart-config'
import { ChartFigure } from '@/components/charts/chart-figure'
import { describeChange, formatChartMoment, formatChartMoney, isIntradaySeries, seriesTable } from '@/lib/utils/chart-accessibility'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'

type DataPoint = { date: string; value: number }

const periods = ['1D', '1W', '1M', '3M', '1Y', 'MAX'] as const

const PERIOD_NAMES: Record<string, string> = {
  '1D': '1 día',
  '1W': '1 semana',
  '1M': '1 mes',
  '3M': '3 meses',
  '1Y': '1 año',
  'MAX': 'todo el historial',
}

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

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  const value = payload[0].value
  const moment = String(label)
  return (
    <div className="chart-tooltip">
      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {/* An intraday point is an instant; a daily one is a date. Reading every
            point of a single session as "mar, 15 sep 2026" hid which one it was. */}
        {moment.includes('T')
          ? formatChartMoment(moment)
          : new Date(moment).toLocaleDateString('es-MX', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })}
      </p>
      <p
        className="font-bold font-financial"
        style={{ fontSize: '14px' }}
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

  // 1D and 1W come back as instants within the session; the rest as closes.
  const intraday = isIntradaySeries(data)
  const summary =
    data.length >= 2
      ? `Valor del portafolio, ${PERIOD_NAMES[period] ?? period}${intraday ? ' (precios durante la sesión)' : ''}: ${describeChange(
          { label: formatChartMoment(data[0].date), value: data[0].value },
          { label: formatChartMoment(data[data.length - 1].date), value: data[data.length - 1].value },
          (v) => formatChartMoney(v, ''),
          { percent: false },
        )}. Incluye aportaciones y retiros, no solo rendimiento.`
      : 'Valor del portafolio.'
  const table = seriesTable(
    data,
    intraday ? 'Valor del portafolio por momento' : 'Valor del portafolio por fecha',
    [intraday ? 'Momento' : 'Fecha', 'Valor'],
    (point) => [formatChartMoment(point.date), formatChartMoney(point.value, '')],
  )

  const lineColor = isPositive ? 'var(--good)' : 'var(--bad)'
  const gradientId = 'heroChartGradient'
  const glowId = 'chartLineGlow'

  return (
    <div className="space-y-3 premium-card p-4">
      {/* Chart area — clean sparkline look */}
      {isLoading ? (
        <ChartLoading height={250} label="Cargando la evolución del portafolio…" />
      ) : data.length === 0 ? (
        <ChartEmpty height={250} message="Agrega transacciones para ver el rendimiento" />
      ) : (
        <ChartFigure summary={summary} table={table}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart accessibilityLayer={false} data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.20} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
                <filter id={glowId}>
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={lineColor} floodOpacity="0.4" />
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
                stroke={lineColor}
                fill={`url(#${gradientId})`}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: lineColor, stroke: 'var(--card)', strokeWidth: 2 }}
                style={{ filter: `url(#${glowId})` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFigure>
      )}

      {/* Timeframe toggle pills */}
      <div className="flex items-center justify-center gap-1" role="group" aria-label="Periodo de la gráfica">
        {periods.map(p => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            aria-label={PERIOD_NAMES[p]}
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
