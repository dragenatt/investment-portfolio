// Investment costs — pure functions, no I/O.
//
// Every return in this app is gross. Commissions, spreads, custody fees and tax
// all reduce it, and over a long horizon they reduce it by far more than their
// annual size suggests: one percentage point a year, compounded over twenty
// years, is roughly a fifth of the final balance.
//
// The rule that governs this module: NEVER INVENT A COST. Making up a plausible
// commission would produce a net return that looks authoritative and is fiction.
// The default model is therefore all zeros, and it says so — a reader looking at
// gross returns should be told they are gross, not handed a fabricated net.

import { roundMoney } from '@/lib/utils/money'

export type CostModel = {
  /** Broker commission per trade, as a percentage of traded value. */
  commissionPct: number
  /** Minimum commission per trade, in the account currency. */
  commissionMin?: number
  /** Half the bid-ask spread paid on entry and exit, as a percentage. */
  spreadPct: number
  /** Annual custody or management fee, as a percentage of assets. */
  custodyAnnualPct: number
  /** Tax on realised gains, as a percentage of the gain. */
  capitalGainsTaxPct: number
  /** Where these figures came from. Required, so an unsourced model is obvious. */
  source: string
}

/**
 * The model used when the operator has configured nothing.
 *
 * All zeros on purpose. A default that guessed at "typical" costs would make
 * every net return in the app a fabrication dressed as a measurement.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  commissionPct: 0,
  commissionMin: 0,
  spreadPct: 0,
  custodyAnnualPct: 0,
  capitalGainsTaxPct: 0,
  source: 'No cost model configured — every return shown is gross.',
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v))
}

/**
 * Cost of one trade of `value`.
 *
 * The sign is ignored: selling costs the same as buying, and a caller passing a
 * negative trade value from a rebalance plan should not silently get a negative
 * cost back.
 */
export function tradeCost(value: number, model: CostModel): number {
  const traded = Math.abs(value)
  if (!finite(traded) || traded === 0) return 0

  const commission = Math.max((traded * model.commissionPct) / 100, model.commissionMin ?? 0)
  const spread = (traded * model.spreadPct) / 100
  return roundMoney(commission + spread)
}

export type CostAdjustedReturn = {
  grossReturnPct: number
  netReturnPct: number
  totalDragPct: number
  breakdown: { tradingPct: number; custodyPct: number; taxPct: number }
}

/**
 * Take a gross annual return down to net.
 *
 * `roundTripsPerYear` is how many complete buy-and-sell cycles the strategy runs
 * in a year — the parameter that makes an active strategy expensive and a
 * buy-and-hold one nearly free.
 *
 * Tax applies only to a gain. A losing year is not taxed, and modelling it as if
 * it were would understate a bad year on top of it already being bad.
 */
export function applyCostsToReturn(
  grossReturnPct: number,
  roundTripsPerYear: number,
  model: CostModel,
): CostAdjustedReturn | null {
  if (!finite(grossReturnPct, roundTripsPerYear)) return null

  // Each round trip pays the commission and the spread twice: once in, once out.
  const perRoundTripPct = 2 * (model.commissionPct + model.spreadPct)
  const tradingPct = Math.max(0, roundTripsPerYear) * perRoundTripPct
  const custodyPct = model.custodyAnnualPct

  const afterFees = grossReturnPct - tradingPct - custodyPct
  const taxPct = afterFees > 0 ? (afterFees * model.capitalGainsTaxPct) / 100 : 0

  const netReturnPct = afterFees - taxPct

  return {
    grossReturnPct,
    netReturnPct,
    totalDragPct: grossReturnPct - netReturnPct,
    breakdown: { tradingPct, custodyPct, taxPct },
  }
}

export type DragOverTime = {
  grossValue: number
  netValue: number
  /** What the cost gap took away over the whole horizon, in money. */
  costOfCosts: number
  explanation: string
}

/**
 * What a cost gap costs once it compounds.
 *
 * This is the number worth showing. One point a year sounds negligible and is
 * not: the fee is charged on a balance that would otherwise have kept growing,
 * so the loss compounds alongside the return.
 */
export function annualDrag(
  capital: number,
  grossReturnPct: number,
  netReturnPct: number,
  years: number,
): DragOverTime | null {
  if (!finite(capital, grossReturnPct, netReturnPct, years)) return null
  if (years < 0) return null

  const grossValue = roundMoney(capital * Math.pow(1 + grossReturnPct / 100, years))
  const netValue = roundMoney(capital * Math.pow(1 + netReturnPct / 100, years))
  const costOfCosts = roundMoney(grossValue - netValue)

  const gap = grossReturnPct - netReturnPct
  const sharePct = grossValue > 0 ? (costOfCosts / grossValue) * 100 : 0

  return {
    grossValue,
    netValue,
    costOfCosts,
    explanation:
      'Una diferencia de ' +
      gap.toFixed(2) +
      ' puntos anuales parece pequena, pero durante ' +
      years +
      ' anios se lleva ' +
      costOfCosts.toFixed(0) +
      ', el ' +
      sharePct.toFixed(1) +
      '% de lo que habrias acumulado sin costos. La comision se cobra sobre un saldo que habria ' +
      'seguido creciendo, asi que la perdida se capitaliza igual que el rendimiento.',
  }
}

export type RebalanceCostEstimate = {
  turnover: number
  total: number
  pctOfPortfolio: number | null
}

/**
 * Cost of executing a set of rebalance trades.
 *
 * Turnover is half the sum of the absolute trades, because every peso sold is a
 * peso bought — counting both sides would double the real movement.
 */
export function rebalanceCost(
  tradeValues: number[],
  model: CostModel,
  portfolioValue?: number,
): RebalanceCostEstimate {
  const usable = tradeValues.filter((v) => Number.isFinite(v))
  const turnover = roundMoney(usable.reduce((sum, v) => sum + Math.abs(v), 0) / 2)

  const total = roundMoney(usable.reduce((sum, v) => sum + tradeCost(v, model), 0))

  return {
    turnover,
    total,
    pctOfPortfolio:
      portfolioValue && portfolioValue > 0 ? (total / portfolioValue) * 100 : null,
  }
}

/** One sentence describing what costs are being modelled, and on whose authority. */
export function describeCostModel(model: CostModel): string {
  const configured =
    model.commissionPct > 0 ||
    model.spreadPct > 0 ||
    model.custodyAnnualPct > 0 ||
    model.capitalGainsTaxPct > 0

  if (!configured) {
    return (
      'No hay un modelo de costos configurado, asi que todos los rendimientos que ves son ' +
      'brutos: no descuentan comisiones, spread, custodia ni impuestos. Inventar cifras ' +
      'plausibles daria un rendimiento neto que parece autoritativo y seria ficcion.'
    )
  }

  return (
    'Costos aplicados: ' +
    model.commissionPct.toFixed(2) +
    '% de comision por operacion' +
    (model.commissionMin ? ' (minimo ' + model.commissionMin.toFixed(2) + ')' : '') +
    ', ' +
    model.spreadPct.toFixed(2) +
    '% de spread, ' +
    model.custodyAnnualPct.toFixed(2) +
    '% anual de custodia y ' +
    model.capitalGainsTaxPct.toFixed(2) +
    '% de impuesto sobre ganancias. Fuente: ' +
    model.source +
    '.'
  )
}
