'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/utils/numbers'

type CalendarYear = {
  year: number
  months: (number | null)[] // 12 entries, null = no data
  total: number
}

type Props = {
  data: CalendarYear[]
  isLoading?: boolean
}

const MONTH_HEADERS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const

function getCellStyle(value: number | null): React.CSSProperties {
  if (value == null) return { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }
  const intensity = Math.min(Math.abs(value) / 10, 1)
  const alpha = 0.1 + intensity * 0.4
  if (value >= 0) return {
    backgroundColor: `color-mix(in srgb, var(--good) ${Math.round(alpha * 100)}%, transparent)`,
    color: value > 3 ? 'white' : 'var(--good)',
  }
  return {
    backgroundColor: `color-mix(in srgb, var(--bad) ${Math.round(alpha * 100)}%, transparent)`,
    color: value < -3 ? 'white' : 'var(--bad)',
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[3rem_repeat(12,1fr)_1fr] gap-1">
        <div />
        {MONTH_HEADERS.map((m, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
        <Skeleton className="h-5 w-full" />
      </div>
      {Array.from({ length: 4 }).map((_, row) => (
        <div key={row} className="grid grid-cols-[3rem_repeat(12,1fr)_1fr] gap-1">
          <Skeleton className="h-7 w-full" />
          {Array.from({ length: 13 }).map((_, col) => (
            <Skeleton key={col} className="h-7 w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CalendarReturns({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Rendimientos Mensuales</CardTitle></CardHeader>
        <CardContent><LoadingSkeleton /></CardContent>
      </Card>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Rendimientos Mensuales</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          Sin datos suficientes para el heatmap
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium">Rendimientos Mensuales</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-muted-foreground font-medium w-12">Ano</th>
                {MONTH_HEADERS.map((m, i) => (
                  <th key={i} className="p-1.5 text-center text-muted-foreground font-medium">{m}</th>
                ))}
                <th className="p-1.5 text-center text-muted-foreground font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.year}>
                  <td className="p-1.5 font-medium text-muted-foreground">{row.year}</td>
                  {row.months.map((value, i) => (
                    <td
                      key={i}
                      className="p-1.5 text-center rounded-sm"
                      style={getCellStyle(value)}
                    >
                      {value != null ? formatNumber(value, 1) : '--'}
                    </td>
                  ))}
                  <td
                    className="p-1.5 text-center font-bold rounded-sm"
                    style={getCellStyle(row.total)}
                  >
                    {formatNumber(row.total, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
