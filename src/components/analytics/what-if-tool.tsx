'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { useRebalanceInputs, type RebalanceInputs } from '@/lib/hooks/use-analytics'
import { useGoals } from '@/lib/hooks/use-goals'
import { buildScenarios } from '@/lib/services/advisor'
import { whatIf, describeWhatIf, type Scenario, type WhatIfChange, type ScenarioSnapshot } from '@/lib/services/what-if'
import { cn } from '@/lib/utils'

// 4.6. what-if.ts composed the risk, tail and goal engines so one change could
// be seen across all of them at once — and nothing asked it anything. This runs
// it in the browser on the same inputs the rebalance panel is served (weights,
// covariance and expected returns from the portfolio's own history), so both
// sides of every comparison come from one set of numbers and one set of
// simulated paths: a difference is the change, not a different roll.

const SIMULATIONS = 1000
/** Fixed, so the same question asked twice gets the same answer. */
const SEED = 20260916

type WeightPreset = 'current' | 'equal' | 'riskParity' | 'custom'

const PRESETS: Array<{ value: WeightPreset; label: string }> = [
  { value: 'current', label: 'Pesos actuales' },
  { value: 'equal', label: 'Rebalancear a pesos iguales' },
  { value: 'riskParity', label: 'Rebalancear a paridad de riesgo' },
  { value: 'custom', label: 'Pesos a mano' },
]

export type WhatIfForm = {
  preset: WeightPreset
  custom: Record<string, string>
  removed: string[]
  returnShiftPp: string
  volMultiplier: string
  // The goal the book is measured against (optional).
  goalContribution: string
  goalYears: string
  goalTarget: string
  // Changes to that plan.
  newContribution: string
  newYears: string
  newCapital: string
}

const num = (value: string): number | null => {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

export function emptyWhatIfForm(inputs: RebalanceInputs): WhatIfForm {
  return {
    preset: 'current',
    custom: Object.fromEntries(inputs.holdings.map((h) => [h.symbol, (h.weight * 100).toFixed(1)])),
    removed: [],
    returnShiftPp: '0',
    volMultiplier: '1',
    goalContribution: '',
    goalYears: '',
    goalTarget: '',
    newContribution: '',
    newYears: '',
    newCapital: '',
  }
}

type Built = { scenario: Scenario; change: WhatIfChange; years: number } | { error: string }

/** The form as a scenario and a change, or the first reason it is not one. */
export function buildWhatIf(inputs: RebalanceInputs, form: WhatIfForm): Built {
  const scenario: Scenario = {
    holdings: inputs.holdings.map((h) => ({ symbol: h.symbol, value: h.value })),
    expectedReturns: inputs.expected_returns,
    cov: inputs.cov,
    riskFreeRate: inputs.risk_free_rate,
  }
  const change: WhatIfChange = {}

  if (form.preset === 'equal' && inputs.targets.equal) change.weights = inputs.targets.equal
  if (form.preset === 'riskParity') {
    if (!inputs.targets.riskParity) return { error: 'La paridad de riesgo no se pudo calcular con este historial.' }
    change.weights = inputs.targets.riskParity
  }
  if (form.preset === 'custom') {
    const weights: Record<string, number> = {}
    for (const h of inputs.holdings) {
      const pct = num(form.custom[h.symbol] ?? '0') ?? 0
      if (!Number.isFinite(pct) || pct < 0) return { error: `El peso de ${h.symbol} debe ser un número mayor o igual a cero.` }
      weights[h.symbol] = pct / 100
    }
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    if (Math.abs(total - 1) > 1e-3) return { error: `Los pesos suman ${(total * 100).toFixed(1)}%; deben sumar 100%.` }
    change.weights = weights
  }
  if (form.removed.length > 0) {
    if (change.weights) return { error: 'Quita posiciones con los pesos actuales, o reparte los pesos a mano; las dos cosas a la vez no se pueden combinar.' }
    if (form.removed.length >= inputs.holdings.length) return { error: 'Tiene que quedar al menos una posición.' }
    change.removeSymbols = form.removed
  }

  const shift = num(form.returnShiftPp)
  if (shift !== null) {
    if (!Number.isFinite(shift)) return { error: 'El ajuste de rendimiento debe ser un número.' }
    if (shift !== 0) change.expectedReturnShift = shift / 100
  }
  const multiplier = num(form.volMultiplier)
  if (multiplier !== null) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return { error: 'El multiplicador de volatilidad debe ser mayor que cero.' }
    if (multiplier !== 1) change.volatilityMultiplier = multiplier
  }

  const goal = [num(form.goalContribution), num(form.goalYears), num(form.goalTarget)]
  const anyGoal = goal.some((v) => v !== null)
  let years = 0
  if (anyGoal) {
    const [aportacion, años, meta] = goal
    if (aportacion === null || años === null || meta === null) return { error: 'Para medir contra una meta, llena aportación, años y monto de la meta.' }
    if (![aportacion, años, meta].every(Number.isFinite) || aportacion < 0 || meta <= 0 || !Number.isInteger(años) || años < 1 || años > 50) {
      return { error: 'La meta necesita una aportación ≥ 0, de 1 a 50 años enteros y un monto mayor que cero.' }
    }
    scenario.plan = { aportacionMensual: aportacion, años, meta }
    years = años

    const newContribution = num(form.newContribution)
    const newYears = num(form.newYears)
    const newCapital = num(form.newCapital)
    if (newContribution !== null) {
      if (!Number.isFinite(newContribution) || newContribution < 0) return { error: 'La nueva aportación debe ser un número mayor o igual a cero.' }
      change.aportacionMensual = newContribution
    }
    if (newYears !== null) {
      if (!Number.isInteger(newYears) || newYears < 1 || newYears > 50) return { error: 'El nuevo horizonte debe ser de 1 a 50 años enteros.' }
      change.años = newYears
      years = Math.max(years, newYears)
    }
    if (newCapital !== null) {
      if (!Number.isFinite(newCapital) || newCapital <= 0) return { error: 'El capital debe ser mayor que cero.' }
      change.capitalInicial = newCapital
    }
  } else if ([form.newContribution, form.newYears, form.newCapital].some((v) => v.trim() !== '')) {
    return { error: 'Los cambios de aportación, horizonte o capital se miden contra una meta: llénala primero.' }
  }

  return { scenario, change, years }
}

