// What a transaction moved in cash, the way the ledger should show it (C9). No I/O.
//
// The transactions table showed quantity x price + fees for every row, in "$"
// whatever the currency. For a sale that overstated what came in by twice the
// fee, and it disagreed with the position engine (trade-history.ts), which
// counts sale proceeds as quantity x price - fees and a dividend as
// quantity x price. This follows the engine, so the ledger and the returns add
// up to the same numbers.

export type LedgerTransaction = {
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  fees: number
}

export type CashMovement = {
  /** Money paid out (buy) or received (sell, dividend). Always >= 0. */
  amount: number
  direction: 'paid' | 'received'
}

/** Null for a split: shares change, no money moves. */
export function transactionCash(t: LedgerTransaction): CashMovement | null {
  const gross = t.quantity * t.price
  const fees = Number.isFinite(t.fees) ? Math.max(0, t.fees) : 0
  switch (t.type) {
    case 'buy':
      return { amount: gross + fees, direction: 'paid' }
    case 'sell':
      return { amount: Math.max(0, gross - fees), direction: 'received' }
    case 'dividend':
      return { amount: gross, direction: 'received' }
    case 'split':
      return null
  }
}

export const DIRECTION_LABEL: Record<CashMovement['direction'], string> = {
  paid: 'pagado',
  received: 'recibido',
}
