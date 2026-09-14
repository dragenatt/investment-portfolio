import { formatSignedPercent } from './change-tone'

export function formatPercent(value: number | null | undefined): string {
  // Zero, and anything that rounds to it, carries no sign (C9): "+0.00%" read as
  // a gain and "-0.00%" as a loss.
  return formatSignedPercent(value, 2)
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '--'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}
