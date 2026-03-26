'use client'

import { cn } from '@/lib/utils'

type Props = {
  value: number | null | undefined
  className?: string
}

export function PercentageChange({ value, className }: Props) {
  if (value == null) {
    return <span className={cn('font-mono', className)}>--</span>
  }

  const isPositive = value >= 0
  const sign = isPositive ? '+' : ''
  const arrow = isPositive ? '\u2191' : '\u2193'
  const colorClass = isPositive ? 'text-emerald-500' : 'text-red-500'

  return (
    <span className={cn('font-mono', colorClass, className)}>
      {sign}{value.toFixed(2)}% {arrow}
    </span>
  )
}
