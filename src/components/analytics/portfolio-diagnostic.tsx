'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { useDiagnostic } from '@/lib/hooks/use-analytics'

/**
 * The automatic diagnostic (P2-8): nine questions, each answered in a sentence
 * with the figures under it. Answers that could not be given say why. Nothing
 * on this card changes the portfolio.
 */
export function PortfolioDiagnostic({ portfolioId }: { portfolioId: string }) {
  const { data, error, isLoading, mutate } = useDiagnostic(portfolioId)

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-sm font-medium">Diagnóstico del portafolio</CardTitle>
        <CardDescription className="text-xs">
          Respuestas automáticas a las preguntas más comunes sobre tu portafolio, con los datos que las sostienen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !data ? (
          <ChartLoading height={200} label="Preparando el diagnóstico…" />
        ) : error && !data ? (
          <ChartEmpty height={200} kind="error" message="No se pudo preparar el diagnóstico." onRetry={() => mutate()} />
        ) : !data?.answers ? (
          <ChartEmpty height={200} message="No hay datos suficientes para un diagnóstico." />
        ) : (
          <>
            <ol className="space-y-4">
              {data.answers.map((item) => (
                <li key={item.id} className="space-y-1.5 border-b border-border/60 pb-4 last:border-0 last:pb-0">
                  <h3 className="text-sm font-medium">{item.question}</h3>
                  {item.answer ? (
                    <>
                      <p className="text-sm text-foreground">{item.answer}</p>
                      {item.figures.length > 0 && (
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                          {item.figures.map((figure) => (
                            <div key={figure.label} className="flex justify-between gap-3 border-b border-dashed border-border/60 py-0.5">
                              <dt className="text-muted-foreground">{figure.label}</dt>
                              <dd className="font-financial text-foreground">{figure.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sin respuesta: {item.unavailableReason}</p>
                  )}
                </li>
              ))}
            </ol>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {data.caveat}
              {data.return_window ? ` Rendimientos de ${data.return_window.from} a ${data.return_window.to}.` : ''}
              {data.risk_window ? ` Riesgo de ${data.risk_window.from} a ${data.risk_window.to}.` : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
