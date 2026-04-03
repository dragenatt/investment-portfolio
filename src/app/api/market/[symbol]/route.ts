import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Try Redis cache first, then Supabase, then market service
  let data
  try {
    data = await withCache(
      `${CACHE_KEYS.PRICE}${symbol.toUpperCase()}`,
      300, // 5 min
      async () => {
        const { data: cached } = await supabase
          .from('current_prices')
          .select('*')
          .eq('symbol', symbol)
          .gt('expires_at', new Date().toISOString())
          .single()
        if (cached) return cached
        const quote = await getQuote(symbol)
        if (!quote) throw new Error('Symbol not found')
        return quote
      }
    )
  } catch {
    return error('Symbol not found', 404)
  }
  if (!data) return error('Symbol not found', 404)

  const res = NextResponse.json({ data, error: null }, { status: 200 })
  res.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  return res
}
