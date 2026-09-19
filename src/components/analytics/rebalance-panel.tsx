'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { useRebalanceInputs, type RebalanceInputs } from '@/lib/hooks/use-analytics'
import {
  detectRiskDrift,
  isCalendarDue,
  planRebalance,
  simulateRebalance,
  type CalendarFrequency,
  type RebalanceMode,
} from '@/lib/services/rebalance'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { costModelFrom, isCostModelConfigured, rebalanceCost, type CostModel } from '@/lib/services/costs'

// P0-12 and P1-10: the rebalance planner and its before/after simulator, which
// existed in full and were imported by nothing. The route serves the inputs;
// every decision below is rebalance.ts running in the browser, so changing the
// mode or a threshold answers instantly and nothing is reimplemented here.
//
// Nothing on this panel executes a trade.

type TargetSource = 'drift' | 'equal' | 'riskParity' | 'custom'
type Mode = 'deviation' | 'band' | 'calendar' | 'risk'

const TARGET_LABELS: Record<TargetSource, { label: string; hint: string }> = {
  drift: {
    label: 'Deshacer la deriva de precios',
    hint: 'Los pesos que tus cantidades actuales tenían al inicio del periodo: devuelve exactamente lo que los precios movieron. No es tu cartera de entonces.',
  },
  equal: { label: 'Pesos iguales', hint: 'La misma parte para cada posición.' },
  riskParity: { label: 'Paridad de riesgo', hint: 'Cada posición aporta la misma parte del riesgo total, con la covarianza del periodo.' },
  custom: { label: 'Personalizado', hint: 'Tus propios pesos objetivo; deben sumar 100%.' },
}

const MODE_LABELS: Record<Mode, string> = {
  deviation: 'Por desviación',
  band: 'Por bandas',
  calendar: 'Por calendario',
  risk: 'Por riesgo',
}

const FREQUENCY_LABELS: Record<CalendarFrequency, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`
const signed = (value: number, digits = 2, unit = '') => `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

const inputClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm'

