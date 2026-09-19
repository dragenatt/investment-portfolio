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
import {
  addQuantity,
  subtractQuantity,
  multiplyQuantity,
  isDustRemainder,
} from '@/lib/utils/quantity'
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
  currentPrice: number | null,
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
        quantity = addQuantity(quantity, qty)
        feeCents += toCents(fees)
        // A purchase is money leaving the investor's pocket.
        cashFlows.push({ date, amount: -roundMoney(qty * price + fees) })
        break
      }

      case 'sell': {
        if (quantity <= 0) {
          warnings.push(
            `La venta del ${date} no tiene una compra registrada antes, así que no hay costo contra el cual medir la ganancia. Se registra como ingreso completo.`,
          )
        }

        const sellable = Math.min(qty, Math.max(0, quantity))
        if (sellable < qty) {
          warnings.push(
            `La venta del ${date} es por ${qty} unidades, pero solo había ${quantity}. El excedente se ignora en lugar de crear una posición corta que el resto de la app no puede representar.`,
          )
        }

        // The cost released is the share of the remaining basis being sold.
        const costPerShareCents = quantity > 0 ? costCents / quantity : 0
        const remaining = Math.max(0, subtractQuantity(quantity, sellable))
        // Same rule as recalculatePosition: a remainder worth under half a cent
        // at this sale's price closes the position. Its (sub-cent) cost is
        // released with this sale, so the basis leaves nothing behind.
        const closesAsDust = isDustRemainder(remaining, price)
        const releasedCents = closesAsDust ? costCents : Math.round(costPerShareCents * sellable)
        const proceedsCentsThisSale = toCents(sellable * price - fees)
        const pnlCents = proceedsCentsThisSale - releasedCents

        costCents = Math.max(0, costCents - releasedCents)
        quantity = closesAsDust ? 0 : remaining
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
        if (ratio > 0) quantity = multiplyQuantity(quantity, ratio)
        else warnings.push(`El split del ${date} tiene una proporción de ${ratio}, que no se puede usar.`)
        break
      }
    }
  }

  // No quote: the shares are valued at what they cost, so unrealised P&L reads
  // zero and says why. Passing 0 instead — as the route did — valued them at
  // nothing and reported the whole cost basis as an unrealised loss.
  if (currentPrice === null && quantity > 0) {
    warnings.push('Sin cotización actual: las unidades restantes se valúan a su costo, así que la ganancia no realizada se muestra en cero.')
  }
  const price = currentPrice === null ? (quantity > 0 ? fromCents(costCents) / quantity : 0) : finite(currentPrice)
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

// ─── Every position of a book (4.6) ─────────────────────────────────────────

export type BookPosition = { id: string; symbol: string; currency: string | null }

export type PositionHistory = TradeHistory & {
  symbol: string
  /** The currency the position's cost is recorded in; every figure is in it. */
  currency: string
  price_currency: string | null
  /** False when there was no quote and the units are valued at cost. */
  priced: boolean
  /** True when the quote's currency or today's rate was unknown and it was used unconverted. */
  unconverted: boolean
}

export type HistoryTotals = {
  currency: string
  realizedPnl: number
  unrealizedPnl: number
  totalFees: number
  dividendsReceived: number
  marketValue: number
  costBasis: number
}

/**
 * Replay every position of a book and total the results per cost currency.
 *
 * Each quote is converted into the currency the position's COST is recorded
 * in before it meets that cost: most positions in production record a peso
 * cost for a dollar-quoted symbol, and subtracting one from the other as the
 * same unit put unrealised P&L off by the exchange rate. Totals stay per
 * currency, because a sum of pesos and dollars is a number in no currency.
 *
 * `quoteToCost(symbol, costCurrency)` answers the multiplier and whether it is
 * a real conversion; the caller builds it from fx.ts and today's rates.
 */
export function summariseBookHistory(
  positions: BookPosition[],
  transactionsByPosition: Map<string, RawTransaction[]>,
  quotes: Record<string, number>,
  quoteCurrency: Record<string, string>,
  quoteToCost: (symbol: string, costCurrency: string) => { factor: number; converted: boolean },
  options: { asOf?: Date } = {},
): { positions: PositionHistory[]; totals: HistoryTotals[] } {
  const results: PositionHistory[] = []
  for (const position of positions) {
    const currency = String(position.currency ?? 'USD').toUpperCase()
    const quote = quotes[position.symbol]
    const conversion = quote === undefined ? null : quoteToCost(position.symbol, currency)
    const price = quote === undefined ? null : quote * conversion!.factor
    const history = deriveTradeHistory(transactionsByPosition.get(position.id) ?? [], price, options)
    if (!history) continue
    results.push({
      symbol: position.symbol,
      currency,
      price_currency: quoteCurrency[position.symbol] ?? null,
      priced: quote !== undefined,
      unconverted: conversion !== null && !conversion.converted,
      ...history,
    })
  }

  const totals = new Map<string, HistoryTotals>()
  for (const r of results) {
    const t = totals.get(r.currency) ?? {
      currency: r.currency, realizedPnl: 0, unrealizedPnl: 0, totalFees: 0, dividendsReceived: 0, marketValue: 0, costBasis: 0,
    }
    totals.set(r.currency, {
      currency: r.currency,
      realizedPnl: addMoney(t.realizedPnl, r.realizedPnl),
      unrealizedPnl: addMoney(t.unrealizedPnl, r.unrealizedPnl),
      totalFees: addMoney(t.totalFees, r.totalFees),
      dividendsReceived: addMoney(t.dividendsReceived, r.dividendsReceived),
      marketValue: addMoney(t.marketValue, r.marketValue),
      costBasis: addMoney(t.costBasis, r.costBasis),
    })
  }
  return { positions: results, totals: [...totals.values()] }
}
