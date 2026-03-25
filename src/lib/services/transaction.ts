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
  let totalCost = 0

  for (const txn of transactions) {
    switch (txn.type) {
      case 'buy':
        totalCost = (quantity * (quantity > 0 ? totalCost / quantity : 0)) + (txn.quantity * txn.price) + txn.fees
        quantity += txn.quantity
        break
      case 'sell': {
        // avg_cost stays the same — reduce totalCost proportionally
        const avgCost = quantity > 0 ? totalCost / quantity : 0
        quantity -= txn.quantity
        totalCost = quantity > 0 ? avgCost * quantity : 0
        break
      }
      case 'split':
        // quantity field = split ratio (e.g., 2 for 2:1 split)
        quantity *= txn.quantity
        // totalCost stays the same (same total investment, more shares)
        break
      case 'dividend':
        // Record-keeping only — no effect on position
        break
    }
  }

  const avg_cost = quantity > 0 ? totalCost / quantity : 0
  return { quantity: Math.max(0, quantity), avg_cost }
}
