// Rebalancing — pure functions, no I/O.
//
// Four ways to decide a portfolio has wandered, because they disagree on
// purpose and a reader should see which one fired:
//
//   deviation — any holding is more than N points off its target
//   band      — any holding has left its own tolerance band
//   calendar  — a fixed period has elapsed, drift or no drift
//   risk      — the weights still look right but the risk behind them moved
//
// The last one is the interesting case. A holding can sit exactly on its 30%
// target while its volatility doubles, and no weight-based rule will ever
// notice. See risk-attribution.ts for where the risk shares come from.
//
// Nothing here executes anything. A plan is a proposal.

import { allocateMoney, roundMoney, subtractMoney } from '@/lib/utils/money'
import { validateWeights } from './validation'

export type Holding = { symbol: string; value: number }
export type TargetWeight = { symbol: string; targetWeight: number }

export type RebalanceMode = 'deviation' | 'band' | 'calendar' | 'always'
export type RebalanceTrigger = 'deviation' | 'band' | 'calendar' | 'risk' | 'none'
export type CalendarFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export type RebalanceAction = {
  symbol: string
  targetWeight: number
  currentWeight: number
  /** Current minus target, in percentage points. Positive means overweight. */
  deviationPp: number
  targetValue: number
  currentValue: number
  /** Positive to buy, negative to sell. */
  tradeValue: number
  action: 'buy' | 'sell' | 'hold'
}

export type RebalancePlan = {
  actions: RebalanceAction[]
  totalValue: number
  triggered: boolean
  trigger: RebalanceTrigger
  /** Share of the book that changes hands, as a percentage. */
  turnoverPct: number
  reason: string
}

export type PlanOptions = {
  mode: RebalanceMode
  /** For 'deviation': drift in percentage points that triggers a rebalance. */
  thresholdPp?: number
  /** For 'band': half-width of the tolerance band, in percentage points. */
  bandPp?: number
}

const HOLD_EPSILON = 0.005 // half a cent — below this a trade is not worth naming

function emptyPlan(reason: string, totalValue = 0): RebalancePlan {
  return { actions: [], totalValue, triggered: false, trigger: 'none', turnoverPct: 0, reason }
}

/**
 * Work out what it would take to bring a book back to its target weights.
 *
 * Target values are split with allocateMoney rather than multiplied one at a
 * time, so the targets add back up to the book exactly and the trades net to
 * zero — a rebalance moves money between holdings, it does not create or
 * destroy any, and a plan whose trades do not net out is a plan that quietly
 * asks the user for a deposit.
 */
