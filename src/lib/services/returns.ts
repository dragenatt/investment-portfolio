/**
 * Return calculations — pure functions, no I/O.
 *
 * Three methodologies, which answer three different questions:
 *
 * - Simple return: what is the book worth against what went in.
 * - TWR (time-weighted): how did the STRATEGY do, with the timing and size of
 *   contributions stripped out. This is what you compare against an index.
 * - MWR / XIRR (money-weighted): how did THE INVESTOR do, counting when each
 *   peso arrived. This is what actually happened to their wealth.
 *
 * They diverge whenever money arrives at uneven moments, and the gap is
 * informative rather than an error — see describeReturnDifference.
 *
 * Every function here returns null rather than 0 when it cannot answer. A zero
 * return and an unknown return look identical on a dashboard and mean opposite
 * things.
 */

export type Snapshot = { date: string; value: number }
export type CashFlow = { date: string; amount: number }

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

/** Simple return as a percentage. */
export function calculateSimpleReturn(currentValue: number, totalCost: number): number {
  if (totalCost === 0) return 0
  return ((currentValue - totalCost) / totalCost) * 100
}

// ─── Time-weighted return ───────────────────────────────────────────────────

/**
 * Time-Weighted Return: the product of each sub-period's growth, so a
 * contribution changes the capital base without registering as performance.
 *
 * A flow dated D is treated as landing immediately after the snapshot dated D,
 * which is the convention the snapshots themselves follow — a snapshot records
 * the book before that day's activity.
 *
 * Returns a percentage, or null when the series cannot support the calculation.
 */
export function calculateTWR(snapshots: Snapshot[], cashFlows: CashFlow[]): number | null {
  if (snapshots.length < 2) return null

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  let chained = 1
  for (let i = 1; i < sorted.length; i++) {
    const periodStart = sorted[i - 1].date
    const periodEnd = sorted[i].date

    // Flows from this period's opening snapshot up to (not including) the next
    // one adjust the capital the period starts with.
    let injected = 0
    for (const flow of cashFlows) {
      if (flow.date >= periodStart && flow.date < periodEnd) injected += flow.amount
    }

    const openingCapital = sorted[i - 1].value + injected
    // A period that starts from nothing has no return to measure, and dividing
    // by it would hand the interface an Infinity.
    if (openingCapital <= 0) return null

    chained *= sorted[i].value / openingCapital
  }

  if (!Number.isFinite(chained)) return null
  return (chained - 1) * 100
}

// ─── Money-weighted return (XIRR) ───────────────────────────────────────────

/** Net present value of dated flows at an annual rate. */
function netPresentValue(flows: CashFlow[], startMs: number, rate: number): number {
  let sum = 0
  for (const flow of flows) {
    const years = (Date.parse(flow.date) - startMs) / MS_PER_YEAR
    const factor = Math.pow(1 + rate, years)
    if (!Number.isFinite(factor) || factor === 0) return Number.NaN
    sum += flow.amount / factor
  }
  return sum
}

/**
 * XIRR: the annual rate at which the dated flows discount to zero.
 *
 * Solved by bracketing and bisection rather than Newton-Raphson alone. Newton
 * is faster but overshoots badly on short holding periods — a 9x gain in a
 * month implies an annual rate in the hundreds of billions of percent, and the
 * tangent step walks straight past it into a non-finite discount factor. The
 * previous implementation returned 0 when that happened, which reads on a
 * dashboard as "you made nothing" rather than "this did not converge".
 *
 * Returns a percentage, or null when no rate exists: fewer than two flows, no
 * sign change (money only ever went one way), or no elapsed time.
 */
