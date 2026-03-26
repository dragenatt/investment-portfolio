'use client'

import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils'

type Props = {
  value: number | null | undefined
  from?: string        // source currency (e.g., 'USD'). If omitted, assumes user's base currency
  colorize?: boolean   // green for positive, red for negative
  showSign?: boolean   // show +/- prefix
  compact?: boolean    // use compact notation for large numbers (1.2M)
  className?: string
}

export function FormattedAmount({ value, from, colorize, showSign, compact, className }: Props) {
  const { format, convert, currency } = useCurrency()

  if (value == null) {
    return <span className={cn('font-mono', className)}>--</span>
  }

  const converted = from ? convert(value, from) : value

  let display: string
  if (compact) {
    const symbols: Record<string, string> = { MXN: '$', USD: '$', EUR: '\u20AC' }
    const symbol = symbols[currency] || '$'
    const compactStr = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Math.abs(converted))
    display = `${symbol}${compactStr} ${currency}`
  } else {
    // format() with no `from` just formats in the display currency (no conversion)
    display = format(Math.abs(converted))
  }

  // Prefix: showSign adds +/- for all values; otherwise only '-' for negatives
  const prefix = converted < 0 ? '-' : showSign && converted > 0 ? '+' : ''
  display = `${prefix}${display}`

  const colorClass = colorize
    ? converted >= 0 ? 'text-emerald-500' : 'text-red-500'
    : undefined

  return <span className={cn('font-mono', colorClass, className)}>{display}</span>
}
