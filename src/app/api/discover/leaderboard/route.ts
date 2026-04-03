import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getCachedLeaderboard, cacheLeaderboard } from '@/lib/cache/redis'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || 'top_return_1m'
  const period = searchParams.get('period') || '1M'

  // Check cache first
  const cached = await getCachedLeaderboard(category)
  if (cached) {
    return success(cached)
  }

  const { data, error: dbError } = await supabase
    .from('leaderboard_cache')
    .select('rankings')
    .eq('category', category)
    .eq('period', period)
    .single()

  if (dbError) return error(dbError.message, 500)
  
  const rankings = data?.rankings || []

  // Cache the leaderboard (15 minutes)
  await cacheLeaderboard(category, rankings, 900)

  return success(rankings)
}
