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
import { valueBookInBase } from './book-valuation'

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

  for (const goal of tied) {
    const book = (positions ?? []).filter((p) => p.portfolio_id === goal.portfolio_id)
    if (book.length === 0) {
      result.set(goal.id, null)
      continue
    }

    // Both figures in the goal's own currency — see book-valuation.ts. Market
    // value converts the quote from what it trades in; money paid in converts
    // the cost from what it was recorded in. With no prices passed, the second
    // call values every position at its cost.
    const current = await valueBookInBase(supabase, book, prices, goal.currency, asOf)
    const paidIn = await valueBookInBase(supabase, book, {}, goal.currency, asOf)

    const progress = goalProgress(toSnapshot(goal), { currentValue: current.total, contributedToDate: paidIn.total }, asOf)
    result.set(
      goal.id,
      progress
        ? { ...progress, ...classifyPace(progress.deviationPct), unconverted: [...new Set([...current.unconverted, ...paidIn.unconverted])] }
        : null,
    )
  }

  return result
}
