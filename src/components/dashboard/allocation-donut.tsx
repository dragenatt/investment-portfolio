'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PieChartIcon } from 'lucide-react'
import { getChartTheme } from '@/lib/utils/chart-config'

const COLORS = getChartTheme().colors.palette

type AllocationData = { name: string; value: number }

export function AllocationDonut({ data }: { data: AllocationData[] }) {
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Distribucion</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" style={{ minHeight: 200 }}>
            <div className="p-3 rounded-xl bg-primary/10 mb-3">
              <PieChartIcon className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium mb-1">Sin datos</p>
            <p className="text-xs text-muted-foreground max-w-[200px]">Agrega posiciones para ver la distribucion de tus activos.</p>
          </div>
        ) : (
        <>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {data.map((item, i) => (
            <div key={item.name} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
          ))}
        </div>
        </>
        )}
      </CardContent>
    </Card>
  )
}
