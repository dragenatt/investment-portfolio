import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { getAuditTrail, describeAuditEntry, type AuditEntityType } from '@/lib/services/audit'

const ENTITY_TYPES: AuditEntityType[] = [
  'portfolio',
  'position',
  'transaction',
  'goal',
  'rebalance',
]

/**
 * The signed-in user's own audit trail.
 *
 * RLS restricts the table to the owner's rows, so there is no user filter here
 * to get wrong. Each row is returned with a rendered sentence alongside the raw
 * fields — the same wording an export or a notification would use.
 */
async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const requested = url.searchParams.get('entity_type')
  const entityType = ENTITY_TYPES.find((t) => t === requested)
  const entityId = url.searchParams.get('entity_id') ?? undefined
  const portfolioId = url.searchParams.get('portfolio_id') ?? undefined
  const limit = Number(url.searchParams.get('limit') ?? 100)

  const rows = await getAuditTrail(supabase, {
    entityType,
    entityId,
    portfolioId,
    limit: Number.isFinite(limit) ? limit : 100,
  })

  return success(rows.map((row) => ({ ...row, description: describeAuditEntry(row) })))
}

export const GET = apiHandler(getHandler)
