// Trade history — pure functions, no I/O.
//
// The transactions table already records what happened. What it does not record
// is what any of it MEANT: how much of a gain has actually been banked, how much
// only exists on paper, what the position really cost after fees, and what
// return the investor earned given when each peso went in.
//
// The distinction that matters most here is realised versus unrealised. They are
// not two views of one number — a realised gain is money that exists and, in
// most jurisdictions, is taxable; an unrealised one is a price quote that can
// vanish before it is ever collected.
//
// Cost basis uses the weighted-average convention, matching recalculatePosition,
// and every monetary figure goes through money.ts so a hundred trades do not
// drift a cent away from what the user can add up by hand.

import {
  addMoney,
  fromCents,
  multiplyMoney,
  roundMoney,
  subtractMoney,
  toCents,
} from '@/lib/utils/money'
import { calculateXIRR, calculateSimpleReturn, type CashFlow } from './returns'

export type RawTransaction = {
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string
}

export type RealisedTrade = {
  date: string
  quantity: number
  price: number
  /** Weighted-average cost per share at the moment of the sale. */
  costPerShare: number
  proceeds: number
  fees: number
  pnl: number
}

export type TradeHistory = {
  quantity: number
  /** Weighted-average cost per share, fees included. */
  avgCost: number
  /** What the remaining shares cost in total. */
  costBasis: number
  marketValue: number
  /** Banked. Money that exists, and in most places is taxable. */
  realizedPnl: number
  /** On paper. A price quote, not a balance. */
  unrealizedPnl: number
  totalPnl: number
  totalFees: number
  dividendsReceived: number
  trades: RealisedTrade[]
  cashFlows: CashFlow[]
  /** Money-weighted (XIRR), annualised. Null when no rate exists. */
  mwrPct: number | null
  /** Against what was actually put in, not annualised. */
  simpleReturnPct: number
  warnings: string[]
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function dateOf(iso: string): string {
  return String(iso).slice(0, 10)
}

/**
 * Replay a position's transactions and report what they add up to.
 *
 * Cost basis is carried in integer cents throughout: a book of many trades
 * accumulates visible float drift otherwise, and a cost basis that disagrees
 * with the sum of the user's own receipts destroys trust in every number
 * derived from it.
 */
export function deriveTradeHistory(
  transactions: RawTransaction[],
  currentPrice: number,
  options: { asOf?: Date } = {},
): TradeHistory | null {
  if (transactions.length === 0) return null

  const sorted = [...transactions].sort((a, b) =>
    String(a.executed_at).localeCompare(String(b.executed_at)),
  )

  const warnings: string[] = []
  const trades: RealisedTrade[] = []
  const cashFlows: CashFlow[] = []

  let quantity = 0
  let costCents = 0
  let realizedCents = 0
  let feeCents = 0
  let dividendCents = 0
  // Money that has actually come back out, as opposed to the gain on it.
  let proceedsCents = 0
  let investedCents = 0

  for (const txn of sorted) {
    const date = dateOf(txn.executed_at)
    const qty = finite(txn.quantity)
    const price = finite(txn.price)
    const fees = Math.max(0, finite(txn.fees))

    switch (txn.type) {
      case 'buy': {
        const spent = toCents(qty * price + fees)
        costCents += spent
        investedCents += spent
        quantity += qty
        feeCents += toCents(fees)
        // A purchase is money leaving the investor's pocket.
        cashFlows.push({ date, amount: -roundMoney(qty * price + fees) })
        break
      }

      case 'sell': {
        if (quantity <= 0) {
          warnings.push(
            `A sale on ${date} has no purchase behind it, so there is no cost basis to measure the gain against. It is recorded as pure proceeds.`,
          )
        }

        const sellable = Math.min(qty, Math.max(0, quantity))
        if (sellable < qty) {
          warnings.push(
            `The sale on ${date} is for ${qty} units but only ${quantity} were held. The excess is ignored rather than creating a short position the rest of the app cannot represent.`,
          )
        }

        // The cost released is the share of the remaining basis being sold.
        const costPerShareCents = quantity > 0 ? costCents / quantity : 0
        const releasedCents = Math.round(costPerShareCents * sellable)
        const proceedsCentsThisSale = toCents(sellable * price - fees)
        const pnlCents = proceedsCentsThisSale - releasedCents

        costCents = Math.max(0, costCents - releasedCents)
        quantity = Math.max(0, quantity - sellable)
        realizedCents += pnlCents
        proceedsCents += proceedsCentsThisSale
        feeCents += toCents(fees)

        trades.push({
          date,
          quantity: sellable,
          price,
          costPerShare: fromCents(costPerShareCents),
          proceeds: fromCents(proceedsCentsThisSale),
          fees,
          pnl: fromCents(pnlCents),
        })

        cashFlows.push({ date, amount: roundMoney(sellable * price - fees) })
        break
      }

      case 'dividend': {
        // The quantity field carries the per-share amount's multiplier: the
        // payment is quantity x price, matching how the app records it.
        const received = toCents(qty * price)
        dividendCents += received
        cashFlows.push({ date, amount: fromCents(received) })
        break
      }

      case 'split': {
        // The ratio arrives in the quantity field: 2 means a 2:1 split. The
        // total invested does not change, only how many shares it is spread
        // across, so costCents is deliberately untouched.
        const ratio = qty
        if (ratio > 0) quantity *= ratio
        else warnings.push(`The split on ${date} has a ratio of ${ratio}, which is not usable.`)
        break
      }
    }
  }

  const price = finite(currentPrice)
  const marketValue = multiplyMoney(price, quantity)
  const marketValueCents = toCents(marketValue)
  const costBasis = fromCents(costCents)
  const realizedPnl = fromCents(realizedCents)
  const unrealizedPnl = quantity > 0 ? subtractMoney(marketValue, costBasis) : 0

  const asOf = options.asOf ?? new Date()
  // The position's remaining value is the closing inflow XIRR needs to solve.
  const flowsForReturn: CashFlow[] =
    quantity > 0 && marketValue > 0
      ? [...cashFlows, { date: asOf.toISOString().slice(0, 10), amount: marketValue }]
      : cashFlows

  // What the position is worth to the investor today: the shares still held,
  // plus every peso already taken out of it. Using realised P&L here instead of
  // proceeds would compare a GAIN against a COST and report a profitable,
  // part-sold position as a loss.
  const invested = fromCents(investedCents)
  const returnedToDate = fromCents(marketValueCents + proceedsCents + dividendCents)

  return {
    quantity,
    avgCost: quantity > 0 ? costBasis / quantity : 0,
    costBasis,
    marketValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl: addMoney(realizedPnl, unrealizedPnl),
    totalFees: fromCents(feeCents),
    dividendsReceived: fromCents(dividendCents),
    trades,
    cashFlows,
    mwrPct: calculateXIRR(flowsForReturn),
    simpleReturnPct: calculateSimpleReturn(returnedToDate, invested),
    warnings,
  }
}
