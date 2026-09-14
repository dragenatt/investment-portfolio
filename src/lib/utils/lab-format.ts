// Presentation helpers for the Financial Laboratory page — pure, no I/O.
//
// The lab engine returns numbers tagged with a unit. Every slider label, axis
// tick, tooltip and highlight on the page goes through formatByUnit, so a
// percentage cannot read "12.345" in one place and "12.3%" in another.

import { formatoMoneda } from './money'
import type { Unit } from '@/lib/services/lab'

const EMPTY = '—'

/** Trim trailing zeros from a fixed-point rendering: 1.50 -> 1.5, 10.00 -> 10. */
function compact(value: number, maxDecimals: number): string {
  return String(Number(value.toFixed(maxDecimals)))
}

export function formatByUnit(value: number, unit: Unit, decimals?: number): string {
  // The last line of defence for the roadmap's rule: nothing non-finite is
  // ever shown, whatever reaches this function.
  if (!Number.isFinite(value)) return EMPTY

  switch (unit) {
    case 'percent':
      return `${value.toFixed(decimals ?? 1)}%`
    case 'money':
      return formatoMoneda(value)
    case 'years': {
      const text = compact(value, decimals ?? 2)
      return `${text} ${Math.abs(value) === 1 ? 'año' : 'años'}`
    }
    case 'pp':
      // A percentage-point figure is always a difference, so it always carries
      // its sign.
      return `${value >= 0 ? '+' : ''}${value.toFixed(decimals ?? 1)} pp`
    case 'number':
    default:
      return compact(value, decimals ?? 2)
  }
}

/**
 * The query string that runs one experiment.
 *
 * Keys are sorted so it doubles as a stable cache key: the same inputs set in a
 * different order must not fetch twice. Non-finite values are left out, which
 * makes the engine fall back to that parameter's default instead of receiving
 * the string "NaN".
 */
export function labQueryString(experiment: string, params: Record<string, number>): string {
  const search = new URLSearchParams({ experiment })
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    if (Number.isFinite(value)) search.set(key, String(value))
  }
  return search.toString()
}
