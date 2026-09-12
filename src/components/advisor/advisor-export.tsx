'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { downloadFile } from '@/lib/utils/export'
import {
  planAMarkdown,
  planAJSON,
  nombreArchivoPlan,
  type PlanExport,
} from '@/lib/services/advisor-export'

/**
 * D5 — the plan as a file.
 *
 * Everything the advisor shows disappears when the tab closes, which is awkward
 * for the one artefact somebody might want to reread in a year or check a
 * decision against.
 *
 * Two formats, because they answer different questions. The Markdown is the
 * document — it carries the mandatory "Supuestos y limitaciones del modelo"
 * section and reads as prose. The JSON is the record: every figure unrounded,
 * for anyone who wants to audit rather than read.
 *
 * The download itself goes through the existing downloadFile() rather than a
 * second Blob helper, and nothing leaves the browser: the file is built from
 * state already on this page.
 */
export function ExportarPlan({ plan }: { plan: PlanExport | null }) {
  if (!plan) return null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Download className="h-4 w-4" />
          Guardar este plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          El archivo incluye tu perfil, la meta, el horizonte, el capital, la aportacion, la
          cartera, el rendimiento y la volatilidad supuestos, la probabilidad, los escenarios, la
          sensibilidad, las recomendaciones y la seccion de supuestos y limitaciones del modelo.
          Se genera en tu navegador; nada se envia a ningun servidor.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadFile(planAMarkdown(plan), nombreArchivoPlan(plan, 'md'), 'text/markdown')
            }
          >
            Descargar documento (.md)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadFile(planAJSON(plan), nombreArchivoPlan(plan, 'json'), 'application/json')
            }
          >
            Descargar datos (.json)
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Lleva la fecha, la version del modelo y la semilla de la simulacion, asi que el mismo
          plan se puede volver a reproducir exactamente.
        </p>
      </CardContent>
    </Card>
  )
}
