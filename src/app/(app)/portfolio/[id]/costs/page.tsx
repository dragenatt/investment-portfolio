'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { buttonVariants } from '@/components/ui/button-variants'
import { usePortfolio } from '@/lib/hooks/use-portfolios'
import { useReturns } from '@/lib/hooks/use-analytics'
import { CostModelSchema } from '@/lib/schemas/portfolio'
import {
  annualDrag,
  applyCostsToReturn,
  costModelFrom,
  describeCostModel,
  isCostModelConfigured,
  DEFAULT_COST_MODEL,
  type CostModel,
} from '@/lib/services/costs'

// 4.6. costs.ts could take a return from gross to net, and nothing could tell
// it what a portfolio pays: the scenario engine ran on an all-zero model. This
// is where the user states their costs — and only the user: every field starts
// empty, because an invented "typical" commission would make every net figure
// in the app fiction.

type Draft = Record<'commissionPct' | 'commissionMin' | 'spreadPct' | 'custodyAnnualPct' | 'capitalGainsTaxPct' | 'source', string>

const FIELDS: Array<{ key: Exclude<keyof Draft, 'source'>; label: string; hint: string }> = [
  { key: 'commissionPct', label: 'Comisión por operación (%)', hint: 'Lo que cobra tu broker por cada compra o venta, como porcentaje del monto.' },
  { key: 'commissionMin', label: 'Comisión mínima por operación', hint: 'En la moneda de la cuenta. Déjalo vacío si tu broker no tiene mínimo.' },
  { key: 'spreadPct', label: 'Spread (%)', hint: 'La mitad de la diferencia entre precio de compra y de venta; se paga al entrar y al salir.' },
  { key: 'custodyAnnualPct', label: 'Custodia o administración anual (%)', hint: 'Cuota anual sobre el valor del portafolio (incluye comisiones de fondos o ETFs si las quieres contar aquí).' },
  { key: 'capitalGainsTaxPct', label: 'Impuesto sobre ganancias (%)', hint: 'La tasa que pagas sobre la ganancia realizada. Solo se aplica a años con ganancia.' },
]

const EXAMPLE_CAPITAL = 100_000

function draftFrom(model: CostModel | null): Draft {
  const s = (v: number | undefined) => (v === undefined || v === 0 ? '' : String(v))
  return {
    commissionPct: s(model?.commissionPct),
    commissionMin: s(model?.commissionMin),
    spreadPct: s(model?.spreadPct),
    custodyAnnualPct: s(model?.custodyAnnualPct),
    capitalGainsTaxPct: s(model?.capitalGainsTaxPct),
    source: model?.source ?? '',
  }
}

/** Empty means zero — the user has not stated a cost, so none is charged. */
const value = (v: string) => (v.trim() === '' ? 0 : Number(v))

