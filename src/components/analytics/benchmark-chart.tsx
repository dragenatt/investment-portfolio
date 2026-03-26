'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import useSWR from 'swr'
import { getChartTheme, formatAxisTick } from '@/lib/utils/chart-config'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function BenchmarkChart({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR(`/api/analytics/${portfolioId}/benchmark?vs=SPY,EWW`, fetcher)

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando benchmarks...</CardContent></Card>
  if (!data || Object.keys(data).length === 0) return null

  const theme = getChartTheme()
  const benchmarks = Object.keys(data)
  const chartData = data[benchmarks[0]]?.map((_: unknown, i: number) => {
    const point: Record<string, unknown> = { date: data[benchmarks[0]][i].date }
    benchmarks.forEach(b => { point[b] = data[b]?.[i]?.value })
    return point
  }) || []

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium">vs Benchmarks (%)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" {...theme.xAxis} />
            <YAxis {...theme.yAxis} tickFormatter={v => formatAxisTick(v, 'percent')} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Legend />
            {benchmarks.map((b, i) => (
              <Line key={b} type="monotone" dataKey={b} stroke={theme.colors.benchmarks[i]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
