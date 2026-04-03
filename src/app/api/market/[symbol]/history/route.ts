import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') || '1mo'

  const history = await withCache(
    `${CACHE_KEYS.MARKET_HISTORY}${symbol.toUpperCase()}:${range}`,
    range === '1d' ? 300 : 3600, // 5 min for intraday, 1 hour for longer ranges
    () => getHistory(symbol, range)
  )
  return success(history)
}
