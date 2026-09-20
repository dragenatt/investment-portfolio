import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'
import { serviceRoleClient } from '@/lib/supabase/admin'
import {
  BASE_CURRENCY,
  LAST_RESORT_RATES,
  currenciesToCover,
  pairFor,
} from '@/lib/utils/fx-pairs'

async function getHandler() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // One read of the shared quote table answers both questions: which
  // currencies anything is quoted in, and which of their pairs are already
  // stored and still current. It is a few dozen rows.
  const { data: stored } = await supabase
    .from('current_prices')
    .select('symbol, price, currency, expires_at')

  const rows = stored ?? []
  const now = new Date()
  const fresh = new Map(
    rows
      .filter((row) => row.expires_at && new Date(row.expires_at) > now)
      .map((row) => [row.symbol, row.price] as const),
  )

  const rates: Record<string, number> = { [BASE_CURRENCY]: 1 }

  for (const currency of currenciesToCover(rows)) {
    const pair = pairFor(currency)

    const cached = fresh.get(pair)
    if (cached) {
      rates[currency] = cached
      continue
    }

    const quote = await getQuote(pair)
    if (quote?.price) {
      rates[currency] = quote.price

      // Cache for 1 hour. current_prices is shared and no longer writable by
      // users (migration 018), so the cache write goes through the service role.
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
      await serviceRoleClient()?.from('current_prices').upsert({
        symbol: pair,
        exchange: 'FX',
        price: quote.price,
        change_pct: quote.changePct ?? 0,
        volume: 0,
        currency: BASE_CURRENCY,
        source: 'yahoo',
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'symbol,exchange' })
      continue
    }

    // The provider did not answer. The last rate this app observed, however
    // old, is a real number from a real market; a constant is not. Only with
    // no observation at all does the documented last resort apply (C6: a
    // silent hard-coded rate was the audit's integrity finding for this route).
    const lastSeen = rows.find((row) => row.symbol === pair)?.price
    if (lastSeen) {
      rates[currency] = lastSeen
      console.warn(`[rates] ${pair}: provider unavailable, using the last stored rate`)
      continue
    }

    const constant = LAST_RESORT_RATES[currency]
    if (constant) {
      rates[currency] = constant
      console.error(`[rates] ${pair}: no provider and no stored observation, using last-resort constant`)
      continue
    }

    // No provider, no stored rate, no documented constant. Saying nothing is
    // the honest answer: convertCurrency reports the amount as unconverted and
    // the screen says so, which is better than a number nobody can source.
    console.error(`[rates] ${pair}: no rate available for ${currency}`)
  }

  return success(rates)
}

export const GET = apiHandler(getHandler)
