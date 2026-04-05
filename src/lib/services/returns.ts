/**
 * Return Calculations Service
 *
 * Implements three return methodologies:
 * - Simple Return: (value - cost) / cost
 * - TWR (Time-Weighted): Strategy performance, independent of cash flows
 * - MWR (Money-Weighted / IRR): Personal return accounting for timing
 */

type Snapshot = { date: string; value: number }
type CashFlow = { date: string; amount: number }

/**
 * Simple return as percentage.
 */
export function calculateSimpleReturn(currentValue: number, totalCost: number): number {
  if (totalCost === 0) return 0
  return ((currentValue - totalCost) / totalCost) * 100
}

/**
 * Time-Weighted Return (TWR).
 *
 * Splits timeline into sub-periods at each cash flow event.
 * Each sub-period: Ri = (V_end / V_start) - 1
 * TWR = Π(1 + Ri) - 1
 *
 * Returns percentage (e.g., 10.5 for 10.5%).
 */
export function calculateTWR(snapshots: Snapshot[], cashFlows: CashFlow[]): number {
  if (snapshots.length < 2) return 0

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  if (cashFlows.length === 0) {
    // No cash flows — simple start-to-end return
    const startVal = sorted[0].value
    const endVal = sorted[sorted.length - 1].value
    if (startVal === 0) return 0
    return ((endVal / startVal) - 1) * 100
  }

  // Sort cash flows by date
  const sortedCF = [...cashFlows].sort((a, b) => a.date.localeCompare(b.date))

  // Build sub-periods between cash flow events
  let chainedReturn = 1
  let subPeriodStart = sorted[0].value

  for (const cf of sortedCF) {
    // Find snapshot value just before this cash flow
    const beforeCF = sorted
      .filter((s) => s.date <= cf.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0]

    if (!beforeCF || subPeriodStart === 0) continue

    const subReturn = beforeCF.value / subPeriodStart
    chainedReturn *= subReturn

    // New sub-period starts at value + cash flow
    subPeriodStart = beforeCF.value + cf.amount
  }

  // Final sub-period: last cash flow to end
  const endVal = sorted[sorted.length - 1].value
  if (subPeriodStart > 0) {
    chainedReturn *= endVal / subPeriodStart
  }

  return (chainedReturn - 1) * 100
}

/**
 * Money-Weighted Return (MWR / IRR).
 *
 * Uses Newton-Raphson to solve for the rate where NPV of cash flows = 0.
 * Cash flows: investments are negative, withdrawals/current value are positive.
 *
 * Returns annualized percentage.
 */
export function calculateMWR(
  cashFlows: CashFlow[],
  currentValue: number,
  endDate: Date
): number {
  if (cashFlows.length === 0 || currentValue === 0) return 0

  // Build all flows with day offsets
  const allFlows = cashFlows.map((cf) => ({
    amount: cf.amount,
    days: (new Date(cf.date).getTime() - new Date(cashFlows[0].date).getTime()) / (1000 * 60 * 60 * 24),
  }))

  // Add current value as final positive flow
  const totalDays = (endDate.getTime() - new Date(cashFlows[0].date).getTime()) / (1000 * 60 * 60 * 24)
  if (totalDays <= 0) return 0

  allFlows.push({ amount: currentValue, days: totalDays })

  // Newton-Raphson to find daily rate
  let rate = 0.0001 // initial guess (daily)
  const maxIterations = 100
  const tolerance = 1e-8

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0
    let derivative = 0

    for (const flow of allFlows) {
      const discountFactor = Math.pow(1 + rate, flow.days)
      if (!isFinite(discountFactor) || discountFactor === 0) break
      npv += flow.amount / discountFactor
      derivative -= (flow.days * flow.amount) / (discountFactor * (1 + rate))
    }

    if (Math.abs(derivative) < 1e-12) break
    const newRate = rate - npv / derivative

    if (Math.abs(newRate - rate) < tolerance) {
      rate = newRate
      break
    }
    rate = newRate
  }

  // Annualize: (1 + daily_rate)^365 - 1
  const annualReturn = (Math.pow(1 + rate, 365) - 1) * 100
  return isFinite(annualReturn) ? Math.round(annualReturn * 100) / 100 : 0
}
