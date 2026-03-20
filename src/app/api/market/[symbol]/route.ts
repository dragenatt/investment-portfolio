import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Try Supabase cache first
  const { data: cached } = await supabase
    .from('current_prices')
    .select('*')
    .eq('symbol', symbol)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (cached) return success(cached)

  // Fallback to Yahoo Finance
  const quote = await getQuote(symbol)
  if (!quote) return error('Symbol not found', 404)

  return success(quote)
}