const pct = (v: number | null, digits = 2) => (v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`)
const signed = (v: number | null, digits = 2, unit = ' pp') =>
  v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`

export function WhatIfTool({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading, error } = useRebalanceInputs(portfolioId)
  const inputs = data && !('message' in data) ? data : null

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">¿Qué pasaría si…?</CardTitle>
        <CardDescription>
          Cambia pesos, quita posiciones, ajusta el riesgo o tu plan, y mira qué se mueve en todo a la vez: rendimiento,
          volatilidad, cola de pérdidas, concentración y probabilidad de tu meta. Nada de esto ejecuta una operación.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudieron cargar los datos del portafolio.</p>
        ) : !inputs ? (
          <p className="text-sm text-muted-foreground">{data && 'message' in data ? data.message : 'Sin datos.'}</p>
        ) : (
          <WhatIfEditor portfolioId={portfolioId} inputs={inputs} />
        )}
      </CardContent>
    </Card>
  )
}

function WhatIfEditor({ portfolioId, inputs }: { portfolioId: string; inputs: RebalanceInputs }) {
  const [form, setForm] = useState<WhatIfForm>(() => emptyWhatIfForm(inputs))
  const [committed, setCommitted] = useState<WhatIfForm>(form)
  const { data: goals } = useGoals()
  const money = useMemo(
    () => new Intl.NumberFormat('es-MX', { style: 'currency', currency: inputs.currency, maximumFractionDigits: 0 }),
    [inputs.currency],
  )

  // A goal already tied to this portfolio, in its currency, can seed the plan.
  const linkedGoal = (goals ?? []).find((g) => g.portfolio_id === portfolioId && g.status === 'active' && g.currency === inputs.currency)

  const built = useMemo(() => buildWhatIf(inputs, committed), [inputs, committed])
  const result = useMemo(() => {
    if ('error' in built) return null
    const scenarios = buildScenarios({ months: Math.max(1, built.years) * 12, simulations: SIMULATIONS, seed: SEED })
    return whatIf(built.scenario, built.change, scenarios)
  }, [built])

  const set = <K extends keyof WhatIfForm>(key: K, value: WhatIfForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const applyGoal = () => {
    if (!linkedGoal) return
    const months = Math.max(12, Math.round((Date.parse(linkedGoal.target_date) - Date.now()) / (30.44 * 86_400_000)))
    setForm((f) => ({
      ...f,
      goalContribution: String(linkedGoal.monthly_contribution),
      goalYears: String(Math.max(1, Math.round(months / 12))),
      goalTarget: String(linkedGoal.target_amount),
    }))
  }

  const rows: Array<{ label: string; before: (s: ScenarioSnapshot) => string; delta: string | null }> = result
    ? [
        { label: 'Rendimiento esperado anual', before: (s) => pct(s.expectedReturnPct), delta: signed(result.delta.expectedReturnPp) },
        { label: 'Volatilidad anual', before: (s) => pct(s.volatilityPct), delta: signed(result.delta.volatilityPp) },
        { label: 'Sharpe', before: (s) => (s.sharpe === null ? '—' : s.sharpe.toFixed(2)), delta: signed(result.delta.sharpe, 2, '') },
        { label: 'Concentración (HHI)', before: (s) => s.hhi.toFixed(3), delta: signed(result.delta.hhi, 3, '') },
        { label: 'VaR 95% a un año', before: (s) => pct(s.var95Pct), delta: signed(result.delta.var95Pp) },
        { label: 'Probabilidad de la meta', before: (s) => pct(s.goalProbabilityPct, 1), delta: signed(result.delta.goalProbabilityPp, 1) },
        { label: 'Valor final (mediana)', before: (s) => (s.finalValueMedian === null ? '—' : money.format(s.finalValueMedian)), delta: null },
        { label: 'Valor final (escenario bajo, P10)', before: (s) => (s.finalValueP10 === null ? '—' : money.format(s.finalValueP10)), delta: null },
      ]
    : []

  const field = 'mt-1 block w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm font-financial'

  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setCommitted(form)
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pesos</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <label key={p.value} className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs', form.preset === p.value ? 'border-primary bg-primary/10' : 'border-border')}>
                <input type="radio" name="preset" className="sr-only" checked={form.preset === p.value} onChange={() => set('preset', p.value)} />
                {p.label}
              </label>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Posiciones, su peso actual y los cambios</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">Posición</th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">Peso actual</th>
                  {form.preset === 'custom' && <th scope="col" className="py-1 pr-3 font-medium text-right">Nuevo peso (%)</th>}
                  {form.preset === 'current' && <th scope="col" className="py-1 font-medium text-right">Quitar</th>}
                </tr>
              </thead>
              <tbody>
                {inputs.holdings.map((h) => (
                  <tr key={h.symbol} className="border-t border-border">
                    <th scope="row" className="py-1 pr-3 text-left font-mono font-normal">{h.symbol}</th>
                    <td className="py-1 pr-3 text-right font-financial">{(h.weight * 100).toFixed(1)}%</td>
                    {form.preset === 'custom' && (
                      <td className="py-1 pr-3 text-right">
                        <input
                          aria-label={`Nuevo peso de ${h.symbol}`}
                          inputMode="decimal"
                          className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm font-financial"
                          value={form.custom[h.symbol] ?? ''}
                          onChange={(e) => set('custom', { ...form.custom, [h.symbol]: e.target.value })}
                        />
                      </td>
                    )}
                    {form.preset === 'current' && (
                      <td className="py-1 text-right">
                        <input
                          type="checkbox"
                          aria-label={`Quitar ${h.symbol} y repartir su peso entre las demás`}
                          className="h-4 w-4 accent-primary"
                          checked={form.removed.includes(h.symbol)}
                          onChange={(e) => set('removed', e.target.checked ? [...form.removed, h.symbol] : form.removed.filter((s) => s !== h.symbol))}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {form.preset === 'current' && (
            <p className="text-xs text-muted-foreground">Una posición quitada reparte su peso entre las demás en proporción, como pasa al vender y dejar el dinero en el resto.</p>
          )}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Supuestos de mercado</legend>
          <label className="text-xs text-muted-foreground">
            Ajuste al rendimiento esperado (puntos por año)
            <input inputMode="decimal" className={field} value={form.returnShiftPp} onChange={(e) => set('returnShiftPp', e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            Multiplicador de volatilidad (1 = como en el historial)
            <input inputMode="decimal" className={field} value={form.volMultiplier} onChange={(e) => set('volMultiplier', e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meta (opcional)</legend>
          {linkedGoal && (
            <button type="button" onClick={applyGoal} className="text-xs text-primary hover:underline">
              Usar mi meta «{linkedGoal.name}»
            </button>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">
              Aportación mensual
              <input inputMode="decimal" className={field} value={form.goalContribution} onChange={(e) => set('goalContribution', e.target.value)} />
            </label>
            <label className="text-xs text-muted-foreground">
              Años
              <input inputMode="numeric" className={field} value={form.goalYears} onChange={(e) => set('goalYears', e.target.value)} />
            </label>
            <label className="text-xs text-muted-foreground">
              Monto de la meta ({inputs.currency})
              <input inputMode="decimal" className={field} value={form.goalTarget} onChange={(e) => set('goalTarget', e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Cambios al plan — déjalos vacíos para no cambiarlos. El capital de partida es lo que vale el portafolio hoy
            (<span className="font-financial">{money.format(inputs.book_value)}</span>).
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">
              Nueva aportación mensual
              <input inputMode="decimal" className={field} value={form.newContribution} onChange={(e) => set('newContribution', e.target.value)} />
            </label>
            <label className="text-xs text-muted-foreground">
              Nuevo horizonte (años)
              <input inputMode="numeric" className={field} value={form.newYears} onChange={(e) => set('newYears', e.target.value)} />
            </label>
            <label className="text-xs text-muted-foreground">
              Nuevo capital de partida
              <input inputMode="decimal" className={field} value={form.newCapital} onChange={(e) => set('newCapital', e.target.value)} />
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Ver el impacto
          </button>
          <button
            type="button"
            onClick={() => {
              const fresh = emptyWhatIfForm(inputs)
              setForm(fresh)
              setCommitted(fresh)
            }}
            className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            Volver al portafolio actual
          </button>
        </div>
      </form>

      {'error' in built ? (
        <p role="alert" className="text-sm text-loss">{built.error}</p>
      ) : !result ? (
        <p role="alert" className="text-sm text-loss">Ese cambio no describe un portafolio válido con estos datos.</p>
      ) : (
        <div className="space-y-3" aria-live="polite">
          <p className="text-sm">{describeWhatIf(result)}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Métricas antes y después del cambio</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Métrica</th>
                  <th scope="col" className="py-2 pr-3 font-medium text-right">Hoy</th>
                  <th scope="col" className="py-2 pr-3 font-medium text-right">Con el cambio</th>
                  <th scope="col" className="py-2 font-medium text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{row.label}</th>
                    <td className="py-2 pr-3 text-right font-financial">{row.before(result.before)}</td>
                    <td className="py-2 pr-3 text-right font-financial">{row.before(result.after)}</td>
                    <td className="py-2 text-right font-financial text-muted-foreground">{row.delta ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">Pesos y aporte al riesgo, antes y después</summary>
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">Peso y parte del riesgo de cada posición</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">Posición</th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">Peso hoy</th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">Peso después</th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">Riesgo hoy</th>
                  <th scope="col" className="py-1 font-medium text-right">Riesgo después</th>
                </tr>
              </thead>
              <tbody>
                {inputs.holdings.map((h) => {
                  const shareBefore = result.before.riskShare.find((r) => r.symbol === h.symbol)?.percentOfRisk ?? null
                  const shareAfter = result.after.riskShare.find((r) => r.symbol === h.symbol)?.percentOfRisk ?? null
                  return (
                    <tr key={h.symbol} className="border-t border-border">
                      <th scope="row" className="py-1 pr-3 text-left font-mono font-normal">{h.symbol}</th>
                      <td className="py-1 pr-3 text-right font-financial">{pct((result.before.weights[h.symbol] ?? 0) * 100, 1)}</td>
                      <td className="py-1 pr-3 text-right font-financial">{pct((result.after.weights[h.symbol] ?? 0) * 100, 1)}</td>
                      <td className="py-1 pr-3 text-right font-financial">{pct(shareBefore, 1)}</td>
                      <td className="py-1 text-right font-financial">{pct(shareAfter, 1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>

          <p className="text-xs text-muted-foreground">
            Rendimientos esperados y covarianzas salen del historial del portafolio (
            <span className="font-financial">{inputs.window.from}</span> a <span className="font-financial">{inputs.window.to}</span>): describen el
            pasado, no prometen el futuro. La meta se simula con {SIMULATIONS} trayectorias iguales para los dos lados.
            El benchmark no entra aquí: ninguna de estas métricas se mide contra él.
          </p>
          <AuditTrail meta={inputs._meta} />
        </div>
      )}
    </div>
  )
}
