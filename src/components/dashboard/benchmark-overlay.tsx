'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getChartTheme, formatAxisTick } from '@/lib/utils/chart-config'

type Props = {
  timeline: Array<{ date: string; value: number; normalized: number }>
  benchmark: { dates: string[]; values: number[] }
  benchmarkSymbol: string
  isLoading?: boolean
}

type MergedPoint = {
  date: string
  portfolio: number | null
  benchmark: number | null
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null

  const portfolioEntry = payload.find((p) => p.dataKey === 'portfolio')
  const benchmarkEntry = payload.find((p) => p.dataKey === 'benchmark')
  const portfolioVal = portfolioEntry?.value ?? null
  const benchmarkVal = benchmarkEntry?.value ?? null
  const diff =
    portfolioVal != null && benchmarkVal != null
      ? portfolioVal - benchmarkVal
      : null

  return (
    <div
      className="rounded-lg backdrop-blur-sm px-3 py-2 shadow-lg"
      style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
    >
      <p className="text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>
        {new Date(String(label)).toLocaleDateString('es-MX', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      {portfolioVal != null && (
        <p className="text-sm font-mono" style={{ color: portfolioEntry?.color }}>
          Mi Portfolio: {portfolioVal.toFixed(2)}
        </p>
      )}
      {benchmarkVal != null && (
        <p className="text-sm font-mono" style={{ color: benchmarkEntry?.color }}>
          SPY: {benchmarkVal.toFixed(2)}
        </p>
      )}
      {diff != null && (
        <p
          className="text-sm font-mono font-semibold mt-1 pt-1"
          style={{
            borderTop: '1px solid var(--border)',
            color: diff >= 0 ? 'var(--good, #10b981)' : 'var(--bad, #ef4444)',
          }}
        >
          Diferencia: {diff >= 0 ? '+' : ''}
          {diff.toFixed(2)}
        </p>
      )}
    </div>
  )
}

export function BenchmarkOverlay({
  timeline,
  benchmark,
  benchmarkSymbol,
  isLoading,
}: Props) {
  const theme = getChartTheme()

  const mergedData = useMemo<MergedPoint[]>(() => {
    if (!timeline.length && !benchmark.dates.length) return []

    // Build a map of benchmark values by date
    const benchmarkMap = new Map<string, number>()
    benchmark.dates.forEach((d, i) => {
      benchmarkMap.set(d, benchmark.values[i])
    })

    // Build a map of portfolio normalized values by date
    const portfolioMap = new Map<string, number>()
    timeline.forEach((t) => {
      portfolioMap.set(t.date, t.normalized)
    })

    // Collect all unique dates and sort
    const allDates = new Set<string>([
      ...timeline.map((t) => t.date),
      ...benchmark.dates,
    ])
    const sortedDates = Array.from(allDates).sort()

    return sortedDates.map((date) => ({
      date,
      portfolio: portfolioMap.get(date) ?? null,
      benchmark: benchmarkMap.get(date) ?? null,
    }))
  }, [timeline, benchmark])

  const hasData = mergedData.length > 0

  return (
    <Card className="overflow-hidden premium-card">
      <CardHeader className="pb-2">
        <CardTitle
          className="font-extrabold uppercase"
          style={{
            fontSize: '12px',
            letterSpacing: '.08em',
            color: 'var(--muted-foreground)',
          }}
        >
          Portfolio vs Benchmark
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" style={{ minHeight: 280 }}>
            <Skeleton className="h-[250px] w-full rounded-lg" />
            <div className="flex justify-center gap-6">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
          </div>
        ) : !hasData ? (
          <div
            className="flex flex-col items-center justify-center py-10 text-center"
            style={{ minHeight: 280 }}
          >
            <p
              className="text-sm"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Acumulando datos — el chart mejora cada dia
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={mergedData}
              margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                {...theme.xAxis}
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString('es-MX', {
                    month: 'short',
                    day: 'numeric',
                  })
                }
              />
              <YAxis
                {...theme.yAxis}
                tickFormatter={(v: number) => formatAxisTick(v, 'number')}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: 'var(--muted-foreground)',
                  strokeWidth: 1,
                  strokeDasharray: '4 4',
                }}
              />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs">
                    {value === 'portfolio' ? 'Mi Portfolio' : benchmarkSymbol}
                  </span>
                )}
              />
              <ReferenceLine
                y={100}
                stroke="var(--border)"
                strokeDasharray="3 3"
                label={{
                  value: '100',
                  position: 'insideTopLeft',
                  fill: 'var(--muted-foreground)',
                  fontSize: 10,
                }}
              />
              <Line
                type="monotone"
                dataKey="portfolio"
                name="Mi Portfolio"
                stroke={theme.colors.primary}
                strokeWidth={2.5}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: theme.colors.primary,
                  stroke: 'var(--paper, #fff)',
                  strokeWidth: 2,
                }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                name={benchmarkSymbol}
                stroke={theme.colors.benchmarks[0]}
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{
                  r: 3,
                  fill: theme.colors.benchmarks[0],
                  stroke: 'var(--paper, #fff)',
                  strokeWidth: 2,
                }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
