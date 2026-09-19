import { type SupabaseClient } from '@supabase/supabase-js'
import { historicalFx } from './fx-history'
import { valueBookInBase } from './book-valuation'

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

export type IncomeAnalytics = IncomeSummary & {
  /** The currency every amount is in: the portfolio's. */
  currency: string
  /** Holdings with a dividend or a value whose rate was unknown, left in their own unit. */
  unconverted: string[]
}

/**
 * The income tab's figures, every amount in the portfolio's currency.
 *
 * A dividend is converted at the rate of the day it was paid — what it was
 * worth when it arrived — and the holdings' value at today's. Summed as
 * recorded, a dollar dividend and a peso one were added as one unit, and the
 * tab printed the total as though it were already in the reader's currency.
 */
export async function getIncomeAnalytics(supabase: SupabaseClient, portfolioId: string): Promise<IncomeAnalytics> {
  const { data: portfolio } = await supabase.from('portfolios').select('base_currency').eq('id', portfolioId).maybeSingle()
  const base = String(portfolio?.base_currency ?? 'USD').toUpperCase()

  // Get dividend transactions
  const { data: dividends } = await supabase
    .from('transactions')
    .select('quantity, price, currency, executed_at, position:positions!inner(portfolio_id, symbol, currency)')
    .eq('type', 'dividend')
    .eq('position.portfolio_id', portfolioId)
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  // What the holdings are worth now, for the yield: the stored quote, else cost.
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost, currency')
    .eq('portfolio_id', portfolioId)
    .gt('quantity', 0)
  const symbols = (positions ?? []).map((p) => p.symbol as string)
  const { data: prices } = symbols.length
    ? await supabase.from('current_prices').select('symbol, price').in('symbol', symbols)
    : { data: [] }
  const quotes = Object.fromEntries((prices ?? []).map((p) => [p.symbol as string, Number(p.price)]))
  const valuation = await valueBookInBase(
    supabase,
    (positions ?? []).map((p) => ({ symbol: p.symbol as string, quantity: Number(p.quantity), avg_cost: Number(p.avg_cost), currency: p.currency as string | null })),
    quotes,
    base,
  )

  const rows = (dividends ?? []).map((d) => {
    const position = d.position as unknown as { symbol: string; currency: string | null }
    return {
      symbol: position.symbol,
      amount: (d.quantity as number) * (d.price as number),
      currency: String((d.currency as string | null) ?? position.currency ?? base).toUpperCase(),
      date: d.executed_at as string,
    }
  })
  const unconverted = new Set(valuation.unconverted)
  const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), new Date().toISOString()).slice(0, 10)
  const fx = rows.some((r) => r.currency !== base) ? await historicalFx(supabase, [], rows.map((r) => r.currency), base, earliest) : null
  const inBase = rows.map((r) => {
    const factor = r.currency === base ? 1 : fx?.cashFactor(r.currency, r.date.slice(0, 10)) ?? null
    if (factor === null) unconverted.add(r.symbol)
    return { symbol: r.symbol, amount: r.amount * (factor ?? 1), date: r.date }
  })

  return { ...summariseIncome(inBase, valuation.total), currency: base, unconverted: [...unconverted] }
}
