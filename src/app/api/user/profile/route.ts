import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdateProfileSchema } from '@/lib/schemas/user'
import { apiHandler } from '@/lib/api/handler'

async function getHandler() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (dbError) return error(dbError.message, 500)
  return success({ ...data, email: user.email })
}

async function patchHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdateProfileSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('profiles')
    .update(result.data)
    .eq('user_id', user.id)
    .select()
    .single()

  // 23505: unique_violation — the username belongs to someone else.
  if (dbError?.code === '23505') return error('Ese nombre de usuario ya está en uso', 409)
  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export const GET = apiHandler(getHandler)
export const PATCH = apiHandler(patchHandler)
