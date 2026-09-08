import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { apiHandler } from '@/lib/api/handler'

async function postHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'general')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }

  const { portfolio_id } = body
  if (!portfolio_id) return error('portfolio_id is required', 400)

  const { data, error: dbError } = await supabase.rpc('toggle_portfolio_like', {
    portfolio_id,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export const POST = apiHandler(postHandler)
