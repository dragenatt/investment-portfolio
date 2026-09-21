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
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { cn } from '@/lib/utils'
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
} from '@/lib/utils/indicators'
import { ChartFigure } from '@/components/charts/chart-figure'
import { describeChange, formatChartDate, formatChartMoney, formatChartNumber, seriesTable } from '@/lib/utils/chart-accessibility'
import { ChartEmpty } from '@/components/charts/chart-state'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { useCurrency } from '@/lib/hooks/use-currency'

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
  currency,
}: {
  active?: boolean
  payload?: Array<{ value?: number }>
  label?: string
  onHoverRef: React.RefObject<((price: number | null) => void) | null>
  currency?: string | null
}) {
  const price = active && payload?.[0]?.value != null ? payload[0].value : null

  useEffect(() => {
    onHoverRef.current?.(price)
  }, [price, onHoverRef])

  if (!active || !payload || !payload.length) return null
  return (
    <div className="chart-tooltip">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* The same conversion as the price above the chart, which this hover
          also drives: it used to read "$230.12" (dollars) here while the
          header showed the same point in pesos. */}
      {currency ? (
        <FormattedAmount value={payload[0].value} from={currency} className="text-sm font-semibold" />
      ) : (
        <p className="text-sm font-semibold font-financial">{payload[0].value?.toFixed(2)}</p>
      )}
    </div>
  )
}

type IndicatorKey = 'sma20' | 'sma50' | 'ema20' | 'bollinger' | 'rsi'

// The price line is semantic (gain/loss). Indicators are identity, so they take
// the categorical slots in fixed order — the same slot for the same indicator
// whichever ones are switched on, so toggling one never repaints another.
const INDICATOR_CONFIG: Record<IndicatorKey, { label: string; tooltip: string; color: string }> = {
  sma20:     { label: 'SMA 20',     tooltip: 'Media Móvil Simple de 20 periodos',            color: SERIES_PALETTE[0] },
  sma50:     { label: 'SMA 50',     tooltip: 'Media Móvil Simple de 50 periodos',            color: SERIES_PALETTE[1] },
  ema20:     { label: 'EMA 20',     tooltip: 'Media Móvil Exponencial de 20 periodos',       color: SERIES_PALETTE[2] },
  bollinger: { label: 'Bollinger',  tooltip: 'Bandas de Bollinger (20 periodos, 2 desv.)',    color: SERIES_PALETTE[5] },
  rsi:       { label: 'RSI',        tooltip: 'Índice de Fuerza Relativa (14 periodos)',       color: SERIES_PALETTE[6] },
}

type PriceChartProps = {
  symbol: string
  /**
   * The currency the history is quoted in — the quote's. The page's header
   * converts the price into the display currency; with this the chart does the
   * same, so the tooltip, the range change and the header are one figure in one
   * currency. Unknown while the quote loads, and then nothing is labelled.
   */
  currency?: string | null
  onPriceHover?: (price: number | null) => void
}

