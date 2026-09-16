import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { CreateProjectionSchema } from '@/lib/schemas/goal'

/**
 * Append a projection to a goal.
 *
 * Append, never replace. Migration 014 gives goal_projections no UPDATE and no
 * DELETE policy precisely so that "the model said 62% last year and 71% now"
 * stays a readable history, and P0-28 forbids overwriting a projection
 * silently. A recalculation is a new row next to the old ones.
 */
export const POST = apiHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
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

  const result = await validate(CreateProjectionSchema, body)
  if ('error' in result) return result.error

  // RLS already restricts goals to their owner; asking first turns "not yours"
  // into a 404 instead of a foreign-key error.
  const { data: goal } = await supabase.from('goals').select('id').eq('id', id).single()
  if (!goal) return error('Goal not found', 404)

  const { data, error: dbError } = await supabase
    .from('goal_projections')
    .insert({ ...result.data, goal_id: id, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
})
