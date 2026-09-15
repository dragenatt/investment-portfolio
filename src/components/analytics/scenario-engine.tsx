'use client'

import { useState, type FormEvent } from 'react'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { seriesTable } from '@/lib/utils/chart-accessibility'
import { formatCurrency } from '@/lib/utils/currency'
import { useScenarioEngine } from '@/lib/hooks/use-analytics'
import type { MonthlyBand } from '@/lib/services/scenario-engine'

/**
 * The scenario engine (P2-9) on this portfolio.
 *
 * Every input that decides the answer is on the form, and the answer carries
 * the scenario key and seed: the same inputs give the same figures on any
 * device, any day, until the history or the engine version changes.
 */

type FormState = {
  allocation: string
  expected: string
  horizonYears: string
  monthly: string
  rebalance: string
  inflation: string
  custody: string
  commission: string
  shock: string
  shockMonth: string
}

const INITIAL: FormState = {
  allocation: 'current',
  expected: '',
  horizonYears: '5',
  monthly: '0',
  rebalance: 'none',
  inflation: '0',
  custody: '0',
  commission: '0',
  shock: '0',
  shockMonth: '12',
}

const ALLOCATIONS = [
  { id: 'current', label: 'Pesos actuales' },
  { id: 'equalWeight', label: 'Pesos iguales' },
  { id: 'riskParity', label: 'Paridad de riesgo' },
  { id: 'minCVaR', label: 'Mínimo CVaR' },
  { id: 'markowitz', label: 'Markowitz (máximo Sharpe)' },
]

const REBALANCES = [
  { id: 'none', label: 'Sin rebalanceo' },
  { id: 'annual', label: 'Anual' },
  { id: 'monthly', label: 'Mensual' },
]

