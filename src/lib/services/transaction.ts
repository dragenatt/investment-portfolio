import { fromCents, toCents } from '@/lib/utils/money'

type TransactionInput = {
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
}

export function recalculatePosition(transactions: TransactionInput[]): {
  quantity: number
  avg_cost: number
} {
  let quantity = 0
  // The running cost basis is held in integer cents: a book of hundreds of trades
  // accumulates visible drift otherwise (ten $0.10 buys land on $0.9999999999999999).
  let costCents = 0

  for (const txn of transactions) {
    switch (txn.type) {
      case 'buy':
        costCents += toCents(txn.quantity * txn.price + txn.fees)
        quantity += txn.quantity
        break
      case 'sell': {
        // avg_cost stays the same — reduce the cost basis proportionally
        const centsPerShare = quantity > 0 ? costCents / quantity : 0
        quantity -= txn.quantity
        costCents = quantity > 0 ? Math.round(centsPerShare * quantity) : 0
        break
      }
      case 'split':
        // quantity field = split ratio (e.g., 2 for 2:1 split)
        quantity *= txn.quantity
        // the cost basis stays the same (same total investment, more shares)
        break
      case 'dividend':
        // Record-keeping only — no effect on position
        break
    }
  }

  const avg_cost = quantity > 0 ? fromCents(costCents) / quantity : 0
  return { quantity: Math.max(0, quantity), avg_cost }
}
