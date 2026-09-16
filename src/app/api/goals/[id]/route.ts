import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { UpdateGoalSchema } from '@/lib/schemas/goal'
import { recordAudit, recordAuditChanges, diffForAudit } from '@/lib/services/audit'
import { trackGoals, type GoalRow } from '@/lib/services/goal-tracking'

const AUDITED_FIELDS = [
  'name',
  'target_amount',
  'target_date',
  'starting_capital',
  'monthly_contribution',
  'risk_profile',
  'status',
]

/**
 * One goal, with its progress against plan when it is tied to a portfolio.
 *
 * Progress is measured against the plan's own compounding curve rather than a
 * straight line — see services/goals.ts for why that distinction is the whole
 * feature.
 */
export const GET = apiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: goal, error: dbError } = await supabase
    .from('goals')
    .select('*')
    .eq('id', id)
    .single()

  if (dbError || !goal) return error('Goal not found', 404)

  const { data: projections } = await supabase
    .from('goal_projections')
    .select('*')
    .eq('goal_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Converted into the goal's own currency — see goal-tracking.ts, shared with
  // the goals list so the two can never disagree about the same goal.
  const tracking = (await trackGoals(supabase, [goal as GoalRow])).get(goal.id) ?? null

  return success({ goal, projections: projections ?? [], tracking })
})

export const PATCH = apiHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON', 400)
  }

  const result = await validate(UpdateGoalSchema, body)
  if ('error' in result) return result.error

  const { data: before } = await supabase.from('goals').select('*').eq('id', id).single()
  if (!before) return error('Goal not found', 404)

  const { data, error: dbError } = await supabase
    .from('goals')
    .update({ ...result.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)

  // Field by field, so the trail reads as "changed the target from X to Y"
  // rather than "updated the goal".
  recordAuditChanges(
    supabase,
    { userId: user.id, entityType: 'goal', entityId: id },
    diffForAudit(before, data, AUDITED_FIELDS),
  )

  return success(data)
})

/**
 * Duplicate a goal, so a user can explore a variant without losing the original.
 *
 * Projections are deliberately NOT copied: they describe answers the model gave
 * about the original plan, and attaching them to a different one would make the
 * history say something it never said.
 */
export const POST = apiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: original } = await supabase.from('goals').select('*').eq('id', id).single()
  if (!original) return error('Goal not found', 404)

  // Built explicitly rather than by spreading the original: an id or a
  // created_at carried across would either collide or lie about when the copy
  // was made.
  const { data, error: dbError } = await supabase
    .from('goals')
    .insert({
      user_id: user.id,
      portfolio_id: original.portfolio_id,
      name: `${original.name} (copia)`,
      description: original.description,
      target_amount: original.target_amount,
      currency: original.currency,
      start_date: original.start_date,
      target_date: original.target_date,
      starting_capital: original.starting_capital,
      monthly_contribution: original.monthly_contribution,
      risk_profile: original.risk_profile,
      expected_annual_return: original.expected_annual_return,
      expected_annual_volatility: original.expected_annual_volatility,
      status: 'active',
    })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)

  recordAudit(supabase, {
    userId: user.id,
    entityType: 'goal',
    entityId: data.id,
    action: 'created',
    newValue: `duplicated from ${id}`,
  })

  return success(data, undefined, 201)
})

export const DELETE = apiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: before } = await supabase.from('goals').select('name').eq('id', id).single()

  const { error: dbError } = await supabase.from('goals').delete().eq('id', id)
  if (dbError) return error(dbError.message, 500)

  recordAudit(supabase, {
    userId: user.id,
    entityType: 'goal',
    entityId: id,
    action: 'deleted',
    oldValue: before?.name ?? null,
  })

  return success({ deleted: true })
})
