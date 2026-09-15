'use client'

import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils'
import { changeTone, toneTextClass } from '@/lib/utils/change-tone'

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
    return <span className={cn('font-financial', className)}>--</span>
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

  // The tone is decided at cent precision (C9): -0.001 used to print "-$0.00"
  // and zero was coloured as a gain. Zero is now unsigned and muted.
  const tone = changeTone(converted, 2)
  const prefix = tone === 'loss' ? '-' : showSign && tone === 'gain' ? '+' : ''
  display = `${prefix}${display}`

  const colorClass = colorize ? toneTextClass(tone) : undefined

  return <span className={cn('font-financial', colorClass, className)}>{display}</span>
}
