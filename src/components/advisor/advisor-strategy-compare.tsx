'use client'

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  compararEstrategias,
  type EstrategiaOpcion,
  type PlanParams,
  type ScenarioSet,
} from '@/lib/services/advisor'

// 4.6 / P1-5. compararEstrategias scored several contribution-and-horizon
// options against the same goal and the same simulated shocks, and no screen
// asked it anything. Two or three options side by side, and — deliberately —
// no column marked as the answer: fifteen years at one amount and ten at a
// higher one are different lives, not two attempts at one number.

const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })

type Draft = { aportacionMensual: string; años: string; capitalInicial: string }

const MAX_OPTIONS = 3
const MAX_YEARS = 50

function draftFrom(option: { aportacionMensual: number; años: number; capitalInicial: number }): Draft {
  return {
    aportacionMensual: String(Math.round(option.aportacionMensual)),
    años: String(option.años),
    capitalInicial: String(Math.round(option.capitalInicial)),
  }
}

/** A draft as an option, or the reason it is not one. */
function parse(draft: Draft): EstrategiaOpcion | string {
  const aportacion = Number(draft.aportacionMensual)
  const años = Number(draft.años)
  const capital = Number(draft.capitalInicial)
  if (!Number.isFinite(aportacion) || aportacion < 0) return 'La aportación debe ser un número mayor o igual a cero.'
  if (!Number.isInteger(años) || años < 1 || años > MAX_YEARS) return `El horizonte debe ser de 1 a ${MAX_YEARS} años.`
  if (!Number.isFinite(capital) || capital < 0) return 'El capital inicial debe ser un número mayor o igual a cero.'
  return { aportacionMensual: aportacion, años, capitalInicial: capital }
}

export function ComparadorEstrategias({
  params,
  meta,
  scenarios,
  ingresoMensual,
  aporteNecesario,
}: {
  params: PlanParams
  meta: number
  scenarios: ScenarioSet
  ingresoMensual: number | null
  aporteNecesario: number | null
}) {
  // Starting points, not suggestions: the plan as entered, the contribution the
  // advisor solved for (or half again more), and the same money for five more
  // years. The reader edits any of them.
  const [drafts, setDrafts] = useState<Draft[]>(() => [
    draftFrom({ ...params }),
    draftFrom({ ...params, aportacionMensual: aporteNecesario && aporteNecesario > 0 ? aporteNecesario : params.aportacionMensual * 1.5 }),
    draftFrom({ ...params, años: Math.min(MAX_YEARS, params.años + 5) }),
  ])
  const [committed, setCommitted] = useState<Draft[]>(drafts)

  const parsed = committed.map(parse)
  const problems = parsed.filter((p): p is string => typeof p === 'string')
  const comparison = useMemo(() => {
    const options = committed.map(parse)
    if (options.some((o) => typeof o === 'string')) return null
    return compararEstrategias(params, meta, options as EstrategiaOpcion[], scenarios, {
      ingresoMensual: ingresoMensual ?? undefined,
    })
  }, [committed, params, meta, scenarios, ingresoMensual])

  const update = (i: number, field: keyof Draft, value: string) =>
    setDrafts((current) => current.map((d, j) => (j === i ? { ...d, [field]: value } : d)))

  const rows: Array<{ label: string; cell: (o: NonNullable<typeof comparison>['opciones'][number]) => string }> = [
    { label: 'Aportación mensual', cell: (o) => fmt.format(o.aportacionMensual) },
    { label: 'Horizonte', cell: (o) => `${o.años} años` },
    { label: 'Capital inicial', cell: (o) => fmt.format(o.capitalInicial) },
    { label: 'Rendimiento supuesto', cell: (o) => `${(o.rendimientoAnual * 100).toFixed(1)}% anual` },
    { label: 'Total aportado de tu bolsillo', cell: (o) => fmt.format(o.totalAportado) },
    { label: 'Probabilidad de llegar a la meta', cell: (o) => `${o.probabilidadPct.toFixed(0)}%` },
    { label: 'Valor esperado (media)', cell: (o) => fmt.format(o.valorEsperado) },
    { label: 'Mediana', cell: (o) => fmt.format(o.mediana) },
    { label: 'Escenario bajo (P10)', cell: (o) => fmt.format(o.downsideP10) },
    { label: 'Esfuerzo de ahorro', cell: (o) => (o.esfuerzoAhorroPct === null ? '—' : `${o.esfuerzoAhorroPct.toFixed(0)}% del ingreso`) },
  ]

  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4" aria-labelledby="comparador-titulo">
      <div className="space-y-1">
        <h3 id="comparador-titulo" className="font-semibold">Compara estrategias para la misma meta</h3>
        <p className="text-sm text-muted-foreground">
          Arma hasta tres combinaciones de aportación, horizonte y capital. Todas se simulan sobre los mismos escenarios
          de mercado que tu plan, así que las diferencias vienen de lo que cambiaste, no del azar.
        </p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setCommitted(drafts)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {drafts.map((draft, i) => (
            <fieldset key={i} className="rounded-xl border border-border p-3 space-y-2">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Opción {String.fromCharCode(65 + i)}</legend>
              {(
                [
                  ['aportacionMensual', 'Aportación mensual'],
                  ['años', 'Años'],
                  ['capitalInicial', 'Capital inicial'],
                ] as Array<[keyof Draft, string]>
              ).map(([field, label]) => (
                <label key={field} className="block text-xs text-muted-foreground">
                  {label}
                  <input
                    inputMode="decimal"
                    className="mt-1 block w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm text-foreground font-financial"
                    value={draft[field]}
                    onChange={(e) => update(i, field, e.target.value)}
                  />
                </label>
              ))}
              {drafts.length > 2 && (
                <button
                  type="button"
                  onClick={() => setDrafts((current) => current.filter((_, j) => j !== i))}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3 w-3" /> Quitar opción
                </button>
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Comparar
          </button>
          {drafts.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => setDrafts((current) => [...current, draftFrom({ ...params })])}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Agregar opción
            </button>
          )}
        </div>
      </form>

      {problems.length > 0 ? (
        <ul className="text-sm text-loss list-disc pl-5" role="alert">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : comparison ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Comparación de estrategias para una meta de {fmt.format(meta)}; ninguna se marca como la mejor
              </caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium"><span className="sr-only">Medida</span></th>
                  {comparison.opciones.map((_, i) => (
                    <th key={i} scope="col" className="py-2 pr-3 font-medium text-right">Opción {String.fromCharCode(65 + i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">{row.label}</th>
                    {comparison.opciones.map((o, i) => (
                      <td key={i} className="py-2 pr-3 text-right font-financial">{row.cell(o)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {comparison.opciones.map((o, i) => (
              <li key={i}>
                <span className="font-medium text-foreground">Opción {String.fromCharCode(65 + i)}:</span> {o.resumen}
              </li>
            ))}
          </ul>
          <p className="text-sm">{comparison.nota}</p>
          {ingresoMensual === null && (
            <p className="text-xs text-muted-foreground">El esfuerzo de ahorro se muestra cuando indicas tu ingreso mensual.</p>
          )}
        </>
      ) : null}
    </section>
  )
}
