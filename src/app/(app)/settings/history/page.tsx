'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { useAuditTrail } from '@/lib/hooks/use-notifications'
import {
  AUDIT_ACTION_NAMES,
  AUDIT_ENTITY_NAMES,
  AUDIT_FIELD_NAMES,
  type AuditAction,
  type AuditEntityType,
} from '@/lib/services/audit-labels'
import { formatDateTime } from '@/lib/utils/date'

// 4.5 / P0-16. The audit trail had a table, row-level security and an API, and
// nothing ever wrote to it successfully or read it. This is the reading half:
// what changed, when, and from what to what — for debugging, for transparency,
// and because watching a sale move the average cost is how that field makes
// sense.

const ALL = 'all'
const FILTERS: Array<{ value: AuditEntityType | typeof ALL; label: string }> = [
  { value: ALL, label: 'Todo' },
  { value: 'portfolio', label: 'Portafolios' },
  { value: 'position', label: 'Posiciones' },
  { value: 'transaction', label: 'Transacciones' },
  { value: 'goal', label: 'Metas' },
]

/** "la posición" → "Posición", for a column that names the kind of thing. */
const entityHeading = (type: string) => {
  const name = AUDIT_ENTITY_NAMES[type as AuditEntityType] ?? type
  const bare = name.replace(/^(el|la) /, '')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

export default function AuditHistoryPage({ searchParams }: { searchParams: Promise<{ portfolio?: string }> }) {
  const { portfolio } = use(searchParams)
  const [entity, setEntity] = useState<AuditEntityType | typeof ALL>(ALL)
  const { data, isLoading, error } = useAuditTrail({
    entityType: entity === ALL ? undefined : entity,
    portfolioId: portfolio,
  })

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Historial de cambios</h1>
        <p className="text-sm text-muted-foreground">
          Cada cambio a tus portafolios, posiciones, transacciones y metas, con el valor que tenía antes y el que quedó. Nadie
          puede editar este registro, tampoco tú.
          {portfolio && (
            <>
              {' '}Mostrando un solo portafolio. <Link href="/settings/history" className="text-primary hover:underline">Ver todo</Link>
            </>
          )}
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Registro</CardTitle>
            <CardDescription>Lo más reciente primero. Se muestran hasta 200 cambios.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="audit-filter" className="text-xs text-muted-foreground">Mostrar</label>
            <Select value={entity} onValueChange={(v) => v && setEntity(v as AuditEntityType | typeof ALL)}>
              <SelectTrigger id="audit-filter" className="h-8 w-40 rounded-lg text-sm">
                <SelectValue>{(value: string) => FILTERS.find((f) => f.value === value)?.label ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable />
          ) : error ? (
            <p className="text-sm text-muted-foreground">No se pudo cargar el historial.</p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay cambios registrados. Aparecen aquí en cuanto registras una operación, editas un portafolio o
              guardas una meta.
            </p>
          ) : (
            <>
              {/* Table on wide screens */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Historial de cambios, del más reciente al más antiguo</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Acción</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Entidad</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Campo</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Valor anterior</th>
                      <th scope="col" className="py-2 font-medium">Valor nuevo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                          <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>
                        </td>
                        <td className="py-2 pr-3">{AUDIT_ACTION_NAMES[row.action as AuditAction] ?? row.action}</td>
                        <td className="py-2 pr-3">
                          <span className="block">{entityHeading(row.entity_type)}</span>
                          {row.entity_label && <span className="block text-xs text-muted-foreground break-words">{row.entity_label}</span>}
                        </td>
                        <td className="py-2 pr-3">{row.field ? AUDIT_FIELD_NAMES[row.field] ?? row.field : '—'}</td>
                        <td className="py-2 pr-3 break-words text-muted-foreground">{row.old_value ?? '—'}</td>
                        <td className="py-2 break-words">{row.new_value ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* One sentence per change on phones */}
              <ul className="md:hidden space-y-3">
                {data.map((row) => (
                  <li key={row.id} className="border-b border-border pb-2 last:border-0">
                    <p className="text-sm break-words">{row.description}</p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