export function calculateXIRR(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null

  const dated = flows
    .filter((f) => Number.isFinite(Date.parse(f.date)) && Number.isFinite(f.amount))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (dated.length < 2) return null

  const startMs = Date.parse(dated[0].date)
  const endMs = Date.parse(dated[dated.length - 1].date)
  if (endMs <= startMs) return null

  const hasInflow = dated.some((f) => f.amount > 0)
  const hasOutflow = dated.some((f) => f.amount < 0)
  if (!hasInflow || !hasOutflow) return null

  // Bracket the root. NPV falls as the rate rises for a conventional flow, so
  // expanding the upper bound eventually crosses zero; the lower bound sits
  // just above -100%, where the discount factor blows up.
  let low = -0.9999
  let high = 1
  let fLow = netPresentValue(dated, startMs, low)
  let fHigh = netPresentValue(dated, startMs, high)
  if (!Number.isFinite(fLow)) return null

  // A very short holding period produces an enormous annualised rate, so the
  // ceiling has to be generous. Such a number is mathematically correct but not
  // meaningful; deciding how to present it belongs to the caller.
  const MAX_RATE = 1e15
  while (Number.isFinite(fHigh) && fLow * fHigh > 0 && high < MAX_RATE) {
    high *= 4
    fHigh = netPresentValue(dated, startMs, high)
  }
  if (!Number.isFinite(fHigh) || fLow * fHigh > 0) return null

  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2
    const fMid = netPresentValue(dated, startMs, mid)
    if (!Number.isFinite(fMid)) return null
    if (Math.abs(fMid) < 1e-9 || high - low < 1e-12) {
      return Number.isFinite(mid) ? mid * 100 : null
    }
    if (fLow * fMid < 0) {
      high = mid
      fHigh = fMid
    } else {
      low = mid
      fLow = fMid
    }
  }

  const rate = (low + high) / 2
  return Number.isFinite(rate) ? rate * 100 : null
}

/**
 * Money-Weighted Return: XIRR over the contributions plus the book's current
 * value as a closing inflow.
 *
 * Contributions must be negative and withdrawals positive, the usual cash-flow
 * sign convention.
 */
export function calculateMWR(
  cashFlows: CashFlow[],
  currentValue: number,
  endDate: Date,
): number | null {
  if (cashFlows.length === 0) return null
  if (!Number.isFinite(currentValue)) return null

  return calculateXIRR([
    ...cashFlows,
    { date: endDate.toISOString().slice(0, 10), amount: currentValue },
  ])
}

// ─── Explaining the gap ─────────────────────────────────────────────────────

/** Below this the two returns are the same answer to two questions. */
const AGREEMENT_THRESHOLD_PCT = 0.5

/**
 * Why the two returns differ, in the terms that actually caused it.
 *
 * The gap is not an error and neither number is more correct: TWR judges the
 * strategy, MWR judges the investor's timing on top of it. Returns null when
 * one side could not be computed, because there is nothing to compare.
 */
export function describeReturnDifference(
  twr: number | null,
  mwr: number | null,
): string | null {
  if (twr === null || mwr === null) return null
  if (!Number.isFinite(twr) || !Number.isFinite(mwr)) return null

  const gap = mwr - twr

  if (Math.abs(gap) < AGREEMENT_THRESHOLD_PCT) {
    return (
      'Both measures agree, which means the timing of your contributions neither ' +
      'helped nor hurt: your money was exposed to the same performance the strategy ' +
      'produced.'
    )
  }

  if (gap > 0) {
    return (
      `Your money-weighted return is ${gap.toFixed(2)} points above the time-weighted one. ` +
      'The strategy returned less than you did — the difference is timing. More of your ' +
      'capital happened to be invested during the stronger stretches, so the same strategy ' +
      'produced a better outcome for you than for someone invested evenly throughout.'
    )
  }

  return (
    `Your money-weighted return is ${Math.abs(gap).toFixed(2)} points below the time-weighted one. ` +
    'The strategy did better than your account did — the difference is timing. More of your ' +
    'capital arrived before the weaker stretches, so it was the larger balance that lived ' +
    'through them. This is common and is not evidence the strategy is wrong.'
  )
}
