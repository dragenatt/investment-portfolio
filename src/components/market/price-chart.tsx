'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { usePriceHistory } from '@/lib/hooks/use-market'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useState, useEffect, useRef } from 'react'
import { getChartTheme } from '@/lib/utils/chart-config'
import { cn } from '@/lib/utils'

const rangeMap: Record<string, string> = {
  '1D': '1d', '1S': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1A': '1y', '5A': 'max',
}

function formatDateForRange(dateStr: string, range: string): string {
  const date = new Date(dateStr)
  if (range === '1D') {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }
  if (range === '1S') {
    return date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
  }
  if (range === '1M' || range === '3M') {
    return date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })
}

/** Tooltip that also reports hover price to the parent via a ref-based callback */
function HoverTooltip({
  active,
  payload,
  label,
  onHoverRef,
}: {
  active?: boolean
  payload?: Array<{ value?: number }>
  label?: string
  onHoverRef: React.RefObject<((price: number | null) => void) | null>
}) {
  const price = active && payload?.[0]?.value != null ? payload[0].value : null

  useEffect(() => {
    onHoverRef.current?.(price)
  }, [price, onHoverRef])

  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold font-mono">${payload[0].value?.toFixed(2)}</p>
    </div>
  )
}

type PriceChartProps = {
  symbol: string
  onPriceHover?: (price: number | null) => void
}

export function PriceChart({ symbol, onPriceHover }: PriceChartProps) {
  const [range, setRange] = useState('1M')
  const { data, isLoading } = usePriceHistory(symbol, rangeMap[range])

  // Store callback in a ref so the tooltip can call it without re-renders
  const onHoverRef = useRef<((price: number | null) => void) | null>(onPriceHover ?? null)
  useEffect(() => {
    onHoverRef.current = onPriceHover ?? null
  }, [onPriceHover])

  if (isLoading) return <SkeletonChart />

  const chartData = (data || []).map((d: { date: string; close: number }) => ({
    date: formatDateForRange(d.date, range),
    rawDate: d.date,
    price: d.close,
  }))

  const theme = getChartTheme()
  const isPositive = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price
  const color = isPositive ? theme.colors.positive : theme.colors.negative

  const firstPrice = chartData[0]?.price ?? 0
  const lastPrice = chartData[chartData.length - 1]?.price ?? 0
  const rangeChange = lastPrice - firstPrice
  const rangeChangePct = firstPrice > 0 ? (rangeChange / firstPrice) * 100 : 0

  return (
    <div>
      {/* Range change indicator */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className={cn('text-xs font-medium font-mono', isPositive ? 'text-gain' : 'text-loss')}>
          {rangeChange >= 0 ? '+' : ''}{rangeChange.toFixed(2)} ({rangeChangePct >= 0 ? '+' : ''}{rangeChangePct.toFixed(2)}%) en {range}
        </span>
      </div>

      {/* Chart */}
      <div
        className="w-full"
        style={{ height: 300 }}
        onMouseLeave={() => onPriceHover?.(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`color-${symbol}-${range}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              {...theme.xAxis}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              {...theme.yAxis}
              domain={['auto', 'auto']}
              hide
            />
            <Tooltip
              content={<HoverTooltip onHoverRef={onHoverRef} />}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              fill={`url(#color-${symbol}-${range})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Timeframe pills */}
      <div className="flex items-center justify-center gap-1 mt-3">
        {Object.keys(rangeMap).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              r === range
                ? isPositive
                  ? 'bg-gain/10 text-gain'
                  : 'bg-loss/10 text-loss'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}
