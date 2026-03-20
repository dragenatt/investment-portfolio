'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444']

export function BenchmarkChart({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR(`/api/analytics/${portfolioId}/benchmark?vs=SPY,EWW`, fetcher)

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando benchmarks...</CardContent></Card>
  if (!data || Object.keys(data).length === 0) return null

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
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Legend />
            {benchmarks.map((b, i) => (
              <Line key={b} type="monotone" dataKey={b} stroke={COLORS[i]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
