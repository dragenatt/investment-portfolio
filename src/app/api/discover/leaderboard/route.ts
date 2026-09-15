import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getCachedLeaderboard, cacheLeaderboard } from '@/lib/cache/redis'
import { apiHandler } from '@/lib/api/handler'
import { isLeaderboardCategory, LEADERBOARD_PERIOD, type Ranking } from '@/lib/services/discover'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const category = new URL(req.url).searchParams.get('category') || 'returns'
  if (!isLeaderboardCategory(category)) return error('category must be returns, sharpe, volatility or consistency', 400)
  const period = LEADERBOARD_PERIOD

  const cached = await getCachedLeaderboard(category, period)
  if (cached) return success(cached)

  // maybeSingle: before the first nightly run there is no row, which is an
  // empty leaderboard, not a server error.
  const { data, error: dbError } = await supabase
    .from('leaderboard_cache')
    .select('rankings, computed_at')
    .eq('category', category)
    .eq('period', period)
    .maybeSingle()

  if (dbError) return error(dbError.message, 500)

  // The page reads { rankings, computedAt }; this route used to return the bare
  // array, so the table was always empty even when a row existed.
  const leaderboard = {
    category,
    period,
    rankings: (data?.rankings ?? []) as Ranking[],
    computedAt: (data?.computed_at as string | undefined) ?? null,
  }

  if (data) await cacheLeaderboard(category, period, leaderboard, 900)
  return success(leaderboard)
}

export const GET = apiHandler(getHandler)