export function PriceChart({ symbol, currency, onPriceHover }: PriceChartProps) {
  const { convert, currency: displayCurrency } = useCurrency()
  const toDisplay = (value: number) => (currency ? convert(value, currency) : value)
  const moneyLabel = currency ? displayCurrency : ''
  const [range, setRange] = useState('1M')
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set())
  const { data, isLoading, error, mutate } = usePriceHistory(symbol, rangeMap[range])

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

  const hasHistory = chartData.length >= 2
  const showRSI = hasHistory && activeIndicators.has('rsi') && rsiData

  const indicatorColumns = (Object.keys(INDICATOR_CONFIG) as IndicatorKey[])
    .filter((key) => activeIndicators.has(key) && key !== 'bollinger')
  const summary =
    chartData.length >= 2
      ? `Precio de ${symbol} en ${range}: ${describeChange(
          { label: formatChartDate(chartData[0].rawDate), value: firstPrice },
          { label: formatChartDate(chartData[chartData.length - 1].rawDate), value: lastPrice },
          (v) => formatChartMoney(toDisplay(v), moneyLabel),
        )}.${indicatorColumns.length > 0 ? ` Indicadores activos: ${indicatorColumns.map((k) => INDICATOR_CONFIG[k].label).join(', ')}.` : ''}`
      : `Precio de ${symbol}: sin datos para ${range}.`
  const table = seriesTable<{ point: Record<string, unknown>; rsi: number | null }>(
    enrichedData.map((point: Record<string, unknown>, i: number) => ({ point, rsi: indicators.rsi?.[i] ?? null })),
    `Precio de ${symbol} por fecha`,
    ['Fecha', 'Cierre', ...indicatorColumns.map((k) => INDICATOR_CONFIG[k].label)],
    ({ point, rsi }) => [
      formatChartDate(String(point.rawDate)),
      formatChartMoney(toDisplay(Number(point.price)), moneyLabel),
      ...indicatorColumns.map((k) => {
        const value = k === 'rsi' ? rsi : (point[k] as number | null | undefined)
        return value == null ? '—' : formatChartNumber(value)
      }),
    ],
  )

  return (
    <div>
      {/* Range change indicator — only when there is a range to measure. */}
      {hasHistory && (
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className={cn('text-xs font-medium font-financial', isPositive ? 'text-gain' : 'text-loss')}>
          {currency ? (
            <FormattedAmount value={rangeChange} from={currency} showSign />
          ) : (
            <>{rangeChange >= 0 ? '+' : ''}{rangeChange.toFixed(2)}</>
          )}{' '}
          ({rangeChangePct >= 0 ? '+' : ''}{rangeChangePct.toFixed(2)}%) en {range}
        </span>
      </div>
      )}

      {/* Main chart, or why there is none: a failed request is not an empty history. */}
      {error && !data ? (
        <ChartEmpty height={300} kind="error" message={`No se pudo cargar el historial de ${symbol}.`} onRetry={() => mutate()} />
      ) : !hasHistory ? (
        <ChartEmpty height={300} message={`No hay historial de precios de ${symbol} para ${range}.`} />
      ) : (
      <>
      {/* Main chart */}
      <div
        className="w-full"
        style={{ minHeight: 300, height: 300 }}
        onMouseLeave={() => onPriceHover?.(null)}
      >
        <ChartFigure summary={summary} table={table} fill>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart accessibilityLayer={false} data={enrichedData}>
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
                content={<HoverTooltip onHoverRef={onHoverRef} currency={currency} />}
                cursor={theme.crosshair}
              />

              {/* Bollinger Bands — shaded area between upper and lower */}
              {activeIndicators.has('bollinger') && (
                <>
                  <Area
                    type="monotone"
                    dataKey="bbUpper"
                    stroke="none"
                    fill={INDICATOR_CONFIG.bollinger.color}
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
                    fill="var(--card)"
                    fillOpacity={1}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bbUpper"
                    stroke={INDICATOR_CONFIG.bollinger.color}
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
                    stroke={INDICATOR_CONFIG.bollinger.color}
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
                    stroke={INDICATOR_CONFIG.bollinger.color}
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
                activeDot={{ r: 4, fill: color, stroke: 'var(--card)', strokeWidth: 2 }}
              />

              {/* SMA 20 */}
              {activeIndicators.has('sma20') && (
                <Line
                  type="monotone"
                  dataKey="sma20"
                  stroke={INDICATOR_CONFIG.sma20.color}
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
                  stroke={INDICATOR_CONFIG.sma50.color}
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
                  stroke={INDICATOR_CONFIG.ema20.color}
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
        </ChartFigure>
      </div>

      </>
      )}

      {/* RSI sub-chart */}
      {showRSI && (
        <div className="w-full mt-1" style={{ height: 100 }}>
          <ChartFigure
            fill
            summary={`RSI de 14 periodos, entre 0 y 100; por encima de 70 se lee como sobrecompra y por debajo de 30 como sobreventa. Sus valores están en la tabla del precio.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart accessibilityLayer={false} data={rsiData}>
                <XAxis dataKey="date" hide />
                <YAxis
                  domain={[0, 100]}
                  ticks={[30, 50, 70]}
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <ReferenceLine y={70} stroke={theme.colors.negative} strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={30} stroke={theme.colors.positive} strokeDasharray="3 3" strokeOpacity={0.5} />
                <Area
                  type="monotone"
                  dataKey="rsi"
                  stroke={INDICATOR_CONFIG.rsi.color}
                  fill={INDICATOR_CONFIG.rsi.color}
                  fillOpacity={0.08}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFigure>
          <p className="text-[10px] text-muted-foreground text-center -mt-1">RSI (14)</p>
        </div>
      )}

      {/* Timeframe pills */}
      <div className="flex items-center justify-center gap-1 mt-3" role="group" aria-label="Rango de tiempo">
        {Object.keys(rangeMap).map(r => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
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
      <div className="flex items-center justify-center gap-1 mt-2 flex-wrap" role="group" aria-label="Indicadores técnicos">
        {(Object.keys(INDICATOR_CONFIG) as IndicatorKey[]).map(key => {
          const cfg = INDICATOR_CONFIG[key]
          const isActive = activeIndicators.has(key)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
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
