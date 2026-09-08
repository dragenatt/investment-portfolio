import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { searchSymbols } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'search')
  if (!allowed) return error('Rate limit exceeded', 429)

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  if (!q || q.length < 1) return error('Query required', 400)

  const results = await searchSymbols(q)
  return success(results)
}

export const GET = apiHandler(getHandler)
