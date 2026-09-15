'use client'

import { use, useEffect, useRef, useState } from 'react'
import { FUNNEL_EVENTS } from '@/lib/analytics/events'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { DataGate } from '@/components/shared/data-gate'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ReturnsSummary } from '@/components/analytics/returns-summary'
import { CalendarReturns } from '@/components/analytics/calendar-returns'
import { RiskDashboard } from '@/components/analytics/risk-dashboard'
import { ScenarioComparisonCard } from '@/components/analytics/scenario-comparison'
import { MetricExplanationsCard } from '@/components/analytics/metric-explanations'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useReturns, useRisk, useMonteCarlo, useAttribution, useIncome, useAllocation, useFactors, useOptimization } from '@/lib/hooks/use-analytics'
import { useCurrency } from '@/lib/hooks/use-currency'
import { AllocationDonut, DrawdownChart, AttributionWaterfall, TemporalAttribution, RiskSources, ModelComparison, PortfolioHealth, PortfolioDiagnostic, IncomeDashboard, MonteCarloChart, RollingRiskChart, FactorExposure, EfficientFrontierChart } from '@/components/charts/lazy-charts'

export default function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tab, setTab] = useState('overview')
  const [horizonWeeks, setHorizonWeeks] = useState(52)
  const { currency } = useCurrency()

  const { data: returns, isLoading: returnsLoading, error: returnsError } = useReturns(id)
  const { data: risk, isLoading: riskLoading, error: riskError } = useRisk(id)
  const { data: factors, isLoading: factorsLoading, error: factorsError } = useFactors(id)
  const { data: optimization, isLoading: optimizationLoading, error: optimizationError } = useOptimization(id)
  const { data: monteCarlo, isLoading: monteCarloLoading, error: monteCarloError } = useMonteCarlo(id, horizonWeeks)

  // First Monte Carlo the user actually sees. The once-per-user index in
  // migration 012 does the real deduplication; this ref only avoids re-posting
  // on every render of the same visit.
  const reportedFirstSimulation = useRef(false)
  useEffect(() => {
    if (reportedFirstSimulation.current) return
    if (!monteCarlo?.bands?.length) return
    reportedFirstSimulation.current = true
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: FUNNEL_EVENTS.FIRST_MONTE_CARLO }),
    }).catch(() => {})
  }, [monteCarlo])
  const { data: attribution, isLoading: attrLoading, error: attrError } = useAttribution(id)
  const { data: income, isLoading: incomeLoading, error: incomeError } = useIncome(id)
  const { data: allocation, isLoading: allocLoading, error: allocError } = useAllocation(id)

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
          <TabsTrigger value="factors">Factores</TabsTrigger>
          <TabsTrigger value="income">Ingresos</TabsTrigger>
          <TabsTrigger value="allocation">Asignacion</TabsTrigger>
          <TabsTrigger value="scenarios">Escenarios</TabsTrigger>
          <TabsTrigger value="metrics">Metricas explicadas</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <ErrorBoundary>
            <PortfolioHealth portfolioId={id} />
          </ErrorBoundary>

          <ErrorBoundary>
            <PortfolioDiagnostic portfolioId={id} />
          </ErrorBoundary>

          <DataGate error={returnsError} hasData={!!returns} what="los rendimientos">
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
          </DataGate>

          <DataGate error={riskError} hasData={!!risk} what="el drawdown">
          <ErrorBoundary>
            <DrawdownChart
              dates={risk?.drawdown_series?.dates ?? []}
              values={risk?.drawdown_series?.values ?? []}
              maxDrawdown={risk?.current?.max_drawdown ?? 0}
              maxDrawdownDate={risk?.current?.max_drawdown_date ?? ''}
              isLoading={riskLoading}
            />
          </ErrorBoundary>
          </DataGate>
        </TabsContent>

        {/* Risk Tab */}
        <TabsContent value="risk" className="space-y-6 mt-6">
          {/* The question first (P2-5): where the risk comes from, before how much of it there is. */}
          <ErrorBoundary>
            <RiskSources portfolioId={id} />
          </ErrorBoundary>

          {/* Risk over time comes first: one number for the whole history
              hides whether it is getting worse, which is the real question. */}
          <DataGate error={riskError} hasData={!!risk} what="el análisis de riesgo">
          <ErrorBoundary>
            <RollingRiskChart
              rolling={risk?.rolling_risk ?? null}
              isLoading={riskLoading}
            />
          </ErrorBoundary>

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
          </DataGate>

          <DataGate error={monteCarloError} hasData={!!monteCarlo} what="la simulación Monte Carlo">
          <ErrorBoundary>
            {monteCarlo?.message ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {monteCarlo.message}
                </CardContent>
              </Card>
            ) : (
              <MonteCarloChart
                bands={monteCarlo?.bands ?? []}
                currentValue={monteCarlo?.current_value ?? 0}
                currency={currency}
                var95={monteCarlo?.var_95}
                simulations={monteCarlo?.simulations}
                horizonWeeks={horizonWeeks}
                onHorizonChange={setHorizonWeeks}
                isLoading={monteCarloLoading}
              />
            )}
          </ErrorBoundary>
          </DataGate>
        </TabsContent>

        {/* Attribution Tab */}
        <TabsContent value="attribution" className="space-y-6 mt-6">
          {/* Holding contributions over time (P2-4). Its own loading and error states. */}
          <ErrorBoundary>
            <TemporalAttribution portfolioId={id} />
          </ErrorBoundary>
          <DataGate error={attrError} hasData={!!attribution} what="la atribución">
          <ErrorBoundary>
            <AttributionWaterfall
              sectors={attribution?.sectors ?? []}
              total={attribution?.total ?? { allocation_effect: 0, selection_effect: 0, interaction_effect: 0, total_excess: 0 }}
              isLoading={attrLoading}
            />
          </ErrorBoundary>
          </DataGate>
        </TabsContent>

        {/* Income Tab */}
        <TabsContent value="factors" className="space-y-6 mt-6">
          <DataGate error={factorsError} hasData={!!factors} what="la exposición a factores">
            <ErrorBoundary>
              <FactorExposure data={factors} isLoading={factorsLoading} />
            </ErrorBoundary>
          </DataGate>
          <DataGate error={optimizationError} hasData={!!optimization} what="la frontera eficiente">
            <ErrorBoundary>
              <EfficientFrontierChart data={optimization} isLoading={optimizationLoading} />
            </ErrorBoundary>
          </DataGate>
          <DataGate error={optimizationError} hasData={!!optimization} what="la comparación de modelos">
            <ErrorBoundary>
              <ModelComparison data={optimization?.model_comparison} isLoading={optimizationLoading} />
            </ErrorBoundary>
          </DataGate>
        </TabsContent>

        <TabsContent value="income" className="space-y-6 mt-6">
          <DataGate error={incomeError} hasData={!!income} what="los ingresos">
          <ErrorBoundary>
            <IncomeDashboard
              totals={income?.totals ?? { mtd: 0, ytd: 0, all_time: 0, portfolio_yield: 0 }}
              byPosition={income?.by_position ?? []}
              monthlyHistory={income?.monthly_history ?? []}
              isLoading={incomeLoading}
            />
          </ErrorBoundary>
          </DataGate>
        </TabsContent>

        {/* Allocation Tab */}
        <TabsContent value="allocation" className="space-y-6 mt-6">
          <DataGate error={allocError} hasData={!!allocation} what="la asignación">
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
                          <span className="text-xs text-muted-foreground w-12 text-right font-financial">{s.pct.toFixed(1)}%</span>
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
                        <span className="text-xs text-muted-foreground w-12 text-right font-financial">{s.pct.toFixed(1)}%</span>
                        {s.stale && (
                          <span className="text-xs text-warn" title="Precio desactualizado">*<span className="sr-only"> (precio desactualizado)</span></span>
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
          </DataGate>
        </TabsContent>

        {/* Scenarios Tab (E2) */}
        <TabsContent value="scenarios" className="space-y-6 mt-6">
          <ErrorBoundary>
            <ScenarioComparisonCard pid={id} />
          </ErrorBoundary>
        </TabsContent>

        {/* Metrics explained (E3) */}
        <TabsContent value="metrics" className="space-y-6 mt-6">
          <ErrorBoundary>
            <MetricExplanationsCard pid={id} />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  )
}
