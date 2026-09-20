// Refreshing the stored exchange rates — the I/O half of utils/fx-pairs.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getBatchQuotes } from './market'
import { publishQuotes } from './quote-store'
import { currenciesToCover, pairFor } from '@/lib/utils/fx-pairs'

/**
 * Refresh the stored rate for every currency in use.
 *
 * The nightly job already fetches a quote for every held symbol; the currencies
 * those symbols trade in need the same treatment, or a book holding a yen asset
 * keeps whatever rate was last fetched by somebody's browser — which, for a
 * currency no display offers, is never. Returns how many rows were written.
 */
export async function refreshExchangeRates(writer: SupabaseClient): Promise<number> {
  const { data: stored } = await writer.from('current_prices').select('currency')
  const pairs = currenciesToCover(stored ?? []).map(pairFor)
  if (pairs.length === 0) return 0

  try {
    const quotes = await getBatchQuotes(pairs, { fresh: true })
    return await publishQuotes(writer, quotes)
  } catch (err) {
    console.warn('[fx] no se pudieron refrescar los tipos de cambio', err)
    return 0
  }
}
