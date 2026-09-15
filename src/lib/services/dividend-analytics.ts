import { type SupabaseClient } from '@supabase/supabase-js'

export type DividendRecord = { symbol: string; amount: number; date: string }

export type IncomeSummary = {
  totals: {
    mtd: number
    ytd: number
    all_time: number
    /** Dividends of the last 12 months over the portfolio's current value, %. Zero without a value. */
    portfolio_yield: number
  }
  by_position: Array<{ symbol: string; total: number; count: number }>
  monthly_history: Array<{ month: string; amount: number }>
}

/**
 * Income from recorded dividends, in the shape the income tab reads.
 *
 * The route used to return { summary, monthly_history } while the tab read
 * totals and by_position, so every figure on it was zero whatever had been
 * recorded. Pure, so the contract is tested rather than assumed.
 *
 * The yield is trailing: the last twelve months of dividends over what the
 * holdings are worth today. Nothing is estimated for dividends not recorded.
 */
export function summariseIncome(dividends: DividendRecord[], portfolioValue: number, now: Date = new Date()): IncomeSummary {
  const yearStart = `${now.getUTCFullYear()}-01-01`
  const monthStart = `${now.toISOString().slice(0, 7)}-01`
  const yearAgo = new Date(now)
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)
  const trailingStart = yearAgo.toISOString().slice(0, 10)

  let mtd = 0
  let ytd = 0
  let allTime = 0
  let trailing = 0
  const monthly = new Map<string, number>()
  const byPosition = new Map<string, { total: number; count: number }>()

  for (const d of dividends) {
    if (!Number.isFinite(d.amount)) continue
    const date = d.date.slice(0, 10)
    allTime += d.amount
    if (date >= yearStart) ytd += d.amount
    if (date >= monthStart) mtd += d.amount
    if (date > trailingStart) trailing += d.amount
    monthly.set(date.slice(0, 7), (monthly.get(date.slice(0, 7)) ?? 0) + d.amount)
    const position = byPosition.get(d.symbol) ?? { total: 0, count: 0 }
    position.total += d.amount
    position.count += 1
    byPosition.set(d.symbol, position)
  }

  return {
    totals: {
      mtd,
      ytd,
      all_time: allTime,
      portfolio_yield: portfolioValue > 0 ? (trailing / portfolioValue) * 100 : 0,
    },
    by_position: [...byPosition.entries()].map(([symbol, p]) => ({ symbol, total: p.total, count: p.count })).sort((a, b) => b.total - a.total),
    monthly_history: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })),
  }
}

export async function getIncomeAnalytics(supabase: SupabaseClient, portfolioId: string): Promise<IncomeSummary> {
  // Get dividend transactions
  const { data: dividends } = await supabase
    .from('transactions')
    .select('quantity, price, executed_at, position:positions!inner(portfolio_id, symbol)')
    .eq('type', 'dividend')
    .eq('position.portfolio_id', portfolioId)
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  // What the holdings are worth now, for the yield: the stored quote, else cost.
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', portfolioId)
    .gt('quantity', 0)
  const symbols = (positions ?? []).map((p) => p.symbol as string)
  const { data: prices } = symbols.length
    ? await supabase.from('current_prices').select('symbol, price').in('symbol', symbols)
    : { data: [] }
  const priceBySymbol = new Map((prices ?? []).map((p) => [p.symbol as string, Number(p.price)]))
  const portfolioValue = (positions ?? []).reduce(
    (sum, p) => sum + Number(p.quantity) * (priceBySymbol.get(p.symbol as string) ?? Number(p.avg_cost)),
    0,
  )

  return summariseIncome(
    (dividends ?? []).map((d) => ({
      symbol: (d.position as unknown as { symbol: string }).symbol,
      amount: (d.quantity as number) * (d.price as number),
      date: d.executed_at as string,
    })),
    portfolioValue,
  )
}
