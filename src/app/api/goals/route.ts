import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { CreateGoalSchema } from '@/lib/schemas/goal'
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

  return success(data)
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

  const result = await validate(CreateGoalSchema, body)
  if ('error' in result) return result.error

  // Checked here as well as by the database, so the user sees which field is
  // wrong rather than a constraint name.
  const start = result.data.start_date ?? new Date().toISOString().slice(0, 10)
  if (result.data.target_date <= start) {
    return error('The target date must be after the start date', 400)
  }

  const { data, error: dbError } = await supabase
    .from('goals')
    .insert({ ...result.data, start_date: start, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)

  recordAudit(supabase, {
    userId: user.id,
    entityType: 'goal',
    entityId: data.id,
    action: 'created',
    newValue: data.name,
  })

  return success(data, undefined, 201)
})
