// What each holding is worth today, in one currency.
//
// Almost every route that weighted a book did it the same way — quantity times
// the latest quote, falling back to the average cost — and summed the results.
// That adds a dollar-quoted AAPL to a peso-quoted FEMSAUBD.MX as though they
// were one unit, so every weight, every "largest holding" and every sector share
// was wrong for any book holding more than one currency. The value chart (3.1)
// was the most visible case; exposure, stress, the portfolio backtest and goal
// tracking all did it too.
//
// Two different units hide in a position row, and they are converted separately:
//
//   - the QUOTE is in the currency the instrument trades in (symbolCurrencies),
//   - the AVERAGE COST is in the currency the purchase was recorded in
//     (positions.currency), which is often not the same thing.
//
// Today's rates, because this is today's valuation. Historical series convert
// date by date elsewhere (portfolio/history).

import type { SupabaseClient } from '@supabase/supabase-js'
import { symbolCurrencies } from './price-history'
import { buildConversion, fxPairSymbol, type RateSeries } from './fx'

export type ValuablePosition = {
  symbol: string
  quantity: number
  avg_cost: number
  /** The currency the cost was recorded in. */
  currency?: string | null
}

export type BookValuation = {
  /** Each position's value in `base`, in the order given. */
  values: number[]
  total: number
  /** Positions whose quote or cost could not be put into `base`. */
  unconverted: string[]
  /** What each symbol is quoted in, where known. */
  quoteCurrency: Record<string, string>
  base: string
}

/** One USD in each currency, today, from the stored FX quotes. */
export async function todaysUsdRates(
  supabase: SupabaseClient,
  currencies: string[],
  today: string,
): Promise<RateSeries> {
  const pairs = [...new Set(currencies.map((c) => c.toUpperCase()))]
    .map(fxPairSymbol)
    .filter((pair): pair is string => pair !== null)
  const rates: RateSeries = {}
  if (pairs.length === 0) return rates
  const { data } = await supabase.from('current_prices').select('symbol, price').in('symbol', pairs)
  for (const row of data ?? []) {
    const price = Number(row.price)
    if (Number.isFinite(price) && price > 0) {
      rates[String(row.symbol).replace(/^USD/, '').replace(/=X$/, '')] = { [today]: price }
    }
  }
  return rates
}

/**
 * Value positions in `base`: the live quote converted from its quote currency,
 * or the average cost converted from the currency it was recorded in.
 *
 * A position that cannot be converted keeps its own-currency value and is
 * named in `unconverted`, rather than being dropped — a book that seems to
 * shrink because a holding vanished is a worse error than one with a stated gap.
 */
export async function valueBookInBase(
  supabase: SupabaseClient,
  positions: ValuablePosition[],
  prices: Record<string, number>,
  base: string,
  asOf: Date = new Date(),
): Promise<BookValuation> {
  const baseCode = (base || 'USD').toUpperCase()
  const today = asOf.toISOString().slice(0, 10)
  const symbols = [...new Set(positions.map((p) => p.symbol))]
  const quoteCurrency = await symbolCurrencies(supabase, symbols)

  const usdRates = await todaysUsdRates(
    supabase,
    [...Object.values(quoteCurrency), ...positions.map((p) => String(p.currency ?? 'USD')), baseCode],
    today,
  )

  const market = buildConversion({ currencyBySymbol: quoteCurrency, base: baseCode, usdRates })
  const cost = buildConversion({
    currencyBySymbol: Object.fromEntries(positions.map((p) => [p.symbol, String(p.currency ?? '').toUpperCase()])),
    base: baseCode,
    usdRates,
  })

  const unconverted = new Set<string>()
  const values = positions.map((p) => {
    const quantity = Number(p.quantity)
    const quote = prices[p.symbol]
    if (quote !== undefined && Number.isFinite(quote)) {
      const factor = market.factor(p.symbol, today)
      if (market.unknownCurrency.includes(p.symbol) || market.missingRate.includes(p.symbol)) unconverted.add(p.symbol)
      return quantity * quote * factor
    }
    const factor = cost.factor(p.symbol, today)
    if (cost.unknownCurrency.includes(p.symbol) || cost.missingRate.includes(p.symbol)) unconverted.add(p.symbol)
    return quantity * Number(p.avg_cost) * factor
  })

  return {
    values,
    total: values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0),
    unconverted: [...unconverted],
    quoteCurrency,
    base: baseCode,
  }
}
