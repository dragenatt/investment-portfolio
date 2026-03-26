'use client'

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { usePriceHistory } from '@/lib/hooks/use-market'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useState, useEffect, useRef, useMemo } from 'react'
import { getChartTheme } from '@/lib/utils/chart-config'
import { cn } from '@/lib/utils'
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
} from '@/lib/utils/indicators'

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

type IndicatorKey = 'sma20' | 'sma50' | 'ema20' | 'bollinger' | 'rsi'

const INDICATOR_CONFIG: Record<IndicatorKey, { label: string; tooltip: string; color: string }> = {
  sma20:     { label: 'SMA 20',     tooltip: 'Media Móvil Simple de 20 periodos',            color: '#3b82f6' },
  sma50:     { label: 'SMA 50',     tooltip: 'Media Móvil Simple de 50 periodos',            color: '#f59e0b' },
  ema20:     { label: 'EMA 20',     tooltip: 'Media Móvil Exponencial de 20 periodos',       color: '#8b5cf6' },
  bollinger: { label: 'Bollinger',  tooltip: 'Bandas de Bollinger (20 periodos, 2 desv.)',    color: '#93c5fd' },
  rsi:       { label: 'RSI',        tooltip: 'Índice de Fuerza Relativa (14 periodos)',       color: '#6366f1' },
}

type PriceChartProps = {
  symbol: string
  onPriceHover?: (price: number | null) => void
}

export function PriceChart({ symbol, onPriceHover }: PriceChartProps) {
  const [range, setRange] = useState('1M')
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set())
  const { data, isLoading } = usePriceHistory(symbol, rangeMap[range])

  // Store callback in a ref so the tooltip can call it without re-renders
  const onHoverRef = useRef<((price: number | null) => void) | null>(onPriceHover ?? null)
  useEffect(() => {
    onHoverRef.current = onPriceHover ?? null
  }, [onPriceHover])

  const toggleIndicator = (key: IndicatorKey) => {
    setActiveIndicators(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Base chart data
  const chartData = useMemo(() => {
    return (data || []).map((d: { date: string; close: number }) => ({
      date: formatDateForRange(d.date, range),
      rawDate: d.date,
      price: d.close,
    }))
  }, [data, range])

  // Prices array for indicator calculations
  const prices = useMemo(() => chartData.map((d: { price: number }) => d.price), [chartData])

  // Indicator calculations — only compute when active
  const indicators = useMemo(() => {
    const result: Record<string, (number | null)[]> = {}

    if (activeIndicators.has('sma20')) {
      result.sma20 = calculateSMA(prices, 20)
    }
    if (activeIndicators.has('sma50')) {
      result.sma50 = calculateSMA(prices, 50)
    }
    if (activeIndicators.has('ema20')) {
      result.ema20 = calculateEMA(prices, 20)
    }
    if (activeIndicators.has('bollinger')) {
      const bb = calculateBollingerBands(prices, 20, 2)
      result.bbUpper = bb.upper
      result.bbMiddle = bb.middle
      result.bbLower = bb.lower
    }
    if (activeIndicators.has('rsi')) {
      result.rsi = calculateRSI(prices, 14)
    }

    return result
  }, [prices, activeIndicators])

  // Merge indicators into chart data
  const enrichedData = useMemo(() => {
    return chartData.map((point: { date: string; rawDate: string; price: number }, i: number) => {
      const enriched: Record<string, unknown> = { ...point }
      for (const [key, values] of Object.entries(indicators)) {
        if (key === 'rsi') continue // RSI uses separate chart
        enriched[key] = values[i]
      }
      return enriched
    })
  }, [chartData, indicators])

  // RSI data for the sub-chart
  const rsiData = useMemo(() => {
    if (!indicators.rsi) return null
    return chartData.map((point: { date: string }, i: number) => ({
      date: point.date,
      rsi: indicators.rsi[i],
    }))
  }, [chartData, indicators.rsi])

  if (isLoading) return <SkeletonChart />

  const theme = getChartTheme()
  const isPositive = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price
  const color = isPositive ? theme.colors.positive : theme.colors.negative

  const firstPrice = chartData[0]?.price ?? 0
  const lastPrice = chartData[chartData.length - 1]?.price ?? 0
  const rangeChange = lastPrice - firstPrice
  const rangeChangePct = firstPrice > 0 ? (rangeChange / firstPrice) * 100 : 0

  const showRSI = activeIndicators.has('rsi') && rsiData

  return (
    <div>
      {/* Range change indicator */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className={cn('text-xs font-medium font-mono', isPositive ? 'text-gain' : 'text-loss')}>
          {rangeChange >= 0 ? '+' : ''}{rangeChange.toFixed(2)} ({rangeChangePct >= 0 ? '+' : ''}{rangeChangePct.toFixed(2)}%) en {range}
        </span>
      </div>

      {/* Main chart */}
      <div
        className="w-full"
        style={{ height: 300 }}
        onMouseLeave={() => onPriceHover?.(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={enrichedData}>
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

            {/* Bollinger Bands — shaded area between upper and lower */}
            {activeIndicators.has('bollinger') && (
              <>
                <Area
                  type="monotone"
                  dataKey="bbUpper"
                  stroke="none"
                  fill="#93c5fd"
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Area
                  type="monotone"
                  dataKey="bbLower"
                  stroke="none"
                  fill="hsl(var(--background))"
                  fillOpacity={1}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbUpper"
                  stroke="#93c5fd"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbLower"
                  stroke="#93c5fd"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbMiddle"
                  stroke="#93c5fd"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                  strokeDasharray="2 2"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </>
            )}

            {/* Main price area */}
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              fill={`url(#color-${symbol}-${range})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            />

            {/* SMA 20 */}
            {activeIndicators.has('sma20') && (
              <Line
                type="monotone"
                dataKey="sma20"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {/* SMA 50 */}
            {activeIndicators.has('sma50') && (
              <Line
                type="monotone"
                dataKey="sma50"
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {/* EMA 20 */}
            {activeIndicators.has('ema20') && (
              <Line
                type="monotone"
                dataKey="ema20"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI sub-chart */}
      {showRSI && (
        <div className="w-full mt-1" style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rsiData}>
              <XAxis dataKey="date" hide />
              <YAxis
                domain={[0, 100]}
                ticks={[30, 50, 70]}
                tick={{ fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={30}
              />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
              <ReferenceLine y={30} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.5} />
              <Area
                type="monotone"
                dataKey="rsi"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.08}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground text-center -mt-1">RSI (14)</p>
        </div>
      )}

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

      {/* Indicator toggle pills */}
      <div className="flex items-center justify-center gap-1 mt-2 flex-wrap">
        {(Object.keys(INDICATOR_CONFIG) as IndicatorKey[]).map(key => {
          const cfg = INDICATOR_CONFIG[key]
          const isActive = activeIndicators.has(key)
          return (
            <button
              key={key}
              onClick={() => toggleIndicator(key)}
              title={cfg.tooltip}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                isActive
                  ? 'border-current'
                  : 'border-transparent text-muted-foreground hover:bg-muted'
              )}
              style={isActive ? { color: cfg.color, backgroundColor: `${cfg.color}15` } : undefined}
            >
              {cfg.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
