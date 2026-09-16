'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { useStress } from '@/lib/hooks/use-analytics'
import type { StressCoverage } from '@/lib/services/stress-testing'
import { cn } from '@/lib/utils'

// P1-30. Real, dated crises applied to the book the reader actually holds. The
// engine, its episode catalogue and its route existed; the only place a reader
// could meet stress testing was a laboratory experiment on made-up assets.

/** Said in words, not only as a colour or an icon (C9). */
const COVERAGE: Record<StressCoverage, { label: string; hint: string }> = {
  observed: {
    label: 'Observado',
    hint: 'Cada posición medida tiene su propio historial en ese periodo.',
  },
  estimated: {
    label: 'Estimado con beta',
    hint: 'Alguna posición no existía entonces; su caída se estimó con su beta frente al benchmark.',
  },
  unavailable: {
    label: 'No disponible',
    hint: 'No hay historial ni beta para medirlo.',
  },
}

const signedPct = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`

export function StressPanel({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading, error } = useStress(portfolioId)

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Stress testing histórico</CardTitle>
        <CardDescription>
          Qué les habrían hecho crisis reales y fechadas a tus posiciones actuales. Las fechas son hechos; las caídas se
          recalculan con los precios de lo que tienes, no se copian de ningún lado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo correr el stress test.</p>
        ) : !data || 'message' in data ? (
          <p className="text-sm text-muted-foreground">{data && 'message' in data ? data.message : 'Sin datos.'}</p>
        ) : (
          <div className="space-y-4">
            {data.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún episodio se pudo medir con estas posiciones.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Efecto de cada episodio histórico sobre el portafolio actual</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Episodio</th>
                      <th scope="col" className="py-2 pr-3 font-medium text-right">Tu portafolio</th>
                      <th scope="col" className="py-2 pr-3 font-medium text-right">{data.benchmark_symbol}</th>
                      <th scope="col" className="py-2 font-medium">Cómo se midió</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr key={r.episode.id} className="border-t border-border align-top">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          <span className="block">{r.episode.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{r.episode.from} → {r.episode.to}</span>
                        </th>
                        <td className={cn('py-2 pr-3 text-right font-financial', r.portfolioReturnPct < 0 ? 'text-loss' : 'text-gain')}>
                          {signedPct(r.portfolioReturnPct)}
                        </td>
                        <td className="py-2 pr-3 text-right font-financial">{signedPct(r.benchmarkReturnPct)}</td>
                        <td className="py-2">
                          <span className="block">{COVERAGE[r.coverage].label}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {COVERAGE[r.coverage].hint} Cubre <span className="font-financial">{r.observedWeightPct.toFixed(0)}%</span> del portafolio.
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.results.map((r) => (
              <p key={`${r.episode.id}-summary`} className="text-sm">{r.summary}</p>
            ))}

            {data.unmeasured.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">Sin medir ({data.unmeasured.length} de {data.episodes_catalogued}):</p>
                <ul className="list-disc pl-5">
                  {data.unmeasured.map((u) => <li key={u.id}>{u.name}. {u.reason}</li>)}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {data.granularity_note} Es lo que habría pasado con tus pesos de hoy, no lo que le pasará a tu portafolio en
              la próxima crisis.
            </p>
            <AuditTrail meta={data._meta} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
