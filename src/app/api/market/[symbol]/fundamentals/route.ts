import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { withCacheStaleWhileRevalidate } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { apiHandler } from '@/lib/api/handler'

/** No stored fundamentals and no quote: the symbol is unknown, which is a 404, not a server error. */
class SymbolNotFound extends Error {}

async function getHandler(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Wrap everything in a stale-while-revalidate cache
  let data
  try {
    data = await withCacheStaleWhileRevalidate(
    `${CACHE_KEYS.MARKET_FUNDAMENTALS}${symbol.toUpperCase()}`,
    86400, // 24 hour TTL
    3600,  // stale after 1 hour
    async () => {
      // Check cache (not expired)
      const { data: cached } = await supabase
        .from('company_data')
        .select('*')
        .eq('symbol', symbol.toUpperCase())
        .gt('expires_at', new Date().toISOString())
        .single()

      if (cached) return cached

      // Fallback: return stale data if available
      const { data: stale } = await supabase
        .from('company_data')
        .select('*')
        .eq('symbol', symbol.toUpperCase())
        .single()

      if (stale) return { ...stale, _stale: true }

      // No cache at all: return basic quote data
      const quote = await getQuote(symbol)
      // Thrown, not returned: a null here would be cached for a day.
      if (!quote) throw new SymbolNotFound()

      return {
        symbol: quote.symbol,
        name: quote.symbol,
        market_cap: null,
        pe_ratio: null,
        eps: null,
        dividend_yield: null,
        week52_high: null,
        week52_low: null,
        _partial: true,
      }
    }
  )
  } catch (thrown) {
    // Positions in symbols no provider covers (COCA34, FIBRAMQ12, BITCOIN.XBT...)
    // were logged to error_events as server errors on every portfolio view.
    if (thrown instanceof SymbolNotFound) return error('Symbol not found', 404)
    throw thrown
  }
  if (!data) return error('Symbol not found', 404)
  return success(data)
}

export const GET = apiHandler(getHandler)
