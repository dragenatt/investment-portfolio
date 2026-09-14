'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { useRisk, useReturns } from '@/lib/hooks/use-analytics'
import {
  explainMetric,
  type MetricContext,
  type MetricExplanation,
  type MetricId,
} from '@/lib/services/metric-explanations'
import { Sigma, BookOpen, User } from 'lucide-react'

/**
 * E3 — every important metric with its definition, formula, a worked example,
 * the user's own result and what that result means.
 *
 * The user's number and its reading are marked "Tu resultado"; the definition,
 * formula and example are marked as explanation. Same separation as D3 and the
 * lab: the explanation is true of the metric, the result is true of this book
 * over this window, and blending them makes the second read like the first.
 */

const GROUPS: Array<{ title: string; ids: MetricId[] }> = [
  { title: 'Rendimiento', ids: ['return', 'twr', 'xirr'] },
  { title: 'Riesgo', ids: ['volatility', 'maxDrawdown', 'var', 'cvar'] },
  { title: 'Rendimiento ajustado por riesgo', ids: ['sharpe', 'sortino'] },
  { title: 'Frente al indice de referencia', ids: ['beta', 'alpha', 'trackingError', 'informationRatio'] },
  { title: 'Concentracion y diversificacion', ids: ['hhi', 'effectiveBets'] },
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
            Que significa cada metrica
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Cada metrica con su definicion, su formula, un ejemplo calculado con el mismo motor que
            usa la app, y tu propio resultado con lo que significa. Tus resultados salen de{' '}
            {risk?.tail_risk?.observations ?? '—'} observaciones {cadenceAdjective(periodsPerYear)} de tu
            cartera.
          </CardDescription>
        </CardHeader>
      </Card>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {group.ids.map((id) => {
              const explanation = explainMetric(id, values[id], context)
              return explanation ? <MetricCard key={id} explanation={explanation} /> : null
            })}
          </div>
        </section>
      ))}
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
            <p className="text-lg font-mono font-semibold tabular-nums text-foreground">{explanation.display}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <BookOpen className="h-3 w-3" />
            Definicion
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{explanation.definition}</p>
          <pre className="text-[11px] font-mono bg-muted/50 rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-foreground">
            {explanation.formula}
          </pre>
        </div>

        <details className="group rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-foreground">
            Ejemplo
          </summary>
          <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
            <p className="text-muted-foreground">{explanation.example.setup}</p>
            <p className="font-mono text-foreground">{explanation.example.steps}</p>
            <p className="text-foreground">{explanation.example.result}</p>
          </div>
        </details>

        <div className="rounded-lg bg-primary/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-primary mb-1">Que significa tu numero</p>
          <p className="text-xs text-foreground leading-relaxed">{explanation.interpretation}</p>
        </div>

        {explanation.source && (
          <p className="text-[10px] text-muted-foreground">Fuente: {explanation.source}</p>
        )}
      </CardContent>
    </Card>
  )
}
