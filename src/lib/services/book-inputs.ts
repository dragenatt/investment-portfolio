// What a book history is rebuilt from: the portfolio's transactions and the
// closes of what it held. Shared by the returns route (TWR) and temporal
// attribution (P2-4), so both read exactly the same inputs and the attribution
// decomposes the very return the returns tab shows.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookTransaction, PriceMap } from '@/lib/services/portfolio-history'
import { getHistory } from '@/lib/services/market'
import { topUpStoredHistory } from '@/lib/services/price-history'
import { combinePriceSources, type PriceSource } from '@/lib/services/result-metadata'

export const RETURN_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const
export type ReturnPeriod = (typeof RETURN_PERIODS)[number]

/** First date (YYYY-MM-DD) inside a period ending today. Unknown periods mean one year. */
export function periodCutoff(period: string, now: Date = new Date()): string {
  const date = new Date(now)
  switch (period) {
    case '1M': date.setMonth(date.getMonth() - 1); break
    case '3M': date.setMonth(date.getMonth() - 3); break
    case '6M': date.setMonth(date.getMonth() - 6); break
    case 'YTD': date.setMonth(0); date.setDate(1); break
    case '1Y': date.setFullYear(date.getFullYear() - 1); break
    case 'ALL': date.setFullYear(2020); break
    default: date.setFullYear(date.getFullYear() - 1)
  }
  return date.toISOString().split('T')[0]
}

/** The market-data range that covers a period. */
export function periodToRange(period: string): string {
  switch (period) {
    case '1M': return '1mo'
    case '3M': return '3mo'
    case '6M': return '6mo'
    case 'YTD': return '1y'
    case '1Y': return '1y'
    case 'ALL': return 'max'
    default: return '1y'
  }
}

/**
 * Every transaction of the portfolio, in the order it happened. All of them, not
 * only those in the window: the holdings on the window's first day depend on
 * everything bought before it.
 */
export async function loadBookTransactions(supabase: SupabaseClient, pid: string): Promise<BookTransaction[]> {
  const { data } = await supabase
    .from('transactions')
    .select('executed_at, type, quantity, price, currency, position:positions!inner(portfolio_id, symbol, currency)')
    .eq('position.portfolio_id', pid)
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  return (data ?? []).map((t) => ({
    executed_at: t.executed_at as string,
    type: t.type as BookTransaction['type'],
    symbol: (t.position as unknown as { symbol: string }).symbol,
    quantity: t.quantity as number,
    price: t.price as number,
    // The transaction's own currency, else the position's.
    currency: String((t.currency as string | null) ?? (t.position as unknown as { currency: string | null }).currency ?? 'USD').toUpperCase(),
  }))
}

/**
 * Closes from the cutoff on: the stored price history first — with the sessions
 * it is missing fetched and written through — and the market provider when it
 * has fewer than 5 rows.
 */
export async function loadPriceMap(
  supabase: SupabaseClient,
  symbols: string[],
  cutoff: string,
  period: string,
): Promise<PriceMap> {
  return (await loadPriceMapWithSource(supabase, symbols, cutoff, period)).prices
}

/** loadPriceMap, reporting which tier the closes came from (P2-10). */
export async function loadPriceMapWithSource(
  supabase: SupabaseClient,
  symbols: string[],
  cutoff: string,
  period: string,
): Promise<{ prices: PriceMap; source: PriceSource }> {
  const priceMap: PriceMap = {}
  const tiers: PriceSource[] = []
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const { data: cached } = await supabase
          .from('price_history')
          .select('date, close')
          .eq('symbol', symbol)
          .gte('date', cutoff)
          .order('date', { ascending: true })

        if (cached && cached.length >= 5) {
          priceMap[symbol] = {}
          for (const row of cached) priceMap[symbol][row.date] = row.close
          const added = await topUpStoredHistory({ [symbol]: cached[cached.length - 1].date as string })
          for (const row of added) priceMap[symbol][row.date] = row.close
          tiers.push(added.length > 0 ? 'mixed' : 'stored')
          return
        }

        const history = await getHistory(symbol, periodToRange(period))
        tiers.push(history.length > 0 ? 'provider' : 'none')
        priceMap[symbol] = {}
        for (const point of history) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          if (date >= cutoff) priceMap[symbol][date] = point.close
        }
      } catch {
        // A symbol without prices is valued at its last trade price by the book history.
      }
    }),
  )
  return { prices: priceMap, source: combinePriceSources(...tiers) }
}
