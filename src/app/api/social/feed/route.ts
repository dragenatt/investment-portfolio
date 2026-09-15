import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'general')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = 20
  const offset = (page - 1) * pageSize

  const { data, error: dbError } = await supabase
    .from('activity_feed')
    .select('*')
    .or(`user_id.eq.${user.id},is_public.eq.true`)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (dbError) return error(dbError.message, 500)

  // Profiles in a second query: activity_feed and profiles both reference
  // auth.users, not each other, so PostgREST cannot embed one in the other and
  // the single-query version failed on every request.
  const userIds = [...new Set((data ?? []).map((row) => row.user_id as string))]
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('user_id, username, avatar_url').in('user_id', userIds)
    : { data: [] }
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, { username: p.username, avatar_url: p.avatar_url }]))

  return success((data ?? []).map((row) => ({ ...row, profiles: byUser.get(row.user_id) ?? null })))
}

export const GET = apiHandler(getHandler)
