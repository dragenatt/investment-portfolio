import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = 20
  const offset = (page - 1) * pageSize

  const { data, error: dbError } = await supabase
    .from('activity_feed')
    .select(`
      *,
      profiles(username, avatar_url)
    `)
    .or(`user_id.eq.${user.id},is_public.eq.true`)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
