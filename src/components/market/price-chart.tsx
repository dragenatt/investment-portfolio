'use client'

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePriceHistory } from '@/lib/hooks/use-market'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useState } from 'react'
import { getChartTheme } from '@/lib/utils/chart-config'

const rangeMap: Record<string, string> = {
  '1D': '1d', '5D': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', 'MAX': 'max',
}

export function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState('1M')
  const { data, isLoading } = usePriceHistory(symbol, rangeMap[range])

  if (isLoading) return <SkeletonChart />

  const chartData = (data || []).map((d: { date: string; close: number }) => ({
    date: new Date(d.date).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }),
    price: d.close,
  }))

  const theme = getChartTheme()
  const isPositive = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price
  const color = isPositive ? theme.colors.positive : theme.colors.negative

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Precio</CardTitle>
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="h-8">
            {Object.keys(rangeMap).map(r => (
              <TabsTrigger key={r} value={r} className="text-xs px-2 h-6">{r}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`color-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.1} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" {...theme.xAxis} />
            <YAxis {...theme.yAxis} domain={['auto', 'auto']} />
            <Tooltip />
            <Area type="monotone" dataKey="price" stroke={color} fill={`url(#color-${symbol})`} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
