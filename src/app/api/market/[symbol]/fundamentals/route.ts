import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Check cache (not expired)
  const { data: cached } = await supabase
    .from('company_data')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single()

  if (cached) return success(cached)

  // Fallback: return stale data if available
  const { data: stale } = await supabase
    .from('company_data')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .single()

  if (stale) return success({ ...stale, _stale: true })

  // No cache at all: return basic quote data
  const quote = await getQuote(symbol)
  if (!quote) return error('Symbol not found', 404)

  return success({
    symbol: quote.symbol,
    name: quote.symbol,
    market_cap: null,
    pe_ratio: null,
    eps: null,
    dividend_yield: null,
    week52_high: null,
    week52_low: null,
    _partial: true,
  })
}
