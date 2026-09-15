import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { apiHandler } from '@/lib/api/handler'
import { publicPortfolioArgs, toPublicPortfolio, type PublicPortfolioRow } from '@/lib/services/discover'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Named as get_public_portfolios declares them (sort_by, page_num, ...): the
  // route used to send sort/page/limit, which PostgREST cannot match to any
  // function, so every request failed.
  const args = publicPortfolioArgs(new URL(req.url).searchParams)

  // Public portfolios are the same for every signed-in reader.
  const cacheKey = `${CACHE_KEYS.PORTFOLIO_COMPARISON}public:${args.sort_by}:${args.sort_order}:${args.asset_filter ?? 'none'}:${args.min_positions}:${args.page_num}:${args.page_size}`

  const data = await withCache(cacheKey, 600, async () => {
    const { data: rows, error: dbError } = await supabase.rpc('get_public_portfolios', args)
    if (dbError) throw new Error(dbError.message)
    return ((rows ?? []) as PublicPortfolioRow[]).map(toPublicPortfolio)
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
