import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { getBatchQuotes } from '@/lib/services/market'
import { deriveTradeHistory, type RawTransaction } from '@/lib/services/trade-history'
import { addMoney } from '@/lib/utils/money'

/**
 * What every position's transactions add up to.
 *
 * The split that matters is realised versus unrealised. A realised gain is money
 * that exists and is usually taxable; an unrealised one is a price quote that
 * can evaporate before it is ever collected. A single "P&L" number hides that
 * difference, and it is the difference an investor most needs to see.
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

  if (!positions || positions.length === 0) return success({ positions: [], totals: null })

  const { data: transactions } = await supabase
    .from('transactions')
    .select('position_id, type, quantity, price, fees, currency, executed_at')
    .in('position_id', positions.map((p) => p.id))
    .order('executed_at', { ascending: true })

  const priceMap: Record<string, number> = {}
  try {
    const quotes = await getBatchQuotes(positions.map((p) => p.symbol))
    for (const [symbol, quote] of Object.entries(quotes)) {
      if (quote.price != null) priceMap[symbol] = quote.price
    }
  } catch {
    // Without a quote the unrealised figure falls back to cost, which reports
    // zero unrealised P&L rather than an invented one.
  }

  const byPosition = new Map<string, RawTransaction[]>()
  for (const txn of transactions ?? []) {
    const bucket = byPosition.get(txn.position_id)
    if (bucket) bucket.push(txn as RawTransaction)
    else byPosition.set(txn.position_id, [txn as RawTransaction])
  }

  const results = positions
    .map((position) => {
      const txns = byPosition.get(position.id) ?? []
      const history = deriveTradeHistory(txns, priceMap[position.symbol] ?? 0)
      return history ? { symbol: position.symbol, currency: position.currency, ...history } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (results.length === 0) return success({ positions: [], totals: null })

  const totals = results.reduce(
    (acc, r) => ({
      realizedPnl: addMoney(acc.realizedPnl, r.realizedPnl),
      unrealizedPnl: addMoney(acc.unrealizedPnl, r.unrealizedPnl),
      totalFees: addMoney(acc.totalFees, r.totalFees),
      dividendsReceived: addMoney(acc.dividendsReceived, r.dividendsReceived),
      marketValue: addMoney(acc.marketValue, r.marketValue),
      costBasis: addMoney(acc.costBasis, r.costBasis),
    }),
    {
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalFees: 0,
      dividendsReceived: 0,
      marketValue: 0,
      costBasis: 0,
    },
  )

  return success({
    positions: results,
    totals,
    // Totals are summed across whatever currencies the positions are in. Saying
    // so beats silently presenting a number that adds pesos to dollars.
    currencies: [...new Set(results.map((r) => r.currency))],
  })
})
