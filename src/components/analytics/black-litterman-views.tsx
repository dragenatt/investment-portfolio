'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ModelComparison } from '@/components/charts/lazy-charts'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { useOptimizationWithViews, type OptimizationData } from '@/lib/hooks/use-analytics'
import type { ViewInput } from '@/lib/services/black-litterman'
import type { BlackLittermanDetail } from '@/lib/services/model-comparison'
import { cn } from '@/lib/utils'

// 4.7. blackLitterman took opinions — views, each with its own confidence —
// and the model comparison always ran it with none, so it could only ever hand
// the current book back. This is where the reader states an opinion and sees
// what it does: to the returns the model expects, to the weights, and to the
// comparison with the other four models.

const MAX_VIEWS = 5

const KINDS: Array<{ value: ViewInput['kind']; label: string }> = [
  { value: 'vsEquilibrium', label: 'rendirá más (o menos) que lo que el mercado implica' },
  { value: 'outperform', label: 'superará a otro activo' },
  { value: 'absolute', label: 'rendirá un porcentaje al año' },
]

const CONFIDENCE: Array<{ value: number; label: string }> = [
  { value: 25, label: 'Baja (25%)' },
  { value: 50, label: 'Media (50%)' },
  { value: 75, label: 'Alta (75%)' },
  { value: 90, label: 'Muy alta (90%)' },
]

type Draft = { kind: ViewInput['kind']; symbol: string; other: string; pct: string; confidencePct: number }

const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`
const pp = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} pp`

/** The drafts as opinions, or the first reason one is not. */
function parse(drafts: Draft[]): ViewInput[] | string {
  const out: ViewInput[] = []
  for (const [i, d] of drafts.entries()) {
    const value = Number(d.pct)
    if (d.pct.trim() === '' || !Number.isFinite(value)) return `Opinión ${i + 1}: escribe cuántos puntos.`
    if (d.kind === 'outperform' && (!d.other || d.other === d.symbol)) return `Opinión ${i + 1}: elige otro activo para comparar.`
    out.push({ kind: d.kind, symbol: d.symbol, ...(d.kind === 'outperform' ? { other: d.other } : {}), pct: value, confidencePct: d.confidencePct })
  }
  return out
}

/**
 * The model comparison, with the reader's opinions applied to Black-Litterman
 * when there are any. Without opinions it shows the background job's result.
 */
export function ModelComparisonWithViews({
  pid,
  data,
  isLoading,
}: {
  pid: string
  data: OptimizationData | undefined
  isLoading: boolean
}) {
  const [applied, setApplied] = useState<ViewInput[]>([])
  const withViews = useOptimizationWithViews(pid, applied)
  const shown = applied.length > 0 && withViews.data ? withViews.data : data

  return (
    <div className="space-y-4">
      <ModelComparison data={shown?.model_comparison} isLoading={isLoading || (applied.length > 0 && withViews.isLoading && !withViews.data)} />
      <BlackLittermanViews
        symbols={data?.symbols ?? []}
        detail={shown?.model_comparison?.blackLitterman ?? null}
        applied={applied}
        onApply={setApplied}
        pending={applied.length > 0 && withViews.isValidating}
        failed={applied.length > 0 && !!withViews.error}
      />
      <AuditTrail meta={shown?._meta} className="mt-2" />
    </div>
  )
}

