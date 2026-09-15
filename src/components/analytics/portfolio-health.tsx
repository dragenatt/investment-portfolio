'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { useHealth } from '@/lib/hooks/use-analytics'
import type { HealthComponent } from '@/lib/services/portfolio-health'

/**
 * Portfolio Health (P2-7): an educational grade with every part of it visible.
 *
 * The number comes last in importance and first on screen, so it is followed
 * immediately by what produced it: each component with its own score, what
 * was measured, the threshold it was graded against and where that threshold
 * comes from. A score nobody can take apart is an opinion.
 */

function ScoreBar({ score }: { score: number }) {
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-label={`${score} de 100`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
    </div>
  )
}

function ComponentRow({ component }: { component: HealthComponent }) {
  const measured = component.score !== null
  return (
    <li className="space-y-1.5 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{component.name}</span>
        <span className="font-financial text-sm">
          {measured ? (
            <>
              <span className="font-medium text-foreground">{component.score}</span>
              <span className="text-muted-foreground"> / 100</span>
            </>
          ) : (
            <span className="text-muted-foreground">Sin datos</span>
          )}
        </span>
      </div>
      {measured && <ScoreBar score={component.score!} />}
      <p className="text-xs text-muted-foreground">{measured ? component.measured : component.unavailableReason}</p>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">Cómo se califica</summary>
        <p className="mt-1">{component.threshold}</p>
        <p className="mt-1">{component.basis}</p>
      </details>
    </li>
  )
}

export function PortfolioHealth({ portfolioId }: { portfolioId: string }) {
  const { data, error, isLoading, mutate } = useHealth(portfolioId)

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-sm font-medium">Portfolio Health</CardTitle>
        <CardDescription className="text-xs">
          Qué tan bien construido está el portafolio en nueve aspectos, con lo que se midió en cada uno. Es educativo:
          no es una recomendación de compra o venta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && !data ? (
          <ChartLoading height={180} label="Calculando la salud del portafolio…" />
        ) : error && !data ? (
          <ChartEmpty height={180} kind="error" message="No se pudo calcular la salud del portafolio." onRetry={() => mutate()} />
        ) : data?.message || !data?.components ? (
          <ChartEmpty height={180} message={data?.message ?? 'No hay suficiente historial para calcular la salud del portafolio.'} />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              {data.score !== null && data.score !== undefined ? (
                <p className="font-financial text-4xl font-semibold leading-none text-foreground">
                  {data.score}
                  <span className="text-base font-normal text-muted-foreground"> / 100</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Sin puntaje general</p>
              )}
              {data.bandLabel && <p className="pb-1 text-sm font-medium">{data.bandLabel}</p>}
            </div>
            <p className="text-sm">{data.summary}</p>

            <ul className="space-y-3">
              {data.components.map((component) => (
                <ComponentRow key={component.id} component={component} />
              ))}
            </ul>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {data.caveat}
              {data.window ? ` Periodo ${data.window.from} a ${data.window.to}, con los pesos actuales y ${data.benchmark?.name ?? 'el benchmark'} como referencia.` : ''}
              {data.excluded_symbols && data.excluded_symbols.length > 0 ? ` Sin historial suficiente, fuera del cálculo: ${data.excluded_symbols.join(', ')}.` : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
