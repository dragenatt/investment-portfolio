// Audit trail — what changed, when, and from what to what.
//
// Every other table in the app stores current state, so "why did my cost basis
// move?" has no answer anywhere. This one is append-only and exists to answer
// exactly that: for debugging, for the user's own transparency, and because
// seeing your own edits listed is a genuinely good way to learn what each field
// actually does.
//
// Writes are fire-and-forget and never throw. An audit entry failing must not
// fail the action it was recording — a trail is worth less than the thing it
// describes.

import { type SupabaseClient } from '@supabase/supabase-js'

export type AuditEntityType = 'portfolio' | 'position' | 'transaction' | 'goal' | 'rebalance'
export type AuditAction = 'created' | 'updated' | 'deleted' | 'rebalanced'

export type AuditEntry = {
  userId: string
  entityType: AuditEntityType
  entityId?: string | null
  action: AuditAction
  field?: string | null
  oldValue?: unknown
  newValue?: unknown
}

/** Long values are truncated: the trail is for reading, not for reconstruction. */
const MAX_VALUE_LENGTH = 200

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.slice(0, MAX_VALUE_LENGTH)
}

export type FieldChange = { field: string; oldValue: unknown; newValue: unknown }

/**
 * The fields that actually differ between two versions of a record.
 *
 * Pure and exported so the interesting logic — deciding what counts as a change
 * — is testable without a database. Only the named fields are compared, so
 * adding an internal column never floods someone's history.
 *
 * Numbers are compared by value, everything else by its string form: a quantity
 * stored as 100 and re-submitted as "100" is not a change the user made.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: string[],
): FieldChange[] {
  if (!before || !after) return []

  const changes: FieldChange[] = []
  for (const field of fields) {
    const oldValue = before[field]
    const newValue = after[field]

    if (oldValue === undefined && newValue === undefined) continue

    const bothNumeric = typeof oldValue === 'number' && typeof newValue === 'number'
    const same = bothNumeric
      ? oldValue === newValue
      : String(oldValue ?? '') === String(newValue ?? '')

    if (!same) changes.push({ field, oldValue, newValue })
  }
  return changes
}

/**
 * Record one entry. Never awaited by the request path, never throws.
 *
 * Rows are written with whatever client the caller has; RLS grants SELECT to the
 * owner only and grants no UPDATE or DELETE at all, so a user can read their
 * trail but not edit it. A trail a user can edit is not a trail.
 */
export function recordAudit(supabase: SupabaseClient, entry: AuditEntry): void {
  void supabase
    .from('audit_log')
    .insert({
      user_id: entry.userId,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      action: entry.action,
      field: entry.field ?? null,
      old_value: asText(entry.oldValue),
      new_value: asText(entry.newValue),
    })
    .then(({ error }) => {
      if (error) console.error('[audit] insert failed:', error.message)
    })
}

/** Record one entry per changed field, so the trail reads field by field. */
export function recordAuditChanges(
  supabase: SupabaseClient,
  base: Omit<AuditEntry, 'field' | 'oldValue' | 'newValue' | 'action'>,
  changes: FieldChange[],
): void {
  for (const change of changes) {
    recordAudit(supabase, {
      ...base,
      action: 'updated',
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
    })
  }
}

export type AuditRow = {
  id: string
  entity_type: string
  entity_id: string | null
  action: string
  field: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
}

/** A user's own trail, newest first. RLS restricts this to their rows. */
export async function getAuditTrail(
  supabase: SupabaseClient,
  options: { entityType?: AuditEntityType; entityId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  let query = supabase
    .from('audit_log')
    .select('id, entity_type, entity_id, action, field, old_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 100, 500))

  if (options.entityType) query = query.eq('entity_type', options.entityType)
  if (options.entityId) query = query.eq('entity_id', options.entityId)

  const { data, error } = await query
  if (error) {
    console.error('[audit] read failed:', error.message)
    return []
  }
  return (data ?? []) as AuditRow[]
}

/**
 * One line describing an entry, in the user's terms.
 *
 * Pure, so the wording is testable. Kept here rather than in a component
 * because the same sentence belongs in an export and a notification too.
 */
export function describeAuditEntry(row: AuditRow): string {
  const subject = row.entity_id ? `${row.entity_type} ${row.entity_id}` : row.entity_type

  switch (row.action) {
    case 'created':
      return `Created ${subject}.`
    case 'deleted':
      return `Deleted ${subject}.`
    case 'rebalanced':
      return `Rebalanced ${subject}.`
    case 'updated':
      if (!row.field) return `Updated ${subject}.`
      return `Changed ${row.field} on ${subject} from ${row.old_value ?? 'empty'} to ${row.new_value ?? 'empty'}.`
    default:
      return `${row.action} on ${subject}.`
  }
}
