'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GraduationCap } from 'lucide-react'
import {
  PROCEDENCIA_ETIQUETAS,
  type Educacion,
  type Procedencia,
} from '@/lib/services/advisor-education'

/**
 * D3 — the advisor's teaching half.
 *
 * The roadmap asks for one thing above all: that "Resultado del modelo" never
 * be mistaken for "Explicacion educativa". The layout enforces it rather than
 * asserting it — every concept shows its figure with a badge naming where that
 * figure came from, and the teaching sits behind a disclosure carrying that
 * exact heading. A reader can see which half is which without reading either.
 *
 * The whole block is collapsed by default. Eleven concepts unfolded under a
 * projection would bury the projection, and someone who has not asked what
 * volatility means is not helped by being told.
 */

const BADGE_VARIANT: Record<Procedencia, 'default' | 'secondary' | 'outline' | 'ghost'> = {
  // The model's own output is the one that most needs marking as such.
  resultado: 'default',
  dato: 'secondary',
  supuesto: 'outline',
  estimacion: 'outline',
  'no-aplica': 'ghost',
}

export function ModoEducativo({ educacion }: { educacion: Educacion | null }) {
  if (!educacion) return null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          Modo educativo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed rounded-xl bg-muted/40 p-3">
          {educacion.aviso}
        </p>

        <details className="group">
          <summary className="cursor-pointer text-xs text-foreground/80 hover:text-foreground list-none flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Ver los {educacion.conceptos.length} conceptos que usa esta proyeccion
          </summary>

          <ul className="mt-3 space-y-2">
            {educacion.conceptos.map((concepto) => (
              <li key={concepto.id} className="rounded-xl border border-border p-3">
                <p className="text-xs font-medium text-foreground">{concepto.termino}</p>

                {/* The model's side: a figure that never appears without the
                    label saying what kind of claim it is. */}
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Badge
                    variant={BADGE_VARIANT[concepto.enTuPlan.procedencia]}
                    className={cn(
                      'text-[10px]',
                      concepto.enTuPlan.procedencia === 'no-aplica' &&
                        'text-muted-foreground border-border border',
                    )}
                  >
                    {PROCEDENCIA_ETIQUETAS[concepto.enTuPlan.procedencia]}
                  </Badge>
                  <span
                    className={cn(
                      'text-[11px] font-mono',
                      concepto.enTuPlan.procedencia === 'no-aplica'
                        ? 'text-muted-foreground'
                        : 'text-foreground',
                    )}
                  >
                    {concepto.enTuPlan.valor}
                  </span>
                </div>

                {/* The teaching side, behind the roadmap's own heading. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                    Explicacion educativa
                  </summary>
                  <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {concepto.definicion}
                    </p>
                    <div>
                      <p className="text-[10px] font-medium text-foreground/70">Por que importa</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {concepto.porQueImporta}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-foreground/70">
                        El malentendido habitual
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {concepto.errorComun}
                      </p>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}
