'use client'

import { useMemo, useState } from 'react'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/lib/hooks/use-debounce'
import {
  useScenarioComparison,
  type ScenarioMetrics,
  type ScenarioExplanation,
} from '@/lib/hooks/use-analytics'
import { GitCompareArrows, AlertTriangle, ChevronDown } from 'lucide-react'

/**
 * E2 — the same holdings, allocated several ways, living the same futures.
 *
 * The table is deliberately not a ranking. Nothing is marked "best": which
 * column is better depends on whether someone is optimising for drawdown or
 * for estimated return, and the estimated return is the least reliable row on
 * the page. The explanations under the table say why each column differs from
 * the first one, which is the part E2 actually asks for.
 */

const HORIZONS = [1, 3, 5, 10] as const
const DEFAULT_INCLUDE = ['current', 'equalWeight', 'riskParity', 'minVariance']
const MIN_SCENARIOS = 2

const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`

type Row = {
  group: string
  label: string
  /** Estimates get a tag, so they cannot be read as observations. */
  estimate?: boolean
  value: (s: ScenarioMetrics) => string
}

function rowsFor(horizonYears: number): Row[] {
  const years = `${horizonYears} ${horizonYears === 1 ? 'ano' : 'anos'}`
  return [
    { group: 'Riesgo', label: 'Volatilidad anual', value: (s) => pct(s.volatilityPct) },
    // Two conventions, labelled as such. The first sums the average daily return
    // 252 times, like the efficient frontier; the second compounds it along each
    // simulated path. With high estimated returns the compounded median lands
    // ABOVE the simple figure (35.6% vs 40.4% on a real book), which reads as a
    // contradiction unless the labels say which is which.
    { group: 'Retorno', label: 'Rendimiento esperado anual (simple)', estimate: true, value: (s) => pct(s.expectedReturnPct) },
    { group: 'Retorno', label: 'Crecimiento mediano simulado (compuesto)', estimate: true, value: (s) => pct(s.medianAnnualReturnPct) },
    { group: 'Sharpe', label: 'Rendimiento estimado por unidad de riesgo', estimate: true, value: (s) => (s.sharpe === null ? '—' : s.sharpe.toFixed(2)) },
    {
      group: 'VaR',
      label: `Peor 5% de los futuros a ${years}`,
      value: (s) => (s.var95Pct >= 0 ? `pierde ${pct(s.var95Pct)}` : `gana ${pct(-s.var95Pct)}`),
    },
    { group: 'Drawdown', label: 'Caida máxima típica', value: (s) => pct(s.maxDrawdownMedianPct) },
    { group: 'Drawdown', label: 'Caida en un camino malo (P90)', value: (s) => pct(s.maxDrawdownBadPct) },
    { group: 'Probabilidad', label: `Terminar con pérdida a ${years}`, value: (s) => pct(s.probabilityOfLoss * 100) },
    { group: 'Probabilidad', label: 'Superar la tasa libre de riesgo', value: (s) => pct(s.probabilityBeatRiskFree * 100) },
    {
      group: 'Concentracion',
      label: 'HHI · posiciones equivalentes',
      value: (s) => `${s.hhi.toFixed(2)} · ${s.effectiveHoldings.toFixed(1)}`,
    },
    {
      group: 'Concentracion',
      label: 'Mayor fuente de riesgo',
      value: (s) => `${s.largestRiskShare.symbol} ${pct(s.largestRiskShare.pct, 0)}`,
    },
  ]
}

export function ScenarioComparisonCard({ pid }: { pid: string }) {
  const [horizon, setHorizon] = useState<number>(1)
  const [include, setInclude] = useState<string[]>(DEFAULT_INCLUDE)
  const [custom, setCustom] = useState<Record<string, number>>({})

  const query = useMemo(() => {
    const params = new URLSearchParams({ horizon: String(horizon), include: include.join(',') })
    if (include.includes('custom')) {
      const pairs = Object.entries(custom).filter(([, w]) => w > 0)
      if (pairs.length > 0) params.set('custom', pairs.map(([s, w]) => `${s}:${w}`).join(','))
    }
    return params.toString()
  }, [horizon, include, custom])

  // Sliders settle before asking; chips and horizon feel instant enough at this delay.
  const settledQuery = useDebounce(query, 250)
  const { data, error, isLoading, isValidating } = useScenarioComparison(pid, settledQuery)

  if (isLoading && !data) return <SkeletonChart />

  const comparison = data?.comparison ?? null
  const symbols = data?.symbols ?? []
  const available = data?.available ?? []

  const toggle = (id: string) => {
    if (id === 'custom' && !include.includes('custom') && Object.keys(custom).length === 0) {
      // Start the custom book from the current weights, the obvious thing to edit.
      // Seeding is idempotent, so reading `include` from this render is safe here.
      const base = comparison?.scenarios.find((s) => s.id === 'current')
      if (base) {
        setCustom(Object.fromEntries(base.weights.map((w) => [w.symbol, Math.round(w.weight * 100)])))
      }
    }
    // A pure functional update: two quick clicks must both land. Reading
    // `include` from the render closure instead dropped the first of them.
    setInclude((current) => {
      if (!current.includes(id)) return [...current, id]
      return current.length > MIN_SCENARIOS ? current.filter((x) => x !== id) : current
    })
  }

  const customTotal = Object.values(custom).reduce((a, b) => a + b, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Comparar escenarios
        </CardTitle>
        <CardDescription className="text-xs">
          Tus mismas posiciones repartidas de distintas formas, viviendo exactamente los mismos
          {comparison ? ` ${comparison.simulations.toLocaleString('es-MX')}` : ''} futuros
          simulados. Cualquier diferencia entre columnas viene de la asignación, no de la suerte.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && <p className="text-sm text-loss">No se pudo cargar la comparacion: {String(error.message ?? error)}</p>}
        {data?.message && !comparison && !available.length && (
          <p className="text-sm text-muted-foreground">{data.message}</p>
        )}

        {available.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground mr-1">Horizonte</span>
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizon(h)}
                  aria-pressed={horizon === h}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs border transition-colors',
                    horizon === h ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary',
                  )}
                >
                  {h} {h === 1 ? 'ano' : 'anos'}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground mr-1">Escenarios</span>
              {[...available, { id: 'custom', name: 'Personalizado', rationale: 'Reparte tus posiciones como quieras.' }].map((option) => {
                const active = include.includes(option.id)
                const locked = active && include.length <= MIN_SCENARIOS
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggle(option.id)}
                    aria-pressed={active}
                    title={locked ? 'Se necesitan al menos dos escenarios' : option.rationale}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs border transition-colors',
                      active ? 'bg-primary/10 border-primary/40 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary',
                      locked && 'cursor-not-allowed',
                    )}
                  >
                    {option.name}
                  </button>
                )
              })}
            </div>

            {include.includes('custom') && symbols.length > 0 && (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Tu asignacion personalizada. Los pesos se normalizan: suman {customTotal}, se tratan como 100%.
                </p>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {symbols.map((symbol) => (
                    <label key={symbol} className="flex items-center gap-3 text-xs">
                      <span className="font-mono w-16 shrink-0">{symbol}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={custom[symbol] ?? 0}
                        onChange={(event) =>
                          setCustom((current) => ({ ...current, [symbol]: Number(event.target.value) }))
                        }
                        className="flex-1 accent-primary"
                      />
                      <span className="font-financial w-10 text-right">
                        {customTotal > 0 ? pct(((custom[symbol] ?? 0) / customTotal) * 100, 0) : '0%'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(data?.request?.errors.length ?? 0) > 0 && (
          <ul className="text-[11px] text-warn space-y-0.5">
            {data!.request!.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        {comparison ? (
          <div className={cn('space-y-5 transition-opacity', isValidating && 'opacity-60')}>
            <ComparisonTable scenarios={comparison.scenarios} horizonYears={comparison.horizonYears} />

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              El rendimiento esperado simple suma el rendimiento diario promedio de cada activo, como la
              frontera eficiente. La simulación lo compone día a día, así que cuando los rendimientos
              estimados son altos el crecimiento mediano compuesto puede quedar por encima del simple.
              No se contradicen: miden cosas distintas.
            </p>

            {comparison.rejected.length > 0 && (
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {comparison.rejected.map((r) => (
                  <p key={r.id} className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 text-warn shrink-0" />
                    {r.name} no se incluyo: {r.reason}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-medium text-foreground">
                Por que cada escenario cambia respecto a {comparison.scenarios[0].name}
              </h4>
              {comparison.explanations.map((explanation) => (
                <Explanation key={explanation.scenarioId} explanation={explanation} />
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed rounded-xl bg-muted/40 p-3">
              {comparison.caveat}
            </p>
            <p className="text-[10px] text-muted-foreground font-financial">
              {data?.observations} dias de historial comun ({data?.from_date} a {data?.to_date}) ·
              tasa libre {data?.risk_free_rate?.annual_pct}% ({data?.risk_free_rate?.source}) ·
              semilla {comparison.seed}
            </p>
          </div>
        ) : (
          data?.message && available.length > 0 && <p className="text-sm text-muted-foreground">{data.message}</p>
        )}
        <AuditTrail meta={data?._meta} />
      </CardContent>
    </Card>
  )
}

function ComparisonTable({ scenarios, horizonYears }: { scenarios: ScenarioMetrics[]; horizonYears: number }) {
  const rows = rowsFor(horizonYears)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="text-left font-normal py-1.5 pr-3 min-w-44">Metrica</th>
            {scenarios.map((s, i) => (
              <th key={s.id} className="text-right font-medium py-1.5 px-2 min-w-28 text-foreground" title={s.rationale ?? undefined}>
                {s.name}
                {i === 0 && <span className="block text-[10px] font-normal text-muted-foreground">referencia</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <td className="py-1.5 pr-3 text-muted-foreground">
              <span className="text-[10px] uppercase tracking-wide block">Composicion</span>
              Pesos principales
            </td>
            {scenarios.map((s) => (
              <td key={s.id} className="py-1.5 px-2 text-right text-[11px] font-financial leading-snug">
                {s.weights
                  .filter((w) => w.weight >= 0.005)
                  .sort((a, b) => b.weight - a.weight)
                  .slice(0, 3)
                  .map((w) => (
                    <span key={w.symbol} className="block">
                      {w.symbol} {pct(w.weight * 100, 0)}
                    </span>
                  ))}
              </td>
            ))}
          </tr>
          {rows.map((row, index) => (
            <tr key={row.label}>
              <td className="py-1.5 pr-3 text-muted-foreground">
                {(index === 0 || rows[index - 1].group !== row.group) && (
                  <span className="text-[10px] uppercase tracking-wide block">{row.group}</span>
                )}
                {row.label}
                {row.estimate && (
                  <span className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide">estimado</span>
                )}
              </td>
              {scenarios.map((s) => (
                <td key={s.id} className="py-1.5 px-2 text-right font-financial text-foreground">
                  {row.value(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Explanation({ explanation }: { explanation: ScenarioExplanation }) {
  return (
    <details className="group rounded-xl border border-border p-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-xs text-foreground leading-relaxed">
        <span>{explanation.headline}</span>
        {explanation.reasons.length > 0 && (
          <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        )}
      </summary>
      {explanation.reasons.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {explanation.reasons.map((reason) => (
            <li key={reason} className="text-[11px] text-muted-foreground leading-relaxed">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