function BlackLittermanViews({
  symbols,
  detail,
  applied,
  onApply,
  pending,
  failed,
}: {
  symbols: string[]
  detail: BlackLittermanDetail | null
  applied: ViewInput[]
  onApply: (views: ViewInput[]) => void
  pending: boolean
  failed: boolean
}) {
  const blank = (): Draft => ({ kind: 'vsEquilibrium', symbol: symbols[0] ?? '', other: symbols[1] ?? '', pct: '', confidencePct: 50 })
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  if (symbols.length < 2) return null

  const update = (i: number, patch: Partial<Draft>) => setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const field = 'rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm'

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Tus opiniones en Black-Litterman</CardTitle>
        <CardDescription>
          Black-Litterman parte de lo que tus pesos actuales implican que crees (el equilibrio) y se mueve hacia tus
          opiniones en proporción a la confianza que les des. Sin opiniones te devuelve tu propia cartera: ese es su punto
          de partida, no un error.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            const parsed = parse(drafts)
            if (typeof parsed === 'string') return setProblem(parsed)
            setProblem(null)
            onApply(parsed)
          }}
        >
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">Sin opiniones: el modelo usa solo el equilibrio.</p>}
          {drafts.map((d, i) => (
            <fieldset key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-xs text-muted-foreground">Opinión {i + 1}</legend>
              <label className="text-xs text-muted-foreground">
                Creo que
                <select className={cn(field, 'mt-1 block')} value={d.symbol} onChange={(e) => update(i, { symbol: e.target.value })}>
                  {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                <span className="sr-only">Tipo de opinión</span>
                <select className={cn(field, 'mt-1 block')} value={d.kind} onChange={(e) => update(i, { kind: e.target.value as ViewInput['kind'] })}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              {d.kind === 'outperform' && (
                <label className="text-xs text-muted-foreground">
                  a
                  <select className={cn(field, 'mt-1 block')} value={d.other} onChange={(e) => update(i, { other: e.target.value })}>
                    {symbols.filter((s) => s !== d.symbol).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
              <label className="text-xs text-muted-foreground">
                {d.kind === 'absolute' ? '% al año' : 'por (puntos al año)'}
                <input
                  inputMode="decimal"
                  className={cn(field, 'mt-1 block w-24 font-financial')}
                  value={d.pct}
                  placeholder={d.kind === 'absolute' ? '8' : '2'}
                  onChange={(e) => update(i, { pct: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Confianza
                <select className={cn(field, 'mt-1 block')} value={d.confidencePct} onChange={(e) => update(i, { confidencePct: Number(e.target.value) })}>
                  {CONFIDENCE.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}
                className="mb-1 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={`Quitar la opinión ${i + 1}`}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </fieldset>
          ))}
          {problem && <p role="alert" className="text-sm text-loss">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            {drafts.length < MAX_VIEWS && (
              <button type="button" onClick={() => setDrafts((all) => [...all, blank()])} className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary">
                <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Agregar opinión
              </button>
            )}
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {drafts.length === 0 ? 'Usar solo el equilibrio' : 'Aplicar opiniones'}
            </button>
          </div>
        </form>

        {failed ? (
          <p className="text-sm text-muted-foreground">No se pudo recalcular con tus opiniones.</p>
        ) : pending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">Recalculando los cinco modelos con tus opiniones…</p>
        ) : detail ? (
          <div className="space-y-3" aria-live="polite">
            {applied.length > 0 && detail.views.length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {detail.views.map((v) => <li key={v}>{v}</li>)}
              </ul>
            )}
            {detail.rejected.length > 0 && (
              <ul className="text-sm text-loss" role="alert">
                {detail.rejected.map((r) => <li key={r.index}>No se aplicó «{r.view}»: {r.reason}</li>)}
              </ul>
            )}
            <p className="text-sm">{detail.summary}</p>
            {detail.notes.map((note) => (
              <p key={note} className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">{note}</p>
            ))}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Pesos y rendimientos del equilibrio frente a los que resultan de tus opiniones</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Activo</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Rend. implícito</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Rend. con tus opiniones</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Peso de equilibrio</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Peso con tus opiniones</th>
                    <th scope="col" className="py-2 font-medium text-right">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.weightShifts.map((s) => {
                    const r = detail.returns.find((x) => x.symbol === s.symbol)
                    return (
                      <tr key={s.symbol} className="border-t border-border">
                        <th scope="row" className="py-2 pr-3 text-left font-mono font-normal">{s.symbol}</th>
                        <td className="py-2 pr-3 text-right font-financial">{r ? pct(r.equilibriumPct, 2) : '—'}</td>
                        <td className="py-2 pr-3 text-right font-financial">{r ? pct(r.posteriorPct, 2) : '—'}</td>
                        <td className="py-2 pr-3 text-right font-financial">{pct(s.markowitzWeight * 100)}</td>
                        <td className="py-2 pr-3 text-right font-financial">{pct(s.blackLittermanWeight * 100)}</td>
                        <td className={cn('py-2 text-right font-financial', Math.abs(s.deltaPp) >= 1 ? 'text-foreground' : 'text-muted-foreground')}>{pp(s.deltaPp)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              El rendimiento implícito es el que tendrías que estar esperando para que tus pesos actuales fueran los óptimos;
              no es una predicción ni la cartera de mercado por capitalización. {detail.caveat}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
