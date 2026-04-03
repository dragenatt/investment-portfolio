import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'search')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q) return error('q query parameter is required', 400)

  const { data, error: dbError } = await supabase.rpc('search_users', {
    query: q,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
