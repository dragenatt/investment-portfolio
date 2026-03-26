import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateAlertSchema } from '@/lib/schemas/alert'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(CreateAlertSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('alerts')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
