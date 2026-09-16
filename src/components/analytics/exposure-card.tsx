'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { useExposure } from '@/lib/hooks/use-analytics'
import type { ExposureBucket } from '@/lib/services/exposure'

// P1-19 / P1-20. What the book is actually bet on — sector, region and
// currency — as opposed to what it holds. The route and the engine existed and
// no screen read them.

/** Stored labels are English keys other modules match on; the reader sees Spanish. */
const LABELS: Record<string, string> = {
  Unknown: 'Sin clasificar',
  'United States': 'Estados Unidos',
  Mexico: 'México',
  Europe: 'Europa',
  Canada: 'Canadá',
  Japan: 'Japón',
  Asia: 'Asia',
  Oceania: 'Oceanía',
  'Emerging markets': 'Mercados emergentes',
  Other: 'Otras regiones',
  Technology: 'Tecnología',
  Financials: 'Financiero',
  Healthcare: 'Salud',
  'Health Care': 'Salud',
  Energy: 'Energía',
  Industrials: 'Industrial',
  'Consumer Cyclical': 'Consumo discrecional',
  'Consumer Defensive': 'Consumo básico',
  'Communication Services': 'Comunicaciones',
  Utilities: 'Servicios públicos',
  'Real Estate': 'Bienes raíces',
  'Basic Materials': 'Materiales',
  Index: 'Índice',
  Etf: 'ETF',
  Stock: 'Acción',
  Crypto: 'Cripto',
}
const label = (name: string) => LABELS[name] ?? name

const CONFIDENCE: Record<string, string> = {
  stated: 'País declarado',
  inferred: 'Inferido de dónde cotiza',
  weak: 'Inferencia débil',
}

function Bars({ buckets, caption }: { buckets: ExposureBucket[]; caption: string }) {
  if (buckets.length === 0) return <p className="text-sm text-muted-foreground">Sin datos.</p>
  return (
    <ul className="space-y-2" aria-label={caption}>
      {buckets.map((bucket) => (
        <li key={bucket.name} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate" title={bucket.symbols.join(', ')}>{label(bucket.name)}</span>
            <span className="font-financial text-muted-foreground">{bucket.weightPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, bucket.weightPct))}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{bucket.symbols.join(', ')}</p>
        </li>
      ))}
    </ul>
  )
}

export function ExposureCard({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading, error } = useExposure(portfolioId)

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Exposición</CardTitle>
        <CardDescription>
          A qué está expuesto el dinero, más allá de la lista de posiciones: dos posiciones de 20% en el mismo sector
          son una apuesta de 40%, y ninguna vista por símbolo lo muestra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo calcular la exposición.</p>
        ) : !data || 'message' in data ? (
          <p className="text-sm text-muted-foreground">{data && 'message' in data ? data.message : 'Sin datos.'}</p>
        ) : (
          <div className="space-y-5">
            {data.sector.hiddenConcentration && (
              <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
                <p className="font-medium">Concentración oculta en {label(data.sector.hiddenConcentration.name)}</p>
                <p className="text-muted-foreground">{data.sector.hiddenConcentration.message}</p>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-3">
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sector</h3>
                <Bars buckets={data.sector.buckets} caption="Exposición por sector" />
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Región <span className="normal-case">· {CONFIDENCE[data.geographic.confidence] ?? data.geographic.confidence}</span>
                </h3>
                <Bars buckets={data.geographic.buckets} caption="Exposición por región" />
                <p className="text-[11px] text-muted-foreground">{data.geographic.caveat}</p>
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Moneda de cotización</h3>
                <Bars buckets={data.currency.buckets} caption="Exposición por moneda" />
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-financial">{data.currency.foreignPct.toFixed(1)}%</span> del portafolio cotiza en
                  una moneda distinta de {data.base_currency} y está expuesto a su tipo de cambio. {data.currency.summary}
                </p>
              </section>
            </div>

            <p className="text-xs text-muted-foreground">
              Valores en {data.base_currency} al tipo de cambio de hoy.
              {data.unconverted && data.unconverted.length > 0 ? ` No se pudo convertir ${data.unconverted.join(', ')}.` : ''}
            </p>
            <AuditTrail meta={data._meta} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
