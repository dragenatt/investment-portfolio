import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'
import { serviceRoleClient } from '@/lib/supabase/admin'

const FOREX_PAIRS = [
  { pair: 'USDMXN=X', currency: 'MXN' },
  { pair: 'USDEUR=X', currency: 'EUR' },
] as const

/**
 * Used only when the provider is down AND no rate was ever stored — a fresh
 * database with Yahoo unreachable. Leaving the currency out instead would be
 * worse: convertCurrency returns the amount unconverted when a rate is missing,
 * which shows pesos as dollars. Approximate USD rates, mid-2026.
 */
const LAST_RESORT_RATES: Record<(typeof FOREX_PAIRS)[number]['currency'], number> = { MXN: 17.5, EUR: 0.92 }

async function getHandler() {
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
      // current_prices is shared and no longer writable by users (migration
      // 018), so the cache write goes through the service role.
      await serviceRoleClient()?.from('current_prices').upsert({
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
      // Yahoo did not answer. The last rate this app observed, however old, is
      // a real number from a real market; a constant is not. Only with no
      // observation at all does the documented last resort apply (C6: a silent
      // hard-coded rate was the audit's integrity finding for this route).
      const { data: lastSeen } = await supabase
        .from('current_prices')
        .select('price, fetched_at')
        .eq('symbol', pair)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastSeen?.price) {
        rates[currency] = lastSeen.price
        console.warn(`[rates] ${pair}: provider unavailable, using last observed rate from ${lastSeen.fetched_at}`)
      } else {
        rates[currency] = LAST_RESORT_RATES[currency]
        console.error(`[rates] ${pair}: no provider and no stored observation, using last-resort constant`)
      }
    }
  }

  return success(rates)
}

export const GET = apiHandler(getHandler)
