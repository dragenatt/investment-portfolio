// Audit trail — what changed, when, and from what to what.
//
// Every other table in the app stores current state, so "why did my cost basis
// move?" has no answer anywhere. This one is append-only and exists to answer
// exactly that: for debugging, for the user's own transparency, and because
// seeing your own edits listed is a genuinely good way to learn what each field
// actually does.
//
// Writes never throw and never hold up the response. An audit entry failing
// must not fail the action it was recording — a trail is worth less than the
// thing it describes.
//
// Until 4.5 the table had zero rows, and not only because few routes wrote to
// it. The ones that did passed the USER's client, and audit_log grants the
// authenticated role SELECT and nothing else (migration 013: "rows are written
// by the service role"). Every insert was refused by RLS and the refusal went to
// a console nobody reads. Entries now go through the service role, after the
// response, where the platform keeps the function alive for them.

import { after } from 'next/server'
import { type SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'
import type { AuditAction, AuditEntityType, AuditRow } from './audit-labels'

// The wording and the types live in audit-labels.ts, which has no server
// imports, so a client screen can use them; re-exported so callers keep one
// import path.
export * from './audit-labels'

export type AuditEntry = {
  userId: string
  entityType: AuditEntityType
  entityId?: string | null
  /** The portfolio the change happened in, so a portfolio's history can be read on its own. */
  portfolioId?: string | null
  /** What the reader calls the entity: a symbol, a goal's name, a trade summary. */
  label?: string | null
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
    // Objects by their content: String() turns every one into
    // "[object Object]", so a changed cost model compared equal to the old one.
    const text = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))
    const same = bothNumeric ? oldValue === newValue : text(oldValue) === text(newValue)

    if (!same) changes.push({ field, oldValue, newValue })
  }
  return changes
}

/** The rows an entry list becomes. Pure, so the mapping is testable. */
export function auditRows(entries: AuditEntry[]) {
  return entries.map((entry) => ({
    user_id: entry.userId,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    portfolio_id: entry.portfolioId ?? null,
    entity_label: asText(entry.label),
    action: entry.action,
    field: entry.field ?? null,
    old_value: asText(entry.oldValue),
    new_value: asText(entry.newValue),
  }))
}

/**
 * Write entries now, in one insert. Never throws; resolves to the rows written.
 *
 * The writer is the service role: RLS gives users SELECT on their own trail and
 * no INSERT, UPDATE or DELETE at all, so a user can read their history but not
 * write or rewrite it.
 */
export async function writeAudit(
  entries: AuditEntry[],
  writer: SupabaseClient | null = serviceRoleClient(),
): Promise<number> {
  if (entries.length === 0) return 0
  if (!writer) {
    console.error('[audit] no service-role client; entries not recorded')
    return 0
  }
  try {
    const { error } = await writer.from('audit_log').insert(auditRows(entries))
    if (error) {
      console.error('[audit] insert failed:', error.message)
      return 0
    }
    return entries.length
  } catch (err) {
    console.error('[audit] insert failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Record entries after the response is sent.
 *
 * `after()` keeps the function alive until the write finishes; a bare promise
 * left behind by a returned response can be frozen with the instance and never
 * reach the database. Outside a request (a script, a test) it writes directly.
 */
export function recordAudit(...entries: AuditEntry[]): void {
  if (entries.length === 0) return
  const write = () => writeAudit(entries).then(() => undefined)
  try {
    after(write)
  } catch {
    void write()
  }
}

/** One entry per changed field, so the trail reads field by field. */
export function changeEntries(
  base: Omit<AuditEntry, 'field' | 'oldValue' | 'newValue' | 'action'>,
  changes: FieldChange[],
): AuditEntry[] {
  return changes.map((change) => ({
    ...base,
    action: 'updated' as const,
    field: change.field,
    oldValue: change.oldValue,
    newValue: change.newValue,
  }))
}

/** Record one entry per changed field. */
export function recordAuditChanges(
  base: Omit<AuditEntry, 'field' | 'oldValue' | 'newValue' | 'action'>,
  changes: FieldChange[],
): void {
  recordAudit(...changeEntries(base, changes))
}

/** A user's own trail, newest first. RLS restricts this to their rows. */
export async function getAuditTrail(
  supabase: SupabaseClient,
  options: { entityType?: AuditEntityType; entityId?: string; portfolioId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  let query = supabase
    .from('audit_log')
    .select('id, entity_type, entity_id, portfolio_id, entity_label, action, field, old_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 100, 500))

  if (options.entityType) query = query.eq('entity_type', options.entityType)
  if (options.entityId) query = query.eq('entity_id', options.entityId)
  if (options.portfolioId) query = query.eq('portfolio_id', options.portfolioId)

  const { data, error } = await query
  if (error) {
    console.error('[audit] read failed:', error.message)
    return []
  }
  return (data ?? []) as AuditRow[]
}

const TRADE_TYPE_NAMES: Record<string, string> = {
  buy: 'compra',
  sell: 'venta',
  dividend: 'dividendo',
  split: 'split',
}

/** "compra 10 AAPL a 150 USD" — how a transaction is named in its history. */
export function describeTrade(trade: {
  type: string
  quantity: number | string
  symbol: string
  price: number | string
  currency?: string | null
}): string {
  const type = TRADE_TYPE_NAMES[trade.type] ?? trade.type
  const currency = trade.currency ? ` ${trade.currency}` : ''
  return `${type} ${Number(trade.quantity)} ${trade.symbol} a ${Number(trade.price)}${currency}`
}

const round6 = (value: number | string) => Math.round(Number(value) * 1e6) / 1e6

/** The position fields a trade moves, before and after, as change entries. */
export function positionChangeEntries(
  base: { userId: string; positionId: string; portfolioId: string; symbol: string },
  before: { quantity: number | string; avg_cost: number | string },
  after: { quantity: number; avg_cost: number },
): AuditEntry[] {
  return changeEntries(
    { userId: base.userId, entityType: 'position', entityId: base.positionId, portfolioId: base.portfolioId, label: base.symbol },
    // Rounded to six decimals on both sides: a replayed average cost carries
    // float noise (150.33333333333334) that is neither a change nor readable.
    diffForAudit(
      { quantity: round6(before.quantity), avg_cost: round6(before.avg_cost) },
      { quantity: round6(after.quantity), avg_cost: round6(after.avg_cost) },
      ['quantity', 'avg_cost'],
    ),
  )
}
