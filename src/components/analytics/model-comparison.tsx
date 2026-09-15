'use client'

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import type { ModelComparison as ModelComparisonData, WeightEvaluation } from '@/lib/services/model-comparison'

/**
 * Five optimisation models measured with one ruler (P2-6).
 *
 * The table is deliberately flat: no column is highlighted, no cell marked
 * best. Each model optimises a different objective and wins on its own by
 * construction, so emphasising a winner per row would only restate which model
 * optimised that row.
 */

const CURRENT = 'Tu cartera actual'
const CHART_HEIGHT = 280

const pct = (value: number | null, decimals = 1) => (value === null ? '—' : `${value.toFixed(decimals)}%`)

type Column = { key: string; name: string; evaluation: WeightEvaluation; reference?: boolean }

const METRICS: Array<{ label: string; hint: string; value: (e: WeightEvaluation) => string }> = [
  { label: 'Rendimiento estimado', hint: 'anual, media histórica', value: (e) => pct(e.estimatedReturnPct) },
  { label: 'Volatilidad', hint: 'anual', value: (e) => pct(e.volatilityPct) },
  { label: 'Sharpe', hint: 'sobre la tasa libre de riesgo', value: (e) => (e.sharpe === null ? '—' : e.sharpe.toFixed(2)) },
  { label: 'VaR 95%', hint: 'pérdida de un día', value: (e) => pct(e.var95Pct, 2) },
  { label: 'CVaR 95%', hint: 'pérdida media del peor 5% de días', value: (e) => pct(e.cvar95Pct, 2) },
  { label: 'Concentración', hint: 'activos efectivos · mayor peso', value: (e) => `${e.concentration.effectiveHoldings.toFixed(1)} · ${e.concentration.maxWeightSymbol} ${pct(e.concentration.maxWeightPct, 0)}` },
  { label: 'Drawdown estimado', hint: 'peor caída con estos pesos en el periodo', value: (e) => pct(e.estimatedMaxDrawdownPct) },
]

export function ModelComparison({ data, isLoading }: { data?: ModelComparisonData | null; isLoading?: boolean }) {
  const theme = getChartTheme()

  if (isLoading && !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ChartLoading height={CHART_HEIGHT} label="Comparando modelos de optimización…" />
        </CardContent>
      </Card>
    )
  }

  if (!data || data.models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Comparación de modelos de optimización</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartEmpty height={160} message="Se necesitan al menos dos posiciones con historial suficiente para comparar modelos." />
        </CardContent>
      </Card>
    )
  }

  const columns: Column[] = [
    ...data.models.map((m) => ({ key: m.id, name: m.name, evaluation: m })),
    ...(data.current ? [{ key: 'current', name: CURRENT, evaluation: data.current, reference: true }] : []),
  ]
  const symbols = data.models[0].weights.map((w) => w.symbol)
  const rows = symbols.map((symbol, i) => {
    const row: Record<string, string | number> = { symbol }
    for (const column of columns) row[column.key] = column.evaluation.weights[i].weight * 100
    return row
  })
  const nameOf = (key: string) => columns.find((c) => c.key === key)?.name ?? key

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-sm font-medium">Comparación de modelos de optimización</CardTitle>
        <CardDescription className="text-xs">
          Markowitz, mínimo CVaR, paridad de riesgo, Black-Litterman y optimización robusta sobre tus mismas posiciones,
          medidos con la misma regla. Ninguno se marca como mejor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm">{data.summary}</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <caption className="sr-only">Métricas de cada modelo y de tu cartera actual</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-2 pr-3 text-left font-medium">Métrica</th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-2 py-2 text-right font-medium ${column.reference ? 'border-l border-border text-foreground' : ''}`}
                  >
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <tr key={metric.label} className="border-b border-border/50">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <span className="font-medium text-foreground">{metric.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{metric.hint}</span>
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-2 py-1.5 text-right font-financial ${column.reference ? 'border-l border-border' : ''}`}
                    >
                      {metric.value(column.evaluation)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ChartFigure
          summary={`Pesos por activo en cada modelo. ${data.weightSpread
            .slice(0, 3)
            .map((s) => `${s.symbol}: de ${s.minPct.toFixed(0)}% a ${s.maxPct.toFixed(0)}%`)
            .join('; ')}.`}
          table={{
            caption: 'Peso de cada activo según el modelo',
            columns: ['Activo', ...columns.map((c) => c.name)],
            rows: rows.map((row) => [String(row.symbol), ...columns.map((c) => pct(row[c.key] as number))]),
          }}
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart accessibilityLayer={false} data={rows} margin={{ top: 8, right: 8 }}>
              <CartesianGrid {...theme.grid} />
              <XAxis dataKey="symbol" {...theme.xAxis} />
              <YAxis {...theme.yAxis} width={44} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    nameFormatter={(name) => nameOf(name)}
                    valueFormatter={(value) => (typeof value === 'number' ? pct(value) : '—')}
                  />
                }
              />
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(name: string) => <span className="text-xs text-muted-foreground">{nameOf(name)}</span>}
              />
              {columns.map((column, index) => (
                <Bar key={column.key} dataKey={column.key} fill={SERIES_PALETTE[index]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>

        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-foreground">Qué optimiza cada modelo y en qué se apoya</summary>
          <dl className="mt-3 space-y-3">
            {data.models.map((m) => (
              <div key={m.id}>
                <dt className="font-medium text-foreground">{m.name}</dt>
                <dd className="text-muted-foreground">
                  {m.objective} <span className="text-foreground">Se apoya en:</span> {m.relies_on}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        {data.unavailable.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.unavailable.map((u) => (
              <li key={u.id}>
                <span className="font-medium text-foreground">{u.name}:</span> no disponible. {u.reason}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">{data.caveat}</p>
      </CardContent>
    </Card>
  )
}
