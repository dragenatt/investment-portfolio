'use client'

import { use } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export default function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: allocation, isLoading: allocLoading } = useSWR(`/api/analytics/${id}/allocation`, fetcher)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary>
          {allocLoading ? <SkeletonChart /> : (
            <AllocationDonut data={allocation?.byType || []} />
          )}
        </ErrorBoundary>

        <ErrorBoundary>
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Por Activo</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {allocation?.bySymbol?.map((s: { symbol: string; pct: number }) => (
                  <div key={s.symbol} className="flex items-center justify-between">
                    <span className="font-mono text-sm">{s.symbol}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${s.pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{s.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
                {(!allocation?.bySymbol || allocation.bySymbol.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Agrega posiciones para ver el analisis</p>
                )}
              </div>
            </CardContent>
          </Card>
        </ErrorBoundary>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Metricas de Riesgo</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Las metricas de riesgo (volatilidad, Sharpe ratio, max drawdown) estaran disponibles cuando haya suficiente historial de precios.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
