'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLabCatalogue, useLabRun } from '@/lib/hooks/use-lab'
import { ExperimentView } from '@/components/lab/experiment-view'
import type { ExperimentId } from '@/lib/services/lab'

/**
 * The Financial Laboratory (E1).
 *
 * The selected experiment lives in the URL (?e=volatility) so a lesson can be
 * linked to directly. Slider values do not: they are an exploration, and a link
 * should open an experiment at its defaults rather than at wherever someone
 * happened to leave the sliders.
 */
export default function LabPage() {
  return (
    // useSearchParams needs a Suspense boundary to prerender.
    <Suspense fallback={<LabSkeleton />}>
      <Lab />
    </Suspense>
  )
}

function Lab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: catalogue, error: catalogueError, isLoading } = useLabCatalogue()

  const requested = searchParams.get('e')
  const selected = useMemo(() => {
    if (!catalogue?.length) return null
    return (
      catalogue.find((e) => e.id === requested && e.available) ??
      catalogue.find((e) => e.available) ??
      null
    )
  }, [catalogue, requested])

  // Values per experiment, so switching away and back keeps what you had set.
  const [valuesById, setValuesById] = useState<Record<string, Record<string, number>>>({})
  const values = selected ? (valuesById[selected.id] ?? selected.defaults) : null

  const run = useLabRun(selected?.id ?? null, values)

  // Keep the scroll position sensible on a switch: the view is long.
  useEffect(() => {
    if (requested) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [requested])

  const select = (id: ExperimentId) => {
    router.replace(`/lab?e=${id}`, { scroll: false })
  }

  if (isLoading) return <LabSkeleton />

  if (catalogueError || !catalogue) {
    return (
      <div className="text-sm text-loss">
        No se pudo cargar el laboratorio{catalogueError ? `: ${catalogueError.message}` : '.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-primary" />
          Laboratorio financiero
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Experimentos para ver como funciona invertir, con supuestos que tu controlas. Nada de
          lo que ves aqui es tu cartera ni un pronostico: son modelos simplificados para que la
          forma de cada relacion se vuelva evidente.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Experimentos" className="lg:sticky lg:top-4 lg:self-start">
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {catalogue.map((experiment, index) => {
              const active = experiment.id === selected?.id
              return (
                <li key={experiment.id} className="shrink-0">
                  <button
                    type="button"
                    disabled={!experiment.available}
                    onClick={() => select(experiment.id)}
                    title={experiment.unavailableReason ?? experiment.objective}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap lg:whitespace-normal',
                      active
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-foreground/70 hover:bg-secondary',
                      !experiment.available && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground tabular-nums mr-2">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {experiment.title}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <section className="min-w-0" aria-label="Experimento">
          {selected && values ? (
            <ExperimentView
              experiment={selected}
              values={values}
              onChange={(key, value) =>
                setValuesById((current) => ({
                  ...current,
                  [selected.id]: { ...(current[selected.id] ?? selected.defaults), [key]: value },
                }))
              }
              onReset={() =>
                setValuesById((current) => {
                  const next = { ...current }
                  delete next[selected.id]
                  return next
                })
              }
              // keepPreviousData holds the last result while the next loads, which
              // is right for a slider and wrong for a switch: without this check
              // the volatility chart sat under the "Diversificacion" title until
              // the new run arrived.
              result={run.data?.id === selected.id ? (run.data.result ?? null) : null}
              isLoading={run.isValidating}
              error={run.error ? String(run.error.message ?? run.error) : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay experimentos disponibles en este momento.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function LabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 rounded-lg bg-muted/40 animate-pulse" />
      <div className="h-4 w-full max-w-2xl rounded bg-muted/40 animate-pulse" />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="h-96 rounded-xl bg-muted/40 animate-pulse" />
        <div className="h-96 rounded-xl bg-muted/40 animate-pulse" />
      </div>
    </div>
  )
}
