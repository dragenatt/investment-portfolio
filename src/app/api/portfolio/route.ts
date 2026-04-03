import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { CreatePortfolioSchema } from '@/lib/schemas/portfolio'
import { getUserPortfolios } from '@/lib/services/portfolio'

export const GET = apiHandler(async () => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await getUserPortfolios(supabase, user.id)
  if (dbError) return error(dbError.message, 500)

  return success(data)
})

export const POST = apiHandler(async (req: Request) => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(CreatePortfolioSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
})
