const symbols: Record<string, string> = { MXN: '$', USD: '$', EUR: '€' }

export function formatCurrency(amount: number, currency: string): string {
  const symbol = symbols[currency] || '$'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
  const sign = amount < 0 ? '-' : ''
  return `${sign}${symbol}${formatted} ${currency}`
}

/**
 * The result of a conversion, and whether one actually happened.
 *
 * `converted: false` means the amount came back in the currency it went in as,
 * because no rate joins the two. It is returned rather than thrown because a
 * screen with one unconvertible position should still show the rest — but the
 * caller has to decide what to do about it, which is why the flag is not
 * optional. Before this, the unconverted amount was returned as a bare number
 * and added to a total as if it were already in the right currency: a position
 * quoted in yen counted as pesos, and nothing on the screen said so.
 */
export type Conversion = { amount: number; converted: boolean }

/** Whether a rate exists to go from one currency to another. */
export function canConvert(from: string, to: string, rates: Record<string, number>): boolean {
  if (from === to) return true
  return Boolean(rates[from]) && Boolean(rates[to])
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): Conversion {
  if (from === to) return { amount, converted: true }
  const fromRate = rates[from]
  const toRate = rates[to]
  if (!fromRate || !toRate) return { amount, converted: false }
  const inUsd = amount / fromRate
  return { amount: inUsd * toRate, converted: true }
}
