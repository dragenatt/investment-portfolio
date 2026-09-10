import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { UpdateGoalSchema } from '@/lib/schemas/goal'
import { recordAudit, recordAuditChanges, diffForAudit } from '@/lib/services/audit'
import { goalProgress, classifyPace, type GoalSnapshot } from '@/lib/services/goals'
import { getBatchQuotes } from '@/lib/services/market'

const AUDITED_FIELDS = [
  'name',
  'target_amount',
  'target_date',
  'starting_capital',
  'monthly_contribution',
  'risk_profile',
  'status',
]

type GoalRow = {
  id: string
  name: string
  portfolio_id: string | null
  target_amount: number
  start_date: string
  target_date: string
  starting_capital: number
  monthly_contribution: number
  expected_annual_return: number | null
  status: string
}

function toSnapshot(goal: GoalRow): GoalSnapshot {
  return {
    targetAmount: goal.target_amount,
    startDate: goal.start_date,
    targetDate: goal.target_date,
    startingCapital: goal.starting_capital,
    plannedMonthlyContribution: goal.monthly_contribution,
    // Falls back to a moderate assumption so a goal saved without a profile
    // still tracks; it is recorded on the goal when the advisor creates one.
    expectedAnnualReturn: goal.expected_annual_return ?? 0.07,
  }
}

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

  let tracking = null
  if (goal.portfolio_id) {
    const { data: positions } = await supabase
      .from('positions')
      .select('symbol, quantity, avg_cost')
      .eq('portfolio_id', goal.portfolio_id)
      .gt('quantity', 0)

    if (positions && positions.length > 0) {
      const priceMap: Record<string, number> = {}
      try {
        const quotes = await getBatchQuotes(positions.map((p) => p.symbol))
        for (const [symbol, quote] of Object.entries(quotes)) {
          if (quote.price != null) priceMap[symbol] = quote.price
        }
      } catch {
        // Average cost stands in; the progress figure degrades rather than fails.
      }

      const currentValue = positions.reduce(
        (sum, p) => sum + p.quantity * (priceMap[p.symbol] ?? p.avg_cost),
        0,
      )
      const contributedToDate = positions.reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)

      const progress = goalProgress(toSnapshot(goal as GoalRow), {
        currentValue,
        contributedToDate,
      })

      if (progress) tracking = { ...progress, ...classifyPace(progress.deviationPct) }
    }
  }

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
