'use client'

import { cn } from '@/lib/utils'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { formatPercent } from '@/lib/utils/numbers'
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
  const colorClass = isPositive ? 'text-gain' : 'text-loss'

  const sizes = {
    sm: { price: 'text-sm', change: 'text-xs' },
    md: { price: 'text-lg font-semibold', change: 'text-sm' },
    lg: { price: 'text-3xl font-bold', change: 'text-base' },
  }

  return (
    <div className="flex items-baseline gap-2">
      <FormattedAmount value={price} from={currency} className={sizes[size].price} />
      {change != null && changePct != null && (
        <span className={cn(sizes[size].change, colorClass, 'flex items-center gap-0.5')}>
          {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {formatPercent(changePct)}
        </span>
      )}
    </div>
  )
}
