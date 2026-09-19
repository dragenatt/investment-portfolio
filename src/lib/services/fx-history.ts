// Historical currency conversion — the I/O half of fx.ts.
//
// Lived inside the portfolio history route (3.1). The nightly notification job
// values a book back through history too, and a second copy of "which pairs,
// fetched how, keyed how" is exactly the duplication that let the chart and the
// header disagree in the first place.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory, symbolCurrencies } from './price-history'
import { buildConversion, fxPairSymbol, type Conversion, type RateSeries } from './fx'

/**
 * A multiplier per symbol and date into `base`.
 *
 * The chart used to sum provider closes directly, so a book holding AAPL in
 * dollars and FEMSAUBD.MX in pesos had those added together as one number —
 * which the page then printed beside a header already converted to the base
 * currency. Two readings of the same quantity, seventeen times apart.
 *
 * The rate used is the one for EACH DATE, not today's applied backwards: the FX
 * pairs have daily history and it costs one more fetch to be right.
 */
export async function historicalConversion(
  supabase: SupabaseClient,
  symbols: string[],
  base: string,
  from: string,
): Promise<Conversion> {
  const currencyBySymbol = await symbolCurrencies(supabase, symbols)
  const needed = [...new Set([...Object.values(currencyBySymbol), base.toUpperCase()])]
    .map(fxPairSymbol)
    .filter((pair): pair is string => pair !== null)

  const usdRates: RateSeries = {}
  if (needed.length > 0) {
    // FX pairs are symbols like any other, so the stored-first chain and its
    // write-through work on them unchanged.
    const { rows } = await fetchAdjustedPriceHistory(supabase, needed, { range: '6mo' })
    for (const row of rows) {
      if (row.date < from) continue
      const currency = row.symbol.replace(/^USD/, '').replace(/=X$/, '')
      usdRates[currency] ??= {}
      usdRates[currency][row.date] = row.close
    }
  }

  return buildConversion({ currencyBySymbol, base: base.toUpperCase(), usdRates })
}
