import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

const FOREX_PAIRS = [
  { pair: 'USDMXN=X', currency: 'MXN' },
  { pair: 'USDEUR=X', currency: 'EUR' },
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const rates: Record<string, number> = { USD: 1 }

  // Check cache first
  const { data: cached } = await supabase
    .from('current_prices')
    .select('symbol, price, expires_at')
    .in('symbol', FOREX_PAIRS.map(p => p.pair))
    .gt('expires_at', new Date().toISOString())

  const cachedMap = new Map((cached || []).map(c => [c.symbol, c.price]))

  for (const { pair, currency } of FOREX_PAIRS) {
    if (cachedMap.has(pair)) {
      rates[currency] = cachedMap.get(pair)!
      continue
    }

    // Fetch from Yahoo Finance
    const quote = await getQuote(pair)
    if (quote?.price) {
      rates[currency] = quote.price

      // Cache for 1 hour
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
      await supabase.from('current_prices').upsert({
        symbol: pair,
        exchange: 'FX',
        price: quote.price,
        change_pct: quote.changePct ?? 0,
        volume: 0,
        currency: 'USD',
        source: 'yahoo',
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'symbol,exchange' })
    } else {
      // Fallback to hardcoded
      rates[currency] = currency === 'MXN' ? 17.5 : 0.92
    }
  }

  return success(rates)
}
