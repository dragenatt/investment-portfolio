import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'general')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }

  const { target_user_id } = body
  if (!target_user_id) return error('target_user_id is required', 400)

  const { data, error: dbError } = await supabase.rpc('toggle_follow', {
    target_user_id,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
