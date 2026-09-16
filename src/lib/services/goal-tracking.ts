// A goal's progress against the portfolio it is tied to. The I/O half of
// goals.ts, which stays pure.
//
// Lived inline in the goal detail route. The goals LIST needs the same answer
// for every goal, and a second copy of "value the book, then compare with the
// plan" in the list route is the duplication rule 2 of the roadmap forbids.
//
// It also converts now. Holdings quote in their own currency and the goal is
// denominated in one — the same mixing that put the value chart seventeen times
// off its header (3.1) would otherwise put a peso goal's progress bar at a
// fraction of the truth for any book holding dollar assets.

import type { SupabaseClient } from '@supabase/supabase-js'
import { goalProgress, classifyPace, type GoalProgress, type GoalSnapshot, type Pace } from './goals'
import { getBatchQuotes } from './market'
import { symbolCurrencies } from './price-history'
import { buildConversion, fxPairSymbol } from './fx'

export type GoalRow = {
  id: string
  name: string
  portfolio_id: string | null
  currency: string
  target_amount: number
  start_date: string
  target_date: string
  starting_capital: number
  monthly_contribution: number
  expected_annual_return: number | null
  status: string
}

export type GoalTracking = GoalProgress & {
  pace: Pace
  message: string
  /** Holdings that could not be converted into the goal's currency. */
  unconverted: string[]
}

/**
 * The moderate assumption a goal saved without one falls back to, so it still
 * tracks. The advisor records the real one when it creates a goal.
 */
const FALLBACK_ANNUAL_RETURN = 0.07

export function toSnapshot(goal: GoalRow): GoalSnapshot {
  return {
    targetAmount: Number(goal.target_amount),
    startDate: goal.start_date,
    targetDate: goal.target_date,
    startingCapital: Number(goal.starting_capital),
    plannedMonthlyContribution: Number(goal.monthly_contribution),
    expectedAnnualReturn: goal.expected_annual_return ?? FALLBACK_ANNUAL_RETURN,
  }
}

/**
 * Progress for every goal tied to a portfolio; goals with none map to null.
 *
 * Positions and quotes are fetched once per portfolio, not once per goal, so a
 * list of goals over the same book costs one round of quotes.
 */
export async function trackGoals(
  supabase: SupabaseClient,
  goals: GoalRow[],
  asOf: Date = new Date(),
): Promise<Map<string, GoalTracking | null>> {
  const result = new Map<string, GoalTracking | null>()
  const tied = goals.filter((goal) => goal.portfolio_id)
  for (const goal of goals) if (!goal.portfolio_id) result.set(goal.id, null)
  if (tied.length === 0) return result

  const portfolioIds = [...new Set(tied.map((goal) => goal.portfolio_id!))]
  const { data: positions } = await supabase
    .from('positions')
    .select('portfolio_id, symbol, quantity, avg_cost, currency')
    .in('portfolio_id', portfolioIds)
    .gt('quantity', 0)

  const symbols = [...new Set((positions ?? []).map((p) => p.symbol as string))]

  const prices: Record<string, number> = {}
  if (symbols.length > 0) {
    try {
      const quotes = await getBatchQuotes(symbols)
      for (const [symbol, quote] of Object.entries(quotes)) {
        if (quote.price != null && Number.isFinite(quote.price)) prices[symbol] = quote.price
      }
    } catch {
      // Average cost stands in; progress degrades rather than fails.
    }
  }

  // Today's rates, for today's valuation.
  const quoteCurrency = await symbolCurrencies(supabase, symbols)
  const currencies = new Set<string>([
    ...Object.values(quoteCurrency),
    ...(positions ?? []).map((p) => String(p.currency ?? 'USD').toUpperCase()),
    ...tied.map((goal) => goal.currency.toUpperCase()),
  ])
  const pairs = [...currencies].map(fxPairSymbol).filter((pair): pair is string => pair !== null)
  const today = asOf.toISOString().slice(0, 10)
  const usdRates: Record<string, Record<string, number>> = {}
  if (pairs.length > 0) {
    const { data: rates } = await supabase.from('current_prices').select('symbol, price').in('symbol', pairs)
    for (const row of rates ?? []) {
      const code = String(row.symbol).replace(/^USD/, '').replace(/=X$/, '')
      const price = Number(row.price)
      if (Number.isFinite(price) && price > 0) usdRates[code] = { [today]: price }
    }
  }

  for (const goal of tied) {
    const base = goal.currency.toUpperCase()
    const book = (positions ?? []).filter((p) => p.portfolio_id === goal.portfolio_id)
    if (book.length === 0) {
      result.set(goal.id, null)
      continue
    }

    // Market value in the quote currency; the cost basis in the currency the
    // cost was recorded in. Two different units, converted separately.
    const marketSymbols: Record<string, string> = {}
    const costSymbols: Record<string, string> = {}
    for (const p of book) {
      marketSymbols[p.symbol] = quoteCurrency[p.symbol] ?? ''
      costSymbols[p.symbol] = String(p.currency ?? '').toUpperCase()
    }
    const market = buildConversion({ currencyBySymbol: marketSymbols, base, usdRates })
    const cost = buildConversion({ currencyBySymbol: costSymbols, base, usdRates })

    let currentValue = 0
    let contributedToDate = 0
    for (const p of book) {
      const quantity = Number(p.quantity)
      const avgCost = Number(p.avg_cost)
      const quoted = prices[p.symbol]
      currentValue += quoted !== undefined
        ? quantity * quoted * market.factor(p.symbol, today)
        : quantity * avgCost * cost.factor(p.symbol, today)
      contributedToDate += quantity * avgCost * cost.factor(p.symbol, today)
    }

    const progress = goalProgress(toSnapshot(goal), { currentValue, contributedToDate }, asOf)
    result.set(
      goal.id,
      progress
        ? {
            ...progress,
            ...classifyPace(progress.deviationPct),
            unconverted: [...new Set([...market.unknownCurrency, ...market.missingRate, ...cost.missingRate])],
          }
        : null,
    )
  }

  return result
}
