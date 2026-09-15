'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { HelpCircle, Wallet, PiggyBank, AlertTriangle } from 'lucide-react'
import type {
  Explicacion,
  Viabilidad,
  ComparacionAhorro,
} from '@/lib/services/advisor-explain'

/**
 * The three questions a projection raises the moment it appears.
 *
 * Why did I get this? Can I afford it? Is it even worth it versus saving?
 *
 * All three are kept visually apart from the projection itself, because a model
 * result and an explanation of a model result are different claims and blending
 * them is how a number starts reading as advice.
 */

const fmt = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

// ─── D1 ─────────────────────────────────────────────────────────────────────

export function PorQueEstaRecomendacion({ explicacion }: { explicacion: Explicacion | null }) {
  if (!explicacion) return null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <HelpCircle className="h-4 w-4" />
          ¿Por que recibi esta recomendacion?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-3">
          {explicacion.factores.map((factor) => (
            <div key={factor.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-xs font-medium text-foreground">{factor.etiqueta}</dt>
                <dd className="text-sm font-financial font-semibold text-foreground">{factor.valor}</dd>
              </div>
              <dd className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                {factor.porque}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-[11px] text-muted-foreground leading-relaxed">{explicacion.nota}</p>
        <p className="text-[10px] text-muted-foreground font-financial">
          Modelo v{explicacion.modelo.version} ·{' '}
          {explicacion.modelo.simulaciones.toLocaleString('es-MX')} trayectorias · semilla{' '}
          {explicacion.modelo.seed}
        </p>
      </CardContent>
    </Card>
  )
}

// ─── D2 ─────────────────────────────────────────────────────────────────────

const NIVEL_TONE: Record<string, string> = {
  comodo: 'text-gain',
  exigente: 'text-foreground',
  muy_exigente: 'text-warn',
  inviable: 'text-loss',
  desconocido: 'text-muted-foreground',
}

export function ViabilidadCard({ viabilidad }: { viabilidad: Viabilidad | null }) {
  if (!viabilidad) return null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          ¿Puedes sostener esta aportacion?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-3">
            {/* Never hidden, whatever the verdict below says. */}
            <p className="text-[11px] text-muted-foreground">Lo que pide el calculo</p>
            <p className="text-sm font-financial font-semibold text-foreground">
              {fmt.format(viabilidad.aportacionMatematica)} al mes
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-[11px] text-muted-foreground">De tu ingreso mensual</p>
            <p
              className={cn(
                'text-sm font-financial font-semibold',
                NIVEL_TONE[viabilidad.nivel] ?? 'text-foreground',
              )}
            >
              {viabilidad.porcentajeDelIngreso === null
                ? 'n/d'
                : `${viabilidad.porcentajeDelIngreso.toFixed(0)}% · ${viabilidad.etiqueta}`}
            </p>
          </div>
        </div>

        {viabilidad.advertencia && (
          <p className="text-[11px] leading-relaxed flex items-start gap-1.5 rounded-xl bg-muted/40 p-3">
            <AlertTriangle
              className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', NIVEL_TONE[viabilidad.nivel])}
            />
            <span className="text-muted-foreground">{viabilidad.advertencia}</span>
          </p>
        )}

        {viabilidad.alternativas.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Si no da, hay cuatro palancas:</p>
            <ul className="space-y-1">
              {viabilidad.alternativas.map((alternativa) => (
                <li key={alternativa} className="text-[11px] text-muted-foreground leading-relaxed">
                  · {alternativa}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">{viabilidad.nota}</p>
      </CardContent>
    </Card>
  )
}

// ─── D4 ─────────────────────────────────────────────────────────────────────

export function InvertirVsAhorrarCard({
  comparacion,
}: {
  comparacion: ComparacionAhorro | null
}) {
  if (!comparacion) return null

  const rows = [
    {
      label: 'Guardar sin invertir',
      camino: comparacion.ahorro,
      tone: 'text-muted-foreground',
    },
    {
      label: 'Invertir (escenario medio)',
      camino: comparacion.inversion,
      tone: 'text-foreground',
    },
    ...(comparacion.inversionPesimista
      ? [
          {
            label: 'Invertir (escenario pesimista)',
            camino: comparacion.inversionPesimista,
            tone: 'text-muted-foreground',
          },
        ]
      : []),
  ]

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <PiggyBank className="h-4 w-4" />
          Invertir o solo ahorrar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-[11px]">
                <th className="text-left font-normal py-1">Camino</th>
                <th className="text-right font-normal py-1">Aportado</th>
                <th className="text-right font-normal py-1">Valor final</th>
                <th className="text-right font-normal py-1">Lo puso el interes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label} className={row.tone}>
                  <td className="py-1.5">{row.label}</td>
                  <td className="text-right font-financial">{fmt.format(row.camino.aportado)}</td>
                  <td className="text-right font-financial">{fmt.format(row.camino.valorFinal)}</td>
                  <td
                    className={cn(
                      'text-right font-financial',
                      row.camino.crecimiento > 0
                        ? 'text-gain'
                        : row.camino.crecimiento < 0
                          ? 'text-loss'
                          : undefined,
                    )}
                  >
                    {fmt.format(row.camino.crecimiento)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed rounded-xl bg-muted/40 p-3">
          {comparacion.resumen}
        </p>

        {/* The half a green number will never communicate on its own. */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {comparacion.advertencia}
        </p>
      </CardContent>
    </Card>
  )
}