export function planRebalance(
  holdings: Holding[],
  targets: TargetWeight[],
  options: PlanOptions,
): RebalancePlan {
  const totalValue = holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0)

  const weightCheck = validateWeights(targets.map((t) => t.targetWeight))
  if (!weightCheck.valid) {
    return emptyPlan(
      `Cannot plan a rebalance: the target weights do not describe a whole portfolio. ${weightCheck.reason}`,
      totalValue,
    )
  }

  if (totalValue <= 0) {
    return emptyPlan('There is nothing in this portfolio to rebalance yet.', totalValue)
  }

  const valueBySymbol = new Map(holdings.map((h) => [h.symbol, h.value]))
  const targetBySymbol = new Map(targets.map((t) => [t.symbol, t.targetWeight]))
  // A holding with no target is an exit, and a target with no holding is a new
  // buy; both belong in the plan.
  const symbols = [...new Set([...targetBySymbol.keys(), ...valueBySymbol.keys()])]

  const targetValues = allocateMoney(
    totalValue,
    symbols.map((s) => targetBySymbol.get(s) ?? 0),
  )

  const actions: RebalanceAction[] = symbols.map((symbol, i) => {
    const currentValue = valueBySymbol.get(symbol) ?? 0
    const targetWeight = targetBySymbol.get(symbol) ?? 0
    const targetValue = targetValues[i]
    const tradeValue = subtractMoney(targetValue, currentValue)
    return {
      symbol,
      targetWeight,
      currentWeight: currentValue / totalValue,
      deviationPp: (currentValue / totalValue - targetWeight) * 100,
      targetValue,
      currentValue,
      tradeValue,
      action: tradeValue > HOLD_EPSILON ? 'buy' : tradeValue < -HOLD_EPSILON ? 'sell' : 'hold',
    }
  })

  actions.sort((a, b) => Math.abs(b.deviationPp) - Math.abs(a.deviationPp))

  const worst = actions[0]
  const worstDrift = worst ? Math.abs(worst.deviationPp) : 0

  const bought = actions.filter((a) => a.tradeValue > 0).reduce((s, a) => s + a.tradeValue, 0)
  const turnoverPct = (roundMoney(bought) / totalValue) * 100

  let triggered = false
  let trigger: RebalanceTrigger = 'none'
  let reason: string

  switch (options.mode) {
    case 'band': {
      const band = options.bandPp ?? 5
      triggered = worstDrift > band
      trigger = triggered ? 'band' : 'none'
      const low = ((worst?.targetWeight ?? 0) * 100 - band).toFixed(0)
      const high = ((worst?.targetWeight ?? 0) * 100 + band).toFixed(0)
      reason = triggered
        ? `${worst.symbol} is at ${(worst.currentWeight * 100).toFixed(1)}%, outside its ${low}%-${high}% band.`
        : `Every holding is still inside its ±${band} point band; nothing needs to move.`
      break
    }
    case 'calendar':
      // The caller decides whether the date has come round; if it is asking for
      // a plan at all, the schedule has fired.
      triggered = true
      trigger = 'calendar'
      reason = 'A scheduled rebalance is due. These trades restore the target weights.'
      break
    case 'always':
      triggered = true
      trigger = 'deviation'
      reason = 'Rebalancing to the target weights as requested.'
      break
    case 'deviation':
    default: {
      const threshold = options.thresholdPp ?? 5
      triggered = worstDrift > threshold
      trigger = triggered ? 'deviation' : 'none'
      reason = triggered
        ? `${worst.symbol} has drifted ${worst.deviationPp > 0 ? '+' : ''}${worst.deviationPp.toFixed(1)} points from its ${(worst.targetWeight * 100).toFixed(0)}% target.`
        : `The largest drift is ${worstDrift.toFixed(1)} points, inside the ${threshold} point threshold.`
    }
  }

  return { actions, totalValue, triggered, trigger, turnoverPct, reason }
}

const FREQUENCY_DAYS: Record<CalendarFrequency, number> = {
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
}

/**
 * Whether a calendar schedule has come round.
 *
 * No previous rebalance means the first one is due. An unparseable date means
 * not due — firing on every request because a stored value is malformed would
 * be worse than waiting for someone to notice.
 */
export function isCalendarDue(
  lastRebalance: string | null | undefined,
  frequency: CalendarFrequency,
  asOf: Date = new Date(),
): boolean {
  if (!lastRebalance) return true
  const last = Date.parse(lastRebalance)
  if (!Number.isFinite(last)) return false
  const elapsedDays = (asOf.getTime() - last) / 86_400_000
  return elapsedDays >= FREQUENCY_DAYS[frequency]
}

export type RiskShare = { symbol: string; weight: number; percentOfRisk: number }

export type RiskDrift = {
  triggered: boolean
  offenders: Array<{ symbol: string; weightPct: number; percentOfRisk: number; gapPp: number }>
  reason: string
}

/**
 * The case no weight-based rule catches: the money is where it should be, but
 * the risk is not.
 *
 * A holding sitting exactly on its 30% target can be carrying 62% of the book's
 * volatility after a jump in its own volatility or in how it correlates with
 * everything else. Rebalancing on weight alone would report nothing to do.
 */
export function detectRiskDrift(
  shares: RiskShare[],
  options: { thresholdPp?: number } = {},
): RiskDrift {
  const threshold = options.thresholdPp ?? 20
  const offenders = shares
    .map((s) => ({
      symbol: s.symbol,
      weightPct: s.weight * 100,
      percentOfRisk: s.percentOfRisk,
      gapPp: s.percentOfRisk - s.weight * 100,
    }))
    .filter((s) => s.gapPp > threshold)
    .sort((a, b) => b.gapPp - a.gapPp)

  if (offenders.length === 0) {
    return {
      triggered: false,
      offenders: [],
      reason: 'Each holding is carrying about as much risk as its size suggests.',
    }
  }

  const worst = offenders[0]
  return {
    triggered: true,
    offenders,
    reason:
      `${worst.symbol} is ${worst.weightPct.toFixed(0)}% of the money but ${worst.percentOfRisk.toFixed(0)}% of the risk. ` +
      'Its weight is on target — what moved is its volatility or how it moves with the rest of the book.',
  }
}
