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

export type TodaysFactors = {
  /** What one unit of each symbol's close is worth in `base` today. 1 where unknown. */
  factors: Record<string, number>
  /** Symbols whose quote currency or rate is unknown, left in their own unit. */
  unconverted: string[]
  base: string
}

/**
 * The multiplier that puts each symbol's closes into `base`, at TODAY's rate.
 *
 * For the engines that weight a book from its price history — risk, Monte
 * Carlo, optimisation, factors. Summing quantity × close across a dollar-quoted
 * and a peso-quoted holding added two units as one: the weights of a mixed book
 * were wrong, and every amount was in no currency at all while the screen
 * labelled it with the portfolio's.
 *
 * Today's rate for every date, on purpose. Scaling a series by a constant keeps
 * each holding's own return, so the risk figures stay measured in the currency
 * each instrument trades in — as the backtest and the stress test measure them
 * — while the weights and every amount come out in one unit. Converting each
 * date at its own rate would put the exchange rate inside every volatility and
 * beta: a different model, not a unit fix.
 */
export async function todaysSymbolFactors(
  supabase: SupabaseClient,
  symbols: string[],
  base: string,
  asOf: Date = new Date(),
): Promise<TodaysFactors> {
  const baseCode = (base || 'USD').toUpperCase()
  const today = asOf.toISOString().slice(0, 10)
  const unique = [...new Set(symbols)]
  const quoteCurrency = await symbolCurrencies(supabase, unique)
  const usdRates = await todaysUsdRates(supabase, [...Object.values(quoteCurrency), baseCode], today)
  const conversion = buildConversion({ currencyBySymbol: quoteCurrency, base: baseCode, usdRates })
  const factors = Object.fromEntries(unique.map((symbol) => [symbol, conversion.factor(symbol, today)]))
  const unconverted = [...new Set([...conversion.unknownCurrency, ...conversion.missingRate])]
  return { factors, unconverted, base: baseCode }
}

/** Closes multiplied into base by `todaysSymbolFactors`; rows of other symbols pass through. */
export function closesInBase<T extends { symbol: string; close: number }>(rows: T[], factors: Record<string, number>): T[] {
  return rows.map((row) => (row.symbol in factors ? { ...row, close: row.close * factors[row.symbol] } : row))
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
