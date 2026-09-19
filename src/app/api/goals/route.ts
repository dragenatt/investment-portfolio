import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { CreateGoalWithProjectionSchema } from '@/lib/schemas/goal'
import { trackGoals, type GoalRow } from '@/lib/services/goal-tracking'
import { recordAudit } from '@/lib/services/audit'

export const GET = apiHandler(async (req: Request) => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const status = new URL(req.url).searchParams.get('status')

  // RLS scopes this to the caller, so there is no user filter here to get wrong.
  let query = supabase
    .from('goals')
    .select('*')
    .order('target_date', { ascending: true })

  if (status) query = query.eq('status', status)

  const { data, error: dbError } = await query
  if (dbError) return error(dbError.message, 500)

  // Each goal with its pace against plan, so the list can say "behind" without
  // the page asking for every goal one at a time. The same computation the
  // detail route uses — see goal-tracking.ts.
  const goals = (data ?? []) as GoalRow[]
  const tracking = await trackGoals(supabase, goals)
  return success(goals.map((goal) => ({ ...goal, tracking: tracking.get(goal.id) ?? null })))
})

export const POST = apiHandler(async (req: Request) => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON', 400)
  }

  const result = await validate(CreateGoalWithProjectionSchema, body)
  if ('error' in result) return result.error

  // Checked here as well as by the database, so the user sees which field is
  // wrong rather than a constraint name.
  const start = result.data.start_date ?? new Date().toISOString().slice(0, 10)
  if (result.data.target_date <= start) {
    return error('The target date must be after the start date', 400)
  }

  const { projection, ...goalFields } = result.data

  const { data, error: dbError } = await supabase
    .from('goals')
    .insert({ ...goalFields, start_date: start, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)

  // The advisor saves a goal together with what the model said about it. A
  // projection that fails to write leaves a valid goal behind rather than
  // undoing it — the plan is what the user asked to keep — and says so.
  let projectionSaved: boolean | null = null
  if (projection) {
    const { error: projectionError } = await supabase
      .from('goal_projections')
      .insert({ ...projection, goal_id: data.id, user_id: user.id })
    projectionSaved = !projectionError
  }

  recordAudit({
    userId: user.id,
    entityType: 'goal',
    entityId: data.id,
    portfolioId: data.portfolio_id,
    label: data.name,
    action: 'created',
    newValue: data.name,
  })

  return success({ ...data, projection_saved: projectionSaved }, undefined, 201)
})