export default function PortfolioCostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: portfolio, isLoading, mutate } = usePortfolio(id)
  const { data: returns } = useReturns(id)

  const stored = costModelFrom(portfolio?.cost_model)
  const currency: string = portfolio?.base_currency ?? 'MXN'
  const money = useMemo(() => new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }), [currency])

  const [draft, setDraft] = useState<Draft>(draftFrom(null))
  const [saving, setSaving] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  useEffect(() => {
    // Seed the form once the stored model arrives; later edits are the user's.
    const key = JSON.stringify(portfolio?.cost_model ?? null)
    if (portfolio && loadedFor !== key) {
      setDraft(draftFrom(stored))
      setLoadedFor(key)
    }
  }, [portfolio, stored, loadedFor])

  // What is being edited, as a model — or the reason it is not one yet. The
  // figures alone are enough to preview gross against net; saving also needs
  // the source.
  const candidate = useMemo(() => {
    const numbers = FIELDS.map((f) => value(draft[f.key]))
    if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return { error: 'Cada costo debe ser un número mayor o igual a cero.' }
    const charges = numbers.some((n) => n > 0)
    const parsed = CostModelSchema.safeParse({
      commissionPct: value(draft.commissionPct),
      commissionMin: draft.commissionMin.trim() === '' ? undefined : value(draft.commissionMin),
      spreadPct: value(draft.spreadPct),
      custodyAnnualPct: value(draft.custodyAnnualPct),
      capitalGainsTaxPct: value(draft.capitalGainsTaxPct),
      source: draft.source.trim() || (charges ? 'Vista previa' : 'Sin costos'),
    })
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Revisa las cifras.' }
    const missingSource = charges && draft.source.trim() === ''
    return { model: parsed.data as CostModel, charges, missingSource }
  }, [draft])

  // Gross vs net, on the model being edited. The portfolio's own 12-month TWR
  // seeds it only when there is a year behind it: over a few days a TWR is not
  // an annual return, and presenting it as one would be the fabrication this
  // page exists to avoid.
  const twr = returns?.summary?.twr ?? null
  const returnsWindow = returns?._meta?.period
  const windowDays =
    returnsWindow?.from && returnsWindow?.to ? (Date.parse(returnsWindow.to) - Date.parse(returnsWindow.from)) / 86_400_000 : 0
  const yearOfHistory = windowDays >= 330
  const [grossInput, setGrossInput] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [roundTrips, setRoundTrips] = useState('1')
  useEffect(() => {
    if (!seeded && yearOfHistory && twr !== null && Number.isFinite(twr)) {
      setGrossInput(twr.toFixed(2))
      setSeeded(true)
    }
  }, [twr, yearOfHistory, seeded])

  const comparison = useMemo(() => {
    if ('error' in candidate) return null
    const gross = Number(grossInput)
    const trips = Number(roundTrips)
    if (grossInput.trim() === '' || !Number.isFinite(gross) || !Number.isFinite(trips) || trips < 0) return null
    const model = candidate.charges ? candidate.model : DEFAULT_COST_MODEL
    const net = applyCostsToReturn(gross, trips, model)
    if (!net) return null
    return {
      net,
      ten: annualDrag(EXAMPLE_CAPITAL, gross, net.netReturnPct, 10),
      twenty: annualDrag(EXAMPLE_CAPITAL, gross, net.netReturnPct, 20),
    }
  }, [candidate, grossInput, roundTrips])

  async function save(model: CostModel | null) {
    setSaving(true)
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost_model: model }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.error ?? 'No se pudo guardar')
      await mutate()
      toast.success(model ? 'Costos guardados' : 'Costos quitados: los rendimientos vuelven a mostrarse brutos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const input = 'mt-1 block w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm font-financial'
  const pp = (v: number) => `${v.toFixed(2)}%`

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href={`/portfolio/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4 mr-1" /> Volver
        </Link>
        <h1 className="text-2xl font-bold">Costos del portafolio</h1>
      </div>

      {isLoading ? (
        <SkeletonCard />
      ) : (
        <>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Lo que pagas</CardTitle>
              <CardDescription>
                Nada viene lleno: sin tus cifras, todo rendimiento se muestra bruto y lo dice. Con ellas, las proyecciones del
                motor de escenarios descuentan comisión, spread y custodia, y el plan de rebalanceo muestra lo que costaría
                ejecutarlo. El impuesto se refleja en la comparación de abajo; el motor de escenarios todavía no lo simula.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  if ('error' in candidate || candidate.missingSource) return
                  void save(candidate.charges ? candidate.model : null)
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="text-sm">
                      {f.label}
                      <input
                        inputMode="decimal"
                        className={input}
                        value={draft[f.key]}
                        placeholder="0"
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        aria-describedby={`${f.key}-hint`}
                      />
                      <span id={`${f.key}-hint`} className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>
                    </label>
                  ))}
                  <label className="text-sm sm:col-span-2">
                    Fuente de estas cifras
                    <input
                      className="mt-1 block w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
                      value={draft.source}
                      placeholder="Ej.: tarifario de mi broker, 2026"
                      onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">Obligatoria si capturas algún costo: un rendimiento neto dice sobre qué cifras descansa.</span>
                  </label>
                </div>

                {'error' in candidate && <p role="alert" className="text-sm text-loss">{candidate.error}</p>}
                {'missingSource' in candidate && candidate.missingSource && (
                  <p role="alert" className="text-sm text-loss">Indica de dónde salen estas cifras (tu broker, tu contrato) para guardarlas.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={saving || 'error' in candidate || candidate.missingSource}
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Guardar costos
                  </button>
                  {isCostModelConfigured(stored) && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save(null)}
                      className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
                    >
                      Quitar costos
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Guardado: {describeCostModel(stored ?? DEFAULT_COST_MODEL)}
                </p>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Rendimiento bruto contra neto</CardTitle>
              <CardDescription>
                Con los costos de arriba (aunque aún no los guardes).{' '}
                {yearOfHistory
                  ? 'El bruto viene del rendimiento ponderado en el tiempo de los últimos 12 meses del portafolio; cámbialo para probar otro.'
                  : 'El portafolio todavía no tiene un año de historia, así que no hay un rendimiento anual propio que usar: captura uno para probar.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Rendimiento bruto anual (%)
                  <input inputMode="decimal" className={input} value={grossInput} onChange={(e) => setGrossInput(e.target.value)} />
                </label>
                <label className="text-sm">
                  Compras y ventas completas al año
                  <input inputMode="decimal" className={input} value={roundTrips} onChange={(e) => setRoundTrips(e.target.value)} />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Cuántas veces al año se compra y vende todo el portafolio: 0 si compras y mantienes, 1 con un rebalanceo
                    completo al año.
                  </span>
                </label>
              </div>

              {!comparison ? (
                <p className="text-sm text-muted-foreground">Captura un rendimiento bruto para ver la comparación.</p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <caption className="sr-only">Del rendimiento bruto al neto</caption>
                    <tbody>
                      {(
                        [
                          ['Rendimiento bruto', pp(comparison.net.grossReturnPct), false],
                          ['− Comisiones y spread', pp(comparison.net.breakdown.tradingPct), false],
                          ['− Custodia', pp(comparison.net.breakdown.custodyPct), false],
                          ['− Impuestos sobre la ganancia', pp(comparison.net.breakdown.taxPct), false],
                          ['Rendimiento neto', pp(comparison.net.netReturnPct), true],
                        ] as Array<[string, string, boolean]>
                      ).map(([label, v, strong]) => (
                        <tr key={label} className="border-t border-border">
                          <th scope="row" className={strong ? 'py-2 text-left font-medium' : 'py-2 text-left font-normal text-muted-foreground'}>{label}</th>
                          <td className={strong ? 'py-2 text-right font-financial font-medium' : 'py-2 text-right font-financial'}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {comparison.ten && comparison.twenty && comparison.net.totalDragPct > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 text-sm">
                      {[['10 años', comparison.ten], ['20 años', comparison.twenty]].map(([label, drag]) => {
                        const d = drag as NonNullable<typeof comparison.ten>
                        return (
                          <div key={label as string} className="rounded-xl border border-border p-3">
                            <p className="text-xs text-muted-foreground">
                              Cada <span className="font-financial">{money.format(EXAMPLE_CAPITAL)}</span> invertidos, a {label as string}
                            </p>
                            <p>
                              Bruto <span className="font-financial">{money.format(d.grossValue)}</span> · neto{' '}
                              <span className="font-financial">{money.format(d.netValue)}</span>
                            </p>
                            <p className="text-loss">
                              Los costos se llevan <span className="font-financial">{money.format(d.costOfCosts)}</span>
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {comparison.twenty && comparison.net.totalDragPct > 0 && (
                    <p className="text-xs text-muted-foreground">{comparison.twenty.explanation}</p>
                  )}
                  {'charges' in candidate && !candidate.charges && (
                    <p className="text-xs text-muted-foreground">Sin costos capturados, bruto y neto son lo mismo.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
