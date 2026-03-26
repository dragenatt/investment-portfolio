'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PieChartIcon } from 'lucide-react'
import { getChartTheme } from '@/lib/utils/chart-config'

const COLORS = getChartTheme().colors.palette

type AllocationData = { name: string; value: number }

export function AllocationDonut({ data }: { data: AllocationData[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Card
      className="overflow-hidden"
      style={{ borderRadius: '16px', border: '1px solid var(--hair)', background: 'var(--paper)' }}
    >
      <CardHeader className="pb-2">
        <CardTitle
          className="font-extrabold uppercase"
          style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted)' }}
        >
          Distribución
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" style={{ minHeight: 200 }}>
            <div className="p-3 rounded-xl mb-3" style={{ backgroundColor: 'color-mix(in srgb, var(--brand) 10%, transparent)' }}>
              <PieChartIcon className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            </div>
            <p className="text-sm font-medium mb-1">Sin datos</p>
            <p className="text-xs max-w-[200px]" style={{ color: 'var(--muted)' }}>
              Agrega posiciones para ver la distribución de tus activos.
            </p>
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

            {/* Legend rows — bordered style */}
            <div className="mt-3 space-y-0">
              {data.map((item, i) => {
                const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0'
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between px-3 py-2"
                    style={{ borderTop: '1px solid var(--hair)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-sm font-medium">{item.name}</span>
                    </div>
                    <span
                      className="font-mono text-sm"
                      style={{ color: 'var(--muted)' }}
                    >
                      {pct}%
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
