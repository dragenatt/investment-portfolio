// Publishing quotes to current_prices — the I/O half of live-prices.ts.
//
// current_prices is the stored quote every screen and every analytics route
// falls back to, and the table Realtime streams from. Only two paths wrote to
// it, both driven by a browser asking for the symbols on screen, so a holding
// nobody had open kept whatever price it was last looked at with: on
// production, held symbols were found 43 hours old while the ones on the
// owner's screen were minutes old. The nightly job already fetches a fresh
// quote for every held symbol to value the snapshots; it now publishes them.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchQuote } from './market'
import { changedRows, quotesToPriceRows, type StoredPrice } from './live-prices'

/**
 * Write the quotes that moved to current_prices, and say how many were written.
 *
 * Only changed, new or expired rows are written: rewriting an identical price
 * would have Realtime broadcast a change that is not one to every client
 * watching the symbol. A failure is reported, never thrown — publishing is a
 * side effect of whatever fetched the quotes, and must not cost it.
 */
export async function publishQuotes(
  writer: SupabaseClient,
  quotes: Record<string, BatchQuote>,
  now: number = Date.now(),
): Promise<number> {
  const rows = quotesToPriceRows(quotes, now)
  if (rows.length === 0) return 0

  const { data: stored } = await writer
    .from('current_prices')
    .select('symbol, exchange, price, change_pct, expires_at')
    .in('symbol', rows.map((row) => row.symbol))

  const toWrite = changedRows(rows, (stored ?? []) as StoredPrice[], now)
  if (toWrite.length === 0) return 0

  const { error } = await writer.from('current_prices').upsert(toWrite, { onConflict: 'symbol,exchange' })
  if (error) {
    console.warn('[quotes] no se pudieron publicar precios', error.message)
    return 0
  }
  return toWrite.length
}
