import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { getBatchQuotes } from '@/lib/services/market'
import { summariseBookHistory, type RawTransaction } from '@/lib/services/trade-history'
import { symbolCurrencies } from '@/lib/services/price-history'
import { todaysUsdRates } from '@/lib/services/book-valuation'
import { buildConversion, type Conversion } from '@/lib/services/fx'

/**
 * What every position's transactions add up to.
 *
 * The split that matters is realised versus unrealised. A realised gain is money
 * that exists and is usually taxable; an unrealised one is a price quote that
 * can evaporate before it is ever collected. A single "P&L" number hides that
 * difference, and it is the difference an investor most needs to see.
 *
 * The quote is converted into each position's cost currency and totals stay per
 * currency — see summariseBookHistory for why both were wrong before 4.6.
 */
export const GET = apiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: positions } = await supabase
    .from('positions')
    .select('id, symbol, currency')
    .eq('portfolio_id', id)

  if (!positions || positions.length === 0) return success({ positions: [], totals: [] })

  const { data: transactions } = await supabase
    .from('transactions')
    .select('position_id, type, quantity, price, fees, currency, executed_at')
    .in('position_id', positions.map((p) => p.id))
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  const symbols = [...new Set(positions.map((p) => p.symbol as string))]
  const quotes: Record<string, number> = {}
  try {
    const batch = await getBatchQuotes(symbols)
    for (const [symbol, quote] of Object.entries(batch)) {
      if (quote.price != null && Number.isFinite(quote.price) && quote.price > 0) quotes[symbol] = quote.price
    }
  } catch {
    // Without a quote the remaining units are valued at cost (trade-history.ts),
    // which reports zero unrealised P&L and says so, rather than an invented one.
  }

  const byPosition = new Map<string, RawTransaction[]>()
  for (const txn of transactions ?? []) {
    const bucket = byPosition.get(txn.position_id)
    if (bucket) bucket.push(txn as RawTransaction)
    else byPosition.set(txn.position_id, [txn as RawTransaction])
  }

  // One conversion per cost currency, at today's rate.
  const today = new Date().toISOString().slice(0, 10)
  const quoteCurrency = await symbolCurrencies(supabase, symbols)
  const costCurrencies = [...new Set(positions.map((p) => String(p.currency ?? 'USD').toUpperCase()))]
  const usdRates = await todaysUsdRates(supabase, [...Object.values(quoteCurrency), ...costCurrencies], today)
  const conversions = new Map<string, Conversion>()
  const quoteToCost = (symbol: string, costCurrency: string) => {
    let conversion = conversions.get(costCurrency)
    if (!conversion) {
      conversion = buildConversion({ currencyBySymbol: quoteCurrency, base: costCurrency, usdRates })
      conversions.set(costCurrency, conversion)
    }
    const factor = conversion.factor(symbol, today)
    const converted = !conversion.unknownCurrency.includes(symbol) && !conversion.missingRate.includes(symbol)
    return { factor, converted }
  }

  return success(summariseBookHistory(positions, byPosition, quotes, quoteCurrency, quoteToCost))
})
