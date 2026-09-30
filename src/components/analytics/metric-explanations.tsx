'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useRisk, useReturns } from '@/lib/hooks/use-analytics'
import { cn } from '@/lib/utils'
import {
  explainMetric,
  type MetricContext,
  type MetricExplanation,
  type MetricId,
} from '@/lib/services/metric-explanations'
import { Sigma, User } from 'lucide-react'

/**
 * E3 — every important metric with its definition, formula, a worked example,
 * the user's own result and what that result means.
 *
 * The user's number and its reading are marked "Tu resultado"; the definition,
 * formula and example are marked as explanation. Same separation as D3 and the
 * lab: the explanation is true of the metric, the result is true of this book
 * over this window, and blending them makes the second read like the first.
 *
 * One category at a time, and each card shows only the metric and the reader's
 * number until they open the rest: fifteen cards with every definition, formula
 * and reading on screen at once were more text than anyone reads.
 */

const GROUPS: Array<{ id: string; title: string; ids: MetricId[] }> = [
  { id: 'returns', title: 'Rendimiento', ids: ['return', 'twr', 'xirr'] },
  { id: 'risk', title: 'Riesgo', ids: ['volatility', 'maxDrawdown', 'var', 'cvar'] },
  { id: 'risk-adjusted', title: 'Rendimiento ajustado por riesgo', ids: ['sharpe', 'sortino'] },
  { id: 'benchmark', title: 'Frente al índice de referencia', ids: ['beta', 'alpha', 'trackingError', 'informationRatio'] },
  { id: 'diversification', title: 'Concentración y diversificación', ids: ['hhi', 'effectiveBets'] },
]

export function MetricExplanationsCard({ pid }: { pid: string }) {
  const { data: risk, isLoading: riskLoading } = useRisk(pid)
  const { data: returns, isLoading: returnsLoading } = useReturns(pid)

  if ((riskLoading && !risk) || (returnsLoading && !returns)) return <SkeletonChart />

  const current = risk?.current
  // Beta, alpha, tracking error and IR default to 1 and 0 in the risk payload
  // when there was no benchmark to measure against. Shown here as numbers they
  // would read as measurements, so they become "not enough data" instead.
  const benchmarkMeasured = Boolean(risk?.benchmark?.explanations)
  const periodsPerYear = risk?.bar_cadence?.periodsPerYear

  const values: Record<MetricId, number | null | undefined> = {
    return: returns?.summary?.simple,
    twr: returns?.summary?.twr,
    xirr: returns?.summary?.mwr,
    volatility: current?.volatility,
    maxDrawdown: current?.max_drawdown,
    var: current?.var_95,
    cvar: risk?.tail_risk?.conditionalPct,
    sharpe: current?.sharpe_ratio,
    sortino: current?.sortino_ratio,
    beta: benchmarkMeasured ? current?.beta : null,
    alpha: benchmarkMeasured ? current?.alpha : null,
    trackingError: benchmarkMeasured ? current?.tracking_error : null,
    informationRatio: benchmarkMeasured ? current?.information_ratio : null,
    hhi: risk?.independence?.hhi,
    effectiveBets: risk?.independence?.effective_bets,
  }

  const context: MetricContext = {
    benchmarkName: risk?.benchmark?.name,
    riskFreeRatePct: risk?.risk_free_rate?.annual_pct,
    periodsPerYear,
    observations: risk?.tail_risk?.observations,
    holdings: risk?.independence?.holdings,
    sharpe: current?.sharpe_ratio,
    capitalAgeDays: returns?.summary?.capital_age_days ?? undefined,
    // The risk tab computes alpha without a risk-free rate; see the formula.
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sigma className="h-4 w-4" />
            Qué significa cada métrica
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Cada métrica con su definición, su fórmula, un ejemplo calculado con el mismo motor que
            usa la app, y tu propio resultado con lo que significa. Tus resultados salen de{' '}
            {risk?.tail_risk?.observations ?? '—'} observaciones {cadenceAdjective(periodsPerYear)} de tu
            cartera.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue={GROUPS[0].id}>
        <TabsList variant="line" aria-label="Categorías de métricas" className="w-full flex-wrap justify-start gap-x-1 gap-y-2 group-data-horizontal/tabs:h-auto">
          {GROUPS.map((group) => (
            <TabsTrigger key={group.id} value={group.id} className="flex-none px-2.5">
              {group.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {GROUPS.map((group) => (
          <TabsContent key={group.id} value={group.id} className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {group.ids.map((id) => {
                const explanation = explainMetric(id, values[id], context)
                return explanation ? <MetricCard key={id} explanation={explanation} /> : null
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

/** "diarias", "semanales" or "mensuales" — bar_cadence.label reads "1 dia", which does not fit a sentence. */
function cadenceAdjective(periodsPerYear: number | undefined): string {
  if (!periodsPerYear || periodsPerYear >= 200) return 'diarias'
  return periodsPerYear >= 40 ? 'semanales' : 'mensuales'
}

function MetricCard({ explanation }: { explanation: MetricExplanation }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{explanation.name}</h4>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-primary flex items-center gap-1 justify-end">
              <User className="h-3 w-3" />
              Tu resultado
            </p>
            <p className="text-lg font-financial font-semibold text-foreground">{explanation.display}</p>
          </div>
        </div>

        <Disclosure title="Definición y fórmula">
          <p className="text-xs text-muted-foreground">{explanation.definition}</p>
          <pre className="text-[11px] font-mono bg-muted/50 rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-foreground">
            {explanation.formula}
          </pre>
        </Disclosure>

        <Disclosure title="Ejemplo">
          <p className="text-muted-foreground">{explanation.example.setup}</p>
          <p className="font-financial text-foreground">{explanation.example.steps}</p>
          <p className="text-foreground">{explanation.example.result}</p>
        </Disclosure>

        {/* The reading is the reader's, so it keeps the "Tu resultado" colour. */}
        <Disclosure title="Qué significa tu número" yours>
          <p className="text-xs text-foreground">{explanation.interpretation}</p>
          {explanation.source && (
            <p className="text-[10px] text-muted-foreground">Fuente: {explanation.source}</p>
          )}
        </Disclosure>
      </CardContent>
    </Card>
  )
}

/**
 * The card's collapsed sections: the <details> the worked example has always
 * been behind, with the turning › of advisor-education.tsx so a closed one
 * reads as something to open.
 */
function Disclosure({ title, yours = false, children }: { title: string; yours?: boolean; children: ReactNode }) {
  return (
    <details className={cn('group rounded-lg px-3 py-2', yours ? 'bg-primary/5' : 'border border-border')}>
      <summary
        className={cn(
          'cursor-pointer list-none text-[11px] font-medium flex items-center gap-1.5',
          yours ? 'text-primary' : 'text-foreground',
        )}
      >
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">{children}</div>
    </details>
  )
}