/** The form as query parameters; numbers the engine clamps server-side. */
export function scenarioQuery(form: FormState): string {
  const years = Number(form.horizonYears)
  return new URLSearchParams({
    allocation: form.allocation,
    expected: form.expected,
    horizon: String(Math.round((Number.isFinite(years) ? years : 5) * 12)),
    monthly: form.monthly,
    rebalance: form.rebalance,
    inflation: form.inflation,
    custody: form.custody,
    commission: form.commission,
    shock: form.shock === '' ? '0' : String(-Math.abs(Number(form.shock) || 0)),
    shockMonth: form.shockMonth,
  }).toString()
}

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ScenarioEngineCard({ pid, currency }: { pid: string; currency: string }) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [query, setQuery] = useState(() => scenarioQuery(INITIAL))
  const [real, setReal] = useState(false)
  const { data, error, isLoading, mutate } = useScenarioEngine(pid, query)
  const theme = getChartTheme()

  const set = (key: keyof FormState) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setQuery(scenarioQuery(form))
  }

  const result = data?.result
  const bands: MonthlyBand[] = result ? (real ? result.real : result.nominal) : []
  const money = (v: number) => formatCurrency(v, currency)
  const rows = bands.map((b) => ({ ...b, outer: [b.p10, b.p90] as [number, number], inner: [b.p25, b.p75] as [number, number] }))
  const last = bands[bands.length - 1]

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-sm font-medium">Motor de escenarios</CardTitle>
        <CardDescription className="text-xs">
          Define capital, pesos, aportaciones, horizonte, rebalanceo, costos, inflación y un choque, y simula el portafolio
          con su propio historial. El mismo escenario siempre da el mismo resultado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="se-allocation" label="Pesos">
            <select id="se-allocation" className={selectClass} value={form.allocation} onChange={set('allocation')}>
              {ALLOCATIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="se-expected" label="Rendimiento esperado anual (%)" hint="Vacío: la media histórica de cada posición.">
            <Input id="se-expected" type="number" min={-50} max={50} step={0.5} placeholder="Histórico" value={form.expected} onChange={set('expected')} />
          </Field>
          <Field id="se-horizon" label="Horizonte (años)">
            <Input id="se-horizon" type="number" min={1} max={30} step={1} value={form.horizonYears} onChange={set('horizonYears')} />
          </Field>
          <Field id="se-monthly" label="Aportación mensual">
            <Input id="se-monthly" type="number" min={0} step={100} value={form.monthly} onChange={set('monthly')} />
          </Field>
          <Field id="se-rebalance" label="Rebalanceo">
            <select id="se-rebalance" className={selectClass} value={form.rebalance} onChange={set('rebalance')}>
              {REBALANCES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="se-inflation" label="Inflación anual (%)">
            <Input id="se-inflation" type="number" min={-5} max={50} step={0.1} value={form.inflation} onChange={set('inflation')} />
          </Field>
          <Field id="se-custody" label="Comisión anual por custodia (%)" hint="Cero si no la indicas: no se inventan costos.">
            <Input id="se-custody" type="number" min={0} max={10} step={0.05} value={form.custody} onChange={set('custody')} />
          </Field>
          <Field id="se-commission" label="Comisión por operación (%)">
            <Input id="se-commission" type="number" min={0} max={10} step={0.05} value={form.commission} onChange={set('commission')} />
          </Field>
          <Field id="se-shock" label="Choque: caída de todas las posiciones (%)">
            <Input id="se-shock" type="number" min={0} max={95} step={1} value={form.shock} onChange={set('shock')} />
          </Field>
          <Field id="se-shock-month" label="Mes del choque">
            <Input id="se-shock-month" type="number" min={1} max={360} step={1} value={form.shockMonth} onChange={set('shockMonth')} />
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button type="submit" className="rounded-lg">
              Simular escenario
            </Button>
          </div>
        </form>

        {isLoading && !data ? (
          <ChartLoading height={280} label="Simulando el escenario…" />
        ) : error && !data ? (
          <ChartEmpty height={280} kind="error" message="No se pudo simular el escenario." onRetry={() => mutate()} />
        ) : data?.message || !result || !last ? (
          <ChartEmpty height={280} message={data?.message ?? 'No hay historial suficiente para simular.'} />
        ) : (
          <>
            {/* Only when the projection rests on the historical means it warns about. */}
            {data.estimates?.unreliable && data.request?.expectedReturn === null && (
              <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
                {data.estimates.note}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {data.allocation?.name} · <span className="font-financial">{result.model.months}</span> meses ·{' '}
                <span className="font-financial">{result.model.simulations.toLocaleString('es-MX')}</span> trayectorias
              </p>
              <div role="group" aria-label="Valores" className="flex gap-1">
                {[
                  { id: false, label: 'Nominal' },
                  { id: true, label: 'En dinero de hoy' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={real === option.id}
                    onClick={() => setReal(option.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${real === option.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <ChartFigure
              summary={`Escenario a ${result.model.months} meses${real ? ' en dinero de hoy' : ''}: al final, pesimista (P10) ${money(last.p10)}, mediana ${money(last.p50)} y optimista (P90) ${money(last.p90)}, con ${money(result.final.contributed)} aportados en total. Es una simulación, no una predicción.`}
              table={seriesTable(bands, 'Percentiles simulados por mes', ['Mes', 'P10', 'P25', 'P50', 'P75', 'P90'], (b) => [
                b.month === 0 ? 'Hoy' : `Mes ${b.month}`,
                money(b.p10),
                money(b.p25),
                money(b.p50),
                money(b.p75),
                money(b.p90),
              ])}
            >
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart accessibilityLayer={false} data={rows} margin={{ top: 8, right: 8 }}>
                  <CartesianGrid {...theme.grid} />
                  <XAxis dataKey="month" {...theme.xAxis} tickFormatter={(m: number) => (m % 12 === 0 ? `${m / 12}a` : '')} />
                  <YAxis {...theme.yAxis} width={72} tickFormatter={(v: number) => money(v)} />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) => (label === 0 ? 'Hoy' : `Mes ${label}`)}
                        includeEntry={(entry) => entry.dataKey === 'p50' || entry.dataKey === 'p10' || entry.dataKey === 'p90'}
                        nameFormatter={(name) => ({ p10: 'P10', p50: 'Mediana', p90: 'P90' })[name] ?? name}
                        valueFormatter={(value) => (typeof value === 'number' ? money(value) : '—')}
                      />
                    }
                  />
                  <Area dataKey="outer" stroke="none" fill={SERIES_PALETTE[0]} fillOpacity={0.12} isAnimationActive={false} />
                  <Area dataKey="inner" stroke="none" fill={SERIES_PALETTE[0]} fillOpacity={0.22} isAnimationActive={false} />
                  <Line dataKey="p50" stroke={SERIES_PALETTE[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="p10" stroke="none" dot={false} isAnimationActive={false} />
                  <Line dataKey="p90" stroke="none" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFigure>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {[
                ['Valor final (P10 · mediana · P90)', `${money(result.final.nominal.p10)} · ${money(result.final.nominal.p50)} · ${money(result.final.nominal.p90)}`],
                ['En dinero de hoy (mediana)', money(result.final.real.p50)],
                ['Capital más aportaciones', money(result.final.contributed)],
                ['Trayectorias que terminan por debajo de lo aportado', `${result.final.probabilityOfLossPct.toFixed(1)}%`],
                ['Peor caída del valor unitario (mediana · P90)', `${result.drawdown.medianPct.toFixed(1)}% · ${result.drawdown.p90Pct.toFixed(1)}%`],
                ['Costos pagados (mediana)', money(result.final.medianCostsPaid)],
                ...(result.final.medianLiquidationTax > 0 ? [['Impuesto si se vendiera todo (mediana)', money(result.final.medianLiquidationTax)]] : []),
                ...(result.benchmark && data.benchmark
                  ? [
                      [`Lo mismo en ${data.benchmark.name} (mediana)`, money(result.benchmark.medianFinal)],
                      [`Trayectorias por encima de ${data.benchmark.name}`, `${result.benchmark.probabilityAheadPct.toFixed(0)}%`],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-dashed border-border/60 py-0.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-financial text-right text-foreground">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {result.model.riskSource}, con historia de {data.window?.from} a {data.window?.to}. No es una predicción ni una
              recomendación.{' '}
              {result.model.gross ? 'Sin costos indicados: las cifras son brutas. ' : ''}
              Reproducible: escenario <span className="font-mono">{result.model.key}</span>, semilla{' '}
              <span className="font-mono">{result.model.seed}</span>, motor {result.model.engineVersion}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
