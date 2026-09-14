import { describe, it, expect } from 'vitest'
import { transactionCash } from '@/lib/utils/transaction-display'
import { deriveTradeHistory } from '@/lib/services/trade-history'

describe('transactionCash', () => {
  it('a buy costs the shares plus the fee', () => {
    expect(transactionCash({ type: 'buy', quantity: 10, price: 100, fees: 5 })).toEqual({ amount: 1005, direction: 'paid' })
  })

  it('a sale brings in the shares minus the fee — the table used to add it', () => {
    expect(transactionCash({ type: 'sell', quantity: 10, price: 100, fees: 5 })).toEqual({ amount: 995, direction: 'received' })
  })

  it('a dividend is quantity x price, as the position engine counts it', () => {
    expect(transactionCash({ type: 'dividend', quantity: 10, price: 0.5, fees: 0 })).toEqual({ amount: 5, direction: 'received' })
  })

  it('a split moves no money', () => {
    expect(transactionCash({ type: 'split', quantity: 2, price: 0, fees: 0 })).toBeNull()
  })

  it('never shows a negative amount or a negative fee', () => {
    expect(transactionCash({ type: 'sell', quantity: 1, price: 1, fees: 5 })!.amount).toBe(0)
    expect(transactionCash({ type: 'buy', quantity: 1, price: 10, fees: -3 })!.amount).toBe(10)
  })
})

describe('the ledger agrees with the position engine', () => {
  it('buy cost and sale proceeds match deriveTradeHistory', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 5, currency: 'USD', executed_at: '2026-01-02T15:00:00Z' },
      { type: 'sell' as const, quantity: 10, price: 120, fees: 5, currency: 'USD', executed_at: '2026-03-02T15:00:00Z' },
    ]
    const history = deriveTradeHistory(txns, 120)!
    const paid = transactionCash(txns[0])!.amount
    const received = transactionCash(txns[1])!.amount
    expect(history.cashFlows.slice(0, 2).map((f) => f.amount)).toEqual([-paid, received])
  })
})
