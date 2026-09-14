import { fromCents, toCents } from '@/lib/utils/money'
import {
  addQuantity,
  subtractQuantity,
  multiplyQuantity,
  isDustRemainder,
} from '@/lib/utils/quantity'

type TransactionInput = {
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
}

/**
 * Replay a position's transactions into its current quantity and average cost.
 *
 * Callers must pass the transactions in the order they happened. Several can
 * share an `executed_at` (the trade modal records a date, not a time), so the
 * routes order by `created_at` as well — a sale replayed before the purchase it
 * sold would be clamped at zero below and the purchase would then look unsold.
 */
export function recalculatePosition(transactions: TransactionInput[]): {
  quantity: number
  avg_cost: number
} {
  // Quantities in fixed 8-decimal precision (utils/quantity), for the same
  // reason the cost basis is held in integer cents: ten $0.10 buys land on
  // $0.9999999999999999, and 0.1 + 0.2 shares are not 0.3 shares.
  let quantity = 0
  let costCents = 0

  for (const txn of transactions) {
    switch (txn.type) {
      case 'buy':
        costCents += toCents(txn.quantity * txn.price + txn.fees)
        quantity = addQuantity(quantity, txn.quantity)
        break
      case 'sell': {
        // avg_cost stays the same — reduce the cost basis proportionally
        const centsPerShare = quantity > 0 ? costCents / quantity : 0
        // Never below zero mid-replay. Overselling is rejected on insert, but an
        // edit to an earlier buy can produce it, and a negative running quantity
        // used to swallow the next purchase: buy 5, sell 10, buy 10 came to 5.
        quantity = Math.max(0, subtractQuantity(quantity, txn.quantity))
        // A remainder worth less than half a cent at this sale's price is what
        // selling "all" of a quantity displayed to fewer decimals than it was
        // stored at leaves behind. It is closed rather than kept as a holding.
        if (isDustRemainder(quantity, txn.price)) quantity = 0
        costCents = quantity > 0 ? Math.round(centsPerShare * quantity) : 0
        break
      }
      case 'split':
        // quantity field = split ratio (e.g., 2 for 2:1 split)
        quantity = multiplyQuantity(quantity, txn.quantity)
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
