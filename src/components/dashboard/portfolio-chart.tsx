'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { useState } from 'react'

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

export function PortfolioChart({ data, isLoading, onPeriodChange }: Props) {
  const [period, setPeriod] = useState<string>('1M')

  const handlePeriodChange = (p: string) => {
    setPeriod(p)
    onPeriodChange?.(PERIOD_TO_RANGE[p] || '30')
  }

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Rendimiento</CardTitle>
        <Tabs value={period} onValueChange={handlePeriodChange}>
          <TabsList className="h-8">
            {periods.map(p => (
              <TabsTrigger key={p} value={p} className="text-xs px-2 h-6">{p}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
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
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D97706" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(d: string) => {
                  const date = new Date(d)
                  return `${date.getDate()}/${date.getMonth() + 1}`
                }}
              />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={60} />
              <Tooltip
                labelFormatter={(d) => new Date(String(d)).toLocaleDateString('es-MX')}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Valor']}
              />
              <Area type="monotone" dataKey="value" stroke="#D97706" fill="url(#colorValue)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
