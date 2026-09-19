import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { UpdatePortfolioSchema } from '@/lib/schemas/portfolio'
import { getPortfolioDetail } from '@/lib/services/portfolio'
import { recordAudit, recordAuditChanges, diffForAudit } from '@/lib/services/audit'

/** What a portfolio edit can change, and so what its history lists. */
const AUDITED_FIELDS = ['name', 'description', 'benchmark_symbol', 'cost_model']

export const GET = apiHandler(async (_req: Request, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await getPortfolioDetail(supabase, id)
  if (dbError) return error(dbError.message, dbError.code === 'PGRST116' ? 404 : 500)

  return success(data)
})

export const PATCH = apiHandler(async (req: Request, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(UpdatePortfolioSchema, body)
  if ('error' in result) return result.error

  const { data: before } = await supabase
    .from('portfolios')
    .select('name, description, benchmark_symbol, cost_model')
    .eq('id', id)
    .single()

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .update(result.data)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)

  recordAuditChanges(
    { userId: user.id, entityType: 'portfolio', entityId: id, portfolioId: id, label: data.name },
    diffForAudit(before, data, AUDITED_FIELDS),
  )
  return success(data)
})

export const DELETE = apiHandler(async (_req: Request, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: before } = await supabase.from('portfolios').select('name').eq('id', id).maybeSingle()

  const { error: dbError } = await supabase.rpc('soft_delete_portfolio', {
    p_portfolio_id: id,
  })

  if (dbError) return error(dbError.message, 500)

  recordAudit({
    userId: user.id,
    entityType: 'portfolio',
    entityId: id,
    portfolioId: id,
    label: before?.name ?? null,
    action: 'deleted',
    oldValue: before?.name ?? null,
  })
  return success({ deleted: true })
})