function Panel({ inputs, portfolioId, costModel }: { inputs: RebalanceInputs; portfolioId: string; costModel: CostModel | null }) {
  const symbols = inputs.holdings.map((h) => h.symbol)
  const [source, setSource] = useState<TargetSource>(inputs.targets.drift ? 'drift' : 'equal')
  const [mode, setMode] = useState<Mode>('deviation')
  const [thresholdPp, setThresholdPp] = useState(5)
  const [bandPp, setBandPp] = useState(5)
  const [riskPp, setRiskPp] = useState(20)
  const [frequency, setFrequency] = useState<CalendarFrequency>('quarterly')
  const [lastRebalance, setLastRebalance] = useState('')
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.holdings.map((h) => [h.symbol, (h.weight * 100).toFixed(1)])),
  )

  const money = (value: number) => formatCurrency(value, inputs.currency)

  const targets = useMemo(() => {
    const map =
      source === 'custom'
        ? Object.fromEntries(symbols.map((s) => [s, (Number(custom[s]) || 0) / 100]))
        : inputs.targets[source]
    return map ? symbols.map((symbol) => ({ symbol, targetWeight: map[symbol] ?? 0 })) : null
  }, [source, custom, inputs, symbols])

  const holdings = inputs.holdings.map((h) => ({ symbol: h.symbol, value: h.value }))

  const result = useMemo(() => {
    if (!targets) return null
    const planMode: RebalanceMode = mode === 'risk' ? 'always' : mode
    const plan = planRebalance(holdings, targets, { mode: planMode, thresholdPp, bandPp })
    const simulation = simulateRebalance(holdings, targets, {
      cov: inputs.cov,
      expectedReturns: inputs.expected_returns,
      riskFreeRate: inputs.risk_free_rate,
      assetBetas: inputs.asset_betas,
    })

    let triggered = plan.triggered
    let reason = plan.reason
    if (mode === 'calendar') {
      const due = isCalendarDue(lastRebalance || null, frequency)
      triggered = due
      reason = due
        ? lastRebalance
          ? `Toca el rebalanceo ${FREQUENCY_LABELS[frequency].toLowerCase()}: ya pasó el periodo desde el ${lastRebalance}.`
          : `Sin un rebalanceo previo registrado, el primero de un calendario ${FREQUENCY_LABELS[frequency].toLowerCase()} toca ya.`
        : `Todavía no toca: el calendario ${FREQUENCY_LABELS[frequency].toLowerCase()} desde el ${lastRebalance} no se ha cumplido.`
    }
    if (mode === 'risk' && simulation) {
      const drift = detectRiskDrift(
        simulation.before.riskShare.map((r) => ({ symbol: r.symbol, weight: r.weight, percentOfRisk: r.percentOfRisk })),
        { thresholdPp: riskPp },
      )
      triggered = drift.triggered
      reason = drift.reason
    }
    return { plan, simulation, triggered, reason }
  }, [targets, mode, thresholdPp, bandPp, riskPp, frequency, lastRebalance, inputs, holdings])

  const customTotal = symbols.reduce((sum, s) => sum + (Number(custom[s]) || 0), 0)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="rebalance-target" label="Pesos objetivo">
          <select id="rebalance-target" className={inputClass} value={source} onChange={(e) => setSource(e.target.value as TargetSource)}>
            {(Object.keys(TARGET_LABELS) as TargetSource[])
              .filter((key) => key === 'custom' || inputs.targets[key] !== null)
              .map((key) => <option key={key} value={key}>{TARGET_LABELS[key].label}</option>)}
          </select>
        </Field>
        <Field id="rebalance-mode" label="Cuándo rebalancear">
          <select id="rebalance-mode" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {(Object.keys(MODE_LABELS) as Mode[]).map((key) => <option key={key} value={key}>{MODE_LABELS[key]}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{TARGET_LABELS[source].hint}</p>

      {source === 'custom' && (
        <div className="space-y-2">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {symbols.map((symbol) => (
              <Field key={symbol} id={`custom-${symbol}`} label={`${symbol} (%)`}>
                <input
                  id={`custom-${symbol}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className={cn(inputClass, 'font-financial')}
                  value={custom[symbol] ?? ''}
                  onChange={(e) => setCustom((prev) => ({ ...prev, [symbol]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <p className={cn('text-xs', Math.abs(customTotal - 100) > 0.05 ? 'text-loss' : 'text-muted-foreground')}>
            Suman <span className="font-financial">{customTotal.toFixed(1)}%</span>
            {Math.abs(customTotal - 100) > 0.05 ? ' — deben sumar 100% para poder planear.' : '.'}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {mode === 'deviation' && (
          <Field id="rebalance-threshold" label="Rebalancear si una posición se desvía más de (puntos)">
            <input id="rebalance-threshold" type="number" min={0.5} step={0.5} className={cn(inputClass, 'font-financial')} value={thresholdPp} onChange={(e) => setThresholdPp(Number(e.target.value) || 0)} />
          </Field>
        )}
        {mode === 'band' && (
          <Field id="rebalance-band" label="Banda de tolerancia (± puntos)">
            <input id="rebalance-band" type="number" min={0.5} step={0.5} className={cn(inputClass, 'font-financial')} value={bandPp} onChange={(e) => setBandPp(Number(e.target.value) || 0)} />
          </Field>
        )}
        {mode === 'calendar' && (
          <>
            <Field id="rebalance-frequency" label="Frecuencia">
              <select id="rebalance-frequency" className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as CalendarFrequency)}>
                {(Object.keys(FREQUENCY_LABELS) as CalendarFrequency[]).map((key) => <option key={key} value={key}>{FREQUENCY_LABELS[key]}</option>)}
              </select>
            </Field>
            <Field id="rebalance-last" label="Último rebalanceo (opcional)">
              <input id="rebalance-last" type="date" className={inputClass} value={lastRebalance} onChange={(e) => setLastRebalance(e.target.value)} />
            </Field>
          </>
        )}
        {mode === 'risk' && (
          <Field id="rebalance-risk" label="Avisar si el riesgo supera al peso por más de (puntos)">
            <input id="rebalance-risk" type="number" min={1} step={1} className={cn(inputClass, 'font-financial')} value={riskPp} onChange={(e) => setRiskPp(Number(e.target.value) || 0)} />
          </Field>
        )}
      </div>

      {!result ? (
        <p className="text-sm text-muted-foreground">No hay pesos objetivo disponibles para este método.</p>
      ) : (
        <>
          <div className={cn('rounded-lg border p-3 text-sm', result.triggered ? 'border-warn/40 bg-warn/5' : 'border-border')}>
            <p className="font-medium">{result.triggered ? 'Conviene revisar' : 'No hace falta rebalancear'}</p>
            <p className="text-muted-foreground">{result.reason}</p>
          </div>

          {result.plan.actions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Pesos actuales, objetivo y la operación que los igualaría</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Activo</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Actual</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Objetivo</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Desviación</th>
                    <th scope="col" className="py-2 font-medium text-right">Operación simulada</th>
                  </tr>
                </thead>
                <tbody>
                  {result.plan.actions.map((a) => (
                    <tr key={a.symbol} className="border-t border-border">
                      <td className="py-2 pr-3 font-mono">{a.symbol}</td>
                      <td className="py-2 pr-3 text-right font-financial">{pct(a.currentWeight * 100)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{pct(a.targetWeight * 100)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{signed(a.deviationPp, 1, ' pp')}</td>
                      <td className="py-2 text-right">
                        {a.action === 'hold' ? (
                          <span className="text-muted-foreground">Mantener</span>
                        ) : (
                          <span>
                            {a.action === 'buy' ? 'Comprar ' : 'Vender '}
                            <span className="font-financial">{money(Math.abs(a.tradeValue))}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Rotación: <span className="font-financial">{pct(result.plan.turnoverPct)}</span> del portafolio (
                <span className="font-financial">{money(result.plan.totalValue)}</span>). Las compras y ventas se compensan: un rebalanceo mueve dinero entre posiciones, no pide aportar más.
              </p>
              {/* 4.6: what executing it costs, on the costs the user stated — never on invented ones. */}
              {isCostModelConfigured(costModel) ? (
                (() => {
                  const cost = rebalanceCost(result.plan.actions.map((a) => a.tradeValue), costModel, result.plan.totalValue)
                  return (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ejecutarlo costaría unos <span className="font-financial">{money(cost.total)}</span>
                      {cost.pctOfPortfolio !== null && <> (<span className="font-financial">{pct(cost.pctOfPortfolio)}</span> del portafolio)</>} en
                      comisiones y spread, con tus costos ({costModel.source}). No incluye impuestos por las ventas con ganancia.
                    </p>
                  )
                })()
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sin costos configurados, el plan no descuenta comisiones ni spread.{' '}
                  <Link href={`/portfolio/${portfolioId}/costs`} className="text-primary hover:underline">Configura tus costos</Link>.
                </p>
              )}
            </div>
          )}

          {result.simulation && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Antes y después, con la misma covarianza y los mismos rendimientos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Métricas del portafolio antes y después del rebalanceo simulado</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Métrica</th>
                      <th scope="col" className="py-2 pr-3 font-medium text-right">Antes</th>
                      <th scope="col" className="py-2 pr-3 font-medium text-right">Después</th>
                      <th scope="col" className="py-2 font-medium text-right">Cambio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Rendimiento esperado (estimado)', b: pct(result.simulation.before.expectedReturnPct, 2), a: pct(result.simulation.after.expectedReturnPct, 2), d: signed(result.simulation.delta.expectedReturnPp, 2, ' pp') },
                      { label: 'Volatilidad anual', b: pct(result.simulation.before.volatilityPct, 2), a: pct(result.simulation.after.volatilityPct, 2), d: signed(result.simulation.delta.volatilityPp, 2, ' pp') },
                      { label: 'Sharpe', b: result.simulation.before.sharpe?.toFixed(3) ?? '—', a: result.simulation.after.sharpe?.toFixed(3) ?? '—', d: result.simulation.delta.sharpe === null ? '—' : signed(result.simulation.delta.sharpe, 3) },
                      { label: `Beta vs ${inputs.benchmark.name}`, b: result.simulation.before.beta?.toFixed(2) ?? '—', a: result.simulation.after.beta?.toFixed(2) ?? '—', d: result.simulation.delta.beta === null ? '—' : signed(result.simulation.delta.beta, 2) },
                      { label: 'VaR 95% a un año', b: pct(result.simulation.before.var95Pct, 2), a: pct(result.simulation.after.var95Pct, 2), d: signed(result.simulation.delta.var95Pp, 2, ' pp') },
                      { label: 'Concentración (HHI)', b: result.simulation.before.hhi.toFixed(3), a: result.simulation.after.hhi.toFixed(3), d: signed(result.simulation.delta.hhi, 3) },
                      { label: 'Mayor peso', b: pct(Math.max(...Object.values(result.simulation.before.weights)) * 100), a: pct(Math.max(...Object.values(result.simulation.after.weights)) * 100), d: '' },
                    ].map((row) => (
                      <tr key={row.label} className="border-t border-border">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">{row.label}</th>
                        <td className="py-2 pr-3 text-right font-financial">{row.b}</td>
                        <td className="py-2 pr-3 text-right font-financial">{row.a}</td>
                        <td className="py-2 text-right font-financial">{row.d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">{result.simulation.summary}</p>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Simulación con los datos del {inputs.window.from} al {inputs.window.to}. El rendimiento esperado es la media
        histórica del periodo, la entrada menos confiable del modelo. No incluye comisiones, spreads ni impuestos, y
        nada de lo que ves aquí se ejecuta.
        {inputs.unconverted.length > 0 ? ` No se pudo convertir a ${inputs.currency} ${inputs.unconverted.join(', ')}.` : ''}
      </p>
    </div>
  )
}

export function RebalancePanel({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading, error } = useRebalanceInputs(portfolioId)
  const { data: portfolio } = usePortfolio(portfolioId)
  const costModel = costModelFrom(portfolio?.cost_model)

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Rebalanceo</CardTitle>
        <CardDescription>
          Qué haría falta para volver a unos pesos objetivo, cuándo conviene hacerlo según cuatro criterios, y qué le
          pasaría al riesgo y al rendimiento esperado antes de decidir nada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo preparar la simulación de rebalanceo.</p>
        ) : !data || 'message' in data ? (
          <p className="text-sm text-muted-foreground">{data && 'message' in data ? data.message : 'Sin datos suficientes.'}</p>
        ) : (
          <>
            <Panel inputs={data} portfolioId={portfolioId} costModel={costModel} />
            <AuditTrail meta={data._meta} className="mt-3" />
          </>
        )}
      </CardContent>
    </Card>
  )
}
