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

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  if (from === to) return amount
  const fromRate = rates[from]
  const toRate = rates[to]
  if (!fromRate || !toRate) return amount // unknown currency — return unchanged
  const inUsd = amount / fromRate
  return inUsd * toRate
}
