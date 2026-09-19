// Audit trail wording — what the history screen and the API say, and the
// types they share. No I/O and no server imports, so the history page (a client
// component) can use it; audit.ts, which writes through the service role and
// schedules with next/server's after(), re-exports all of it.

export type AuditEntityType = 'portfolio' | 'position' | 'transaction' | 'goal' | 'rebalance'
export type AuditAction = 'created' | 'updated' | 'deleted' | 'rebalanced'

export type AuditRow = {
  id: string
  entity_type: string
  entity_id: string | null
  portfolio_id?: string | null
  entity_label?: string | null
  action: string
  field: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
}

/** What each entity is called in a sentence. */
export const AUDIT_ENTITY_NAMES: Record<AuditEntityType, string> = {
  portfolio: 'el portafolio',
  position: 'la posición',
  transaction: 'la transacción',
  goal: 'la meta',
  rebalance: 'el rebalanceo',
}

/** Column names as a reader would say them. Unknown fields fall back to the column name. */
export const AUDIT_FIELD_NAMES: Record<string, string> = {
  name: 'nombre',
  description: 'descripción',
  base_currency: 'moneda base',
  benchmark_symbol: 'benchmark',
  visibility: 'visibilidad',
  is_public: 'visibilidad',
  quantity: 'cantidad',
  avg_cost: 'costo promedio',
  price: 'precio',
  fees: 'comisiones',
  currency: 'moneda',
  type: 'tipo',
  executed_at: 'fecha',
  notes: 'notas',
  target_amount: 'monto objetivo',
  target_date: 'fecha objetivo',
  starting_capital: 'capital inicial',
  monthly_contribution: 'aportación mensual',
  risk_profile: 'perfil de riesgo',
  status: 'estado',
  show_amounts: 'mostrar montos',
  show_positions: 'mostrar posiciones',
  show_transactions: 'mostrar transacciones',
  show_allocation: 'mostrar asignación',
  tags: 'etiquetas',
}

export const AUDIT_ACTION_NAMES: Record<AuditAction, string> = {
  created: 'Creación',
  updated: 'Cambio',
  deleted: 'Eliminación',
  rebalanced: 'Rebalanceo',
}

/**
 * One line describing an entry, in the user's terms.
 *
 * Pure, so the wording is testable. Kept here rather than in a component
 * because the same sentence belongs in an export and a notification too. The
 * stored label is used when there is one: "la posición AAPL" reads, "la
 * posición 3f2a…" does not.
 */
export function describeAuditEntry(row: AuditRow): string {
  const entity = AUDIT_ENTITY_NAMES[row.entity_type as AuditEntityType] ?? row.entity_type
  const name = row.entity_label ?? row.entity_id
  const subject = name ? `${entity} ${name}` : entity

  switch (row.action) {
    case 'created':
      return `Creó ${subject}.`
    case 'deleted':
      return `Eliminó ${subject}.`
    case 'rebalanced':
      return `Rebalanceó ${subject}.`
    case 'updated': {
      if (!row.field) return `Modificó ${subject}.`
      const field = AUDIT_FIELD_NAMES[row.field] ?? row.field
      return `Cambió ${field} de ${subject}: ${row.old_value ?? 'vacío'} → ${row.new_value ?? 'vacío'}.`
    }
    default:
      return `${row.action}: ${subject}.`
  }
}
