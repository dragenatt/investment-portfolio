'use client'

import { use, useState } from 'react'
import { AllocationDonut } from '@/components/dashboard/allocation-donut'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ReturnsSummary } from '@/components/analytics/returns-summary'
import { CalendarReturns } from '@/components/analytics/calendar-returns'
import { DrawdownChart } from '@/components/analytics/drawdown-chart'
import { RiskDashboard } from '@/components/analytics/risk-dashboard'
import { AttributionWaterfall } from '@/components/analytics/attribution-waterfall'
import { IncomeDashboard } from '@/components/analytics/income-dashboard'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useReturns, useRisk, useAttribution, useIncome, useAllocation } from '@/lib/hooks/use-analytics'

export default function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tab, setTab] = useState('overview')

  const { data: returns, isLoading: returnsLoading } = useReturns(id)
  const { data: risk, isLoading: riskLoading } = useRisk(id)
  const { data: attribution, isLoading: attrLoading } = useAttribution(id)
  const { data: income, isLoading: incomeLoading } = useIncome(id)
  const { data: allocation, isLoading: allocLoading } = useAllocation(id)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1
          className="font-bold tracking-tight font-serif"
          style={{ fontSize: 'clamp(24px, 3vw, 36px)', letterSpacing: '-0.03em' }}
        >
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground font-semibold">
          Analisis detallado de rendimiento, riesgo y atribucion
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-2xl grid-cols-5">
          <TabsTrigger value="overview">General</TabsTrigger>
          <TabsTrigger value="risk">Riesgo</TabsTrigger>
          <TabsTrigger value="attribution">Atribucion</TabsTrigger>
          <TabsTrigger value="income">Ingresos</TabsTrigger>
          <TabsTrigger value="allocation">Asignacion</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <ErrorBoundary>
            <ReturnsSummary
              simple={returns?.summary?.simple ?? 0}
              twr={returns?.summary?.twr ?? 0}
              mwr={returns?.summary?.mwr ?? 0}
              period={returns?.summary?.period ?? ''}
              isLoading={returnsLoading}
            />
          </ErrorBoundary>

          <ErrorBoundary>
            <CalendarReturns
              data={returns?.calendar ?? []}
              isLoading={returnsLoading}
            />
          </ErrorBoundary>

          <ErrorBoundary>
            <DrawdownChart
              dates={risk?.drawdown_series?.dates ?? []}
              values={risk?.drawdown_series?.values ?? []}
              maxDrawdown={risk?.current?.max_drawdown ?? 0}
              maxDrawdownDate={risk?.current?.max_drawdown_date ?? ''}
              isLoading={riskLoading}
            />
          </ErrorBoundary>
        </TabsContent>

        {/* Risk Tab */}
        <TabsContent value="risk" className="space-y-6 mt-6">
          <ErrorBoundary>
            {riskLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : risk?.message ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {risk.message}
                </CardContent>
              </Card>
            ) : risk?.current ? (
              <RiskDashboard
                riskScore={risk.current.risk_score}
                sharpeRatio={risk.current.sharpe_ratio}
                sortinoRatio={risk.current.sortino_ratio}
                maxDrawdown={risk.current.max_drawdown}
                maxDrawdownDate={risk.current.max_drawdown_date}
                volatility={risk.current.volatility}
                beta={risk.current.beta}
                alpha={risk.current.alpha}
                calmarRatio={risk.current.calmar_ratio}
                var95={risk.current.var_95}
                trackingError={risk.current.tracking_error}
                informationRatio={risk.current.information_ratio}
              />
            ) : null}
          </ErrorBoundary>

          <ErrorBoundary>
            <DrawdownChart
              dates={risk?.drawdown_series?.dates ?? []}
              values={risk?.drawdown_series?.values ?? []}
              maxDrawdown={risk?.current?.max_drawdown ?? 0}
              maxDrawdownDate={risk?.current?.max_drawdown_date ?? ''}
              isLoading={riskLoading}
            />
          </ErrorBoundary>
        </TabsContent>

        {/* Attribution Tab */}
        <TabsContent value="attribution" className="space-y-6 mt-6">
          <ErrorBoundary>
            <AttributionWaterfall
              sectors={attribution?.sectors ?? []}
              total={attribution?.total ?? { allocation_effect: 0, selection_effect: 0, interaction_effect: 0, total_excess: 0 }}
              isLoading={attrLoading}
            />
          </ErrorBoundary>
        </TabsContent>

        {/* Income Tab */}
        <TabsContent value="income" className="space-y-6 mt-6">
          <ErrorBoundary>
            <IncomeDashboard
              totals={income?.totals ?? { mtd: 0, ytd: 0, all_time: 0, portfolio_yield: 0 }}
              byPosition={income?.by_position ?? []}
              monthlyHistory={income?.monthly_history ?? []}
              isLoading={incomeLoading}
            />
          </ErrorBoundary>
        </TabsContent>

        {/* Allocation Tab */}
        <TabsContent value="allocation" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ErrorBoundary>
              {allocLoading ? <SkeletonChart /> : (
                <AllocationDonut data={allocation?.byType ?? []} />
              )}
            </ErrorBoundary>

            <ErrorBoundary>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Por Sector</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {allocation?.bySector?.map((s: { sector: string; pct: number }) => (
                      <div key={s.sector} className="flex items-center justify-between">
                        <span className="text-sm">{s.sector}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${s.pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">{s.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                    {(!allocation?.bySector || allocation.bySector.length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-4">Sin datos de sector disponibles</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Por Activo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {allocation?.bySymbol?.map((s: { symbol: string; pct: number; stale: boolean }) => (
                    <div key={s.symbol} className="flex items-center justify-between">
                      <span className="font-mono text-sm">{s.symbol}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(s.pct, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right">{s.pct.toFixed(1)}%</span>
                        {s.stale && (
                          <span className="text-xs text-amber-500" title="Precio desactualizado">*</span>
                        )}
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
