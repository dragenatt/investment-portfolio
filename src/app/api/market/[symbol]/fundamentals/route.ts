import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { withCacheStaleWhileRevalidate } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Wrap everything in a stale-while-revalidate cache
  const data = await withCacheStaleWhileRevalidate(
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
      if (!quote) throw new Error('Symbol not found')

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
  if (!data) return error('Symbol not found', 404)
  return success(data)
}
