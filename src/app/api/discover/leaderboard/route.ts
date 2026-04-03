import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || 'top_return_1m'
  const period = searchParams.get('period') || '1M'

  const { data, error: dbError } = await supabase
    .from('leaderboard_cache')
    .select('rankings')
    .eq('category', category)
    .eq('period', period)
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data?.rankings || [])
}
