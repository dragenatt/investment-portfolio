'use client'

import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { RotateCcw, FlaskConical, BookOpen } from 'lucide-react'
import { formatByUnit } from '@/lib/utils/lab-format'
import type { LabCatalogueEntry, ExperimentResult, ParamSpec } from '@/lib/hooks/use-lab'
import { ExperimentChart } from '@/components/charts/lazy-charts'

/**
 * One experiment, laid out as the seven steps E1 names, in order.
 *
 * Steps 1, 2, 6 and 7 are teaching; steps 4 and 5 are what a model computed
 * from assumptions the reader chose. They are labelled differently on purpose:
 * the same rule D3 applied to the advisor — a model result and an explanation
 * of it are different claims, and blending them is how a number from a toy
 * starts reading as a fact about markets.
 */
export function ExperimentView({
  experiment,
  values,
  onChange,
  onReset,
  result,
  isLoading,
  error,
}: {
  experiment: LabCatalogueEntry
  values: Record<string, number>
  onChange: (key: string, value: number) => void
  onReset: () => void
  result: ExperimentResult | null
  isLoading: boolean
  error: string | null
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{experiment.title}</h2>
      </div>

      <Step n={1} title="Objetivo" kind="teaching">
        <p className="text-sm text-foreground leading-relaxed">{experiment.objective}</p>
      </Step>

      <Step n={2} title="Concepto financiero" kind="teaching">
        <p className="text-sm text-muted-foreground leading-relaxed">{experiment.concept}</p>
      </Step>

      <Step
        n={3}
        title="Parametros"
        kind="inputs"
        action={
          <Button variant="ghost" size="sm" onClick={onReset} className="h-7 text-xs gap-1.5">
            <RotateCcw className="h-3 w-3" />
            Restablecer
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {experiment.params.map((spec) => (
            <ParamSlider
              key={spec.key}
              spec={spec}
              value={values[spec.key] ?? spec.default}
              onChange={(value) => onChange(spec.key, value)}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Estos valores son supuestos que eliges tu. No son datos de mercado ni de tu cartera.
        </p>
      </Step>

      <Step n={4} title="Simulacion" kind="model">
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{experiment.simulation}</p>
        {error ? (
          <p className="text-sm text-loss">No se pudo correr el experimento: {error}</p>
        ) : result ? (
          <div className={cn('transition-opacity', isLoading && 'opacity-60')}>
            <ExperimentChart chart={result.chart} series={result.series} />
          </div>
        ) : (
          <div className="h-[280px] rounded-xl bg-muted/40 animate-pulse" />
        )}
      </Step>

      <Step n={5} title="Resultado" kind="model">
        {result ? (
          <dl className={cn('grid gap-3 grid-cols-2 lg:grid-cols-3', isLoading && 'opacity-60')}>
            {result.highlights.map((highlight) => (
              <div key={highlight.label} className="rounded-xl border border-border p-3">
                <dt className="text-[11px] text-muted-foreground leading-snug">{highlight.label}</dt>
                <dd className="mt-1 text-sm font-mono font-semibold text-foreground">{highlight.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="h-16 rounded-xl bg-muted/40 animate-pulse" />
        )}
      </Step>

      <Step n={6} title="Interpretacion" kind="teaching">
        {result ? (
          <p className={cn('text-sm text-foreground leading-relaxed', isLoading && 'opacity-60')}>
            {result.interpretation}
          </p>
        ) : (
          <div className="h-12 rounded-xl bg-muted/40 animate-pulse" />
        )}
      </Step>

      <Step n={7} title="Preguntas para reflexion" kind="teaching">
        <ol className="space-y-2 list-decimal pl-4">
          {experiment.questions.map((question) => (
            <li key={question} className="text-sm text-muted-foreground leading-relaxed">
              {question}
            </li>
          ))}
        </ol>
      </Step>
    </div>
  )
}

const KIND_LABEL = {
  teaching: { text: 'Explicacion educativa', icon: BookOpen },
  inputs: { text: 'Tus supuestos', icon: null },
  model: { text: 'Resultado del modelo', icon: FlaskConical },
} as const

function Step({
  n,
  title,
  kind,
  action,
  children,
}: {
  n: number
  title: string
  kind: keyof typeof KIND_LABEL
  action?: ReactNode
  children: ReactNode
}) {
  const label = KIND_LABEL[kind]
  const Icon = label.icon
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {n}
            </span>
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-[10px] uppercase tracking-wide flex items-center gap-1',
                kind === 'model' ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {Icon && <Icon className="h-3 w-3" />}
              {label.text}
            </span>
            {action}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function ParamSlider({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec
  value: number
  onChange: (value: number) => void
}) {
  const id = `param-${spec.key}`
  const decimals = spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0
  const shown =
    spec.unit === 'percent' ? formatByUnit(value, 'percent', decimals) : formatByUnit(value, spec.unit, decimals)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {spec.label}
        </label>
        <span className="text-xs font-mono font-semibold text-foreground tabular-nums">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{formatByUnit(spec.min, spec.unit, decimals)}</span>
        <span>{formatByUnit(spec.max, spec.unit, decimals)}</span>
      </div>
    </div>
  )
}
