'use client'

import { cn } from '@/lib/utils'
import { formatNumber, formatPercent } from '@/lib/utils/numbers'
import { ArrowUp, ArrowDown } from 'lucide-react'

type Props = {
  price: number
  change?: number
  changePct?: number
  currency?: string
  size?: 'sm' | 'md' | 'lg'
}

export function PriceDisplay({ price, change, changePct, currency = 'USD', size = 'md' }: Props) {
  const isPositive = (change ?? 0) >= 0
  const colorClass = isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'

  const sizes = {
    sm: { price: 'text-sm font-mono', change: 'text-xs' },
    md: { price: 'text-lg font-mono font-semibold', change: 'text-sm' },
    lg: { price: 'text-3xl font-mono font-bold', change: 'text-base' },
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className={sizes[size].price}>
        {currency === 'USD' ? '$' : currency === 'EUR' ? '\u20AC' : '$'}{formatNumber(price)}
      </span>
      {change != null && changePct != null && (
        <span className={cn(sizes[size].change, colorClass, 'flex items-center gap-0.5')}>
          {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {formatPercent(changePct)}
        </span>
      )}
    </div>
  )
}
