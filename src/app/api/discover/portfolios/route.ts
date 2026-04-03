import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const sort = searchParams.get('sort') || 'return_pct'
  const order = searchParams.get('order') || 'desc'
  const filter = searchParams.get('filter')
  const min_positions = searchParams.get('min_positions')
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)

  // Create cache key from parameters
  const cacheKey = `${CACHE_KEYS.PORTFOLIO_COMPARISON}public:${sort}:${order}:${filter || 'none'}:${min_positions || 'none'}:${page}:${limit}`

  const data = await withCache(
    cacheKey,
    600, // 10 minute TTL for public portfolios
    async () => {
      const { data: result, error: dbError } = await supabase.rpc('get_public_portfolios', {
        sort,
        order,
        filter: filter || null,
        min_positions: min_positions ? parseInt(min_positions, 10) : null,
        page,
        limit,
      })

      if (dbError) throw new Error(dbError.message)
      return result
    }
  )

  return success(data)
}
